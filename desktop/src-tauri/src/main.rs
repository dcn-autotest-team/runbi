// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod tray;

use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_global_shortcut::ShortcutState;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            // Setup System Tray
            if let Err(e) = tray::setup_tray(app.handle()) {
                eprintln!("[Runbi] Failed to setup system tray: {}", e);
            }

            // Setup Global Shortcut (persisted value, or the default)
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(move |app, _shortcut, event| {
                        if event.state() == ShortcutState::Pressed {
                            eprintln!("[Runbi] wake shortcut fired");
                            commands::file_log(app, "wake shortcut fired");
                            let app_handle = app.clone();
                            if let Some(window) = app.get_webview_window("main") {
                                if window.is_visible().unwrap_or(false) {
                                    let _ = window.hide();
                                } else {
                                    // Capture selected text first while the target app still has focus.
                                    let (source_app, window_title) = commands::get_foreground_context();
                                    let is_chat = commands::screenshot::is_likely_conversation_window(
                                        source_app.as_deref(),
                                        window_title.as_deref(),
                                    );

                                    let win_clone = window.clone();
                                    tauri::async_runtime::spawn(async move {
                                        let res = match commands::get_current_selection(win_clone.clone()).await {
                                            Ok(res) => res,
                                            Err(_) => commands::SelectionResult {
                                                text: String::new(),
                                                cursor_x: 0,
                                                cursor_y: 0,
                                                source_app: None,
                                                window_title: None,
                                            },
                                        };
                                        let text = res.text;
                                        let final_source_app = source_app.or(res.source_app);
                                        let final_window_title = window_title.or(res.window_title);
                                        let final_is_chat = is_chat || commands::screenshot::is_likely_conversation_window(
                                            final_source_app.as_deref(),
                                            final_window_title.as_deref(),
                                        );
                                        let is_sensitive = commands::is_blacklisted_app(final_source_app.as_deref())
                                            || commands::is_sensitive_or_password(text.trim());
                                        let has_selection = !text.trim().is_empty();
                                        let trigger = if is_sensitive {
                                            "sensitive-blocked"
                                        } else if !has_selection && final_is_chat {
                                            "screen-reply"
                                        } else {
                                            "shortcut"
                                        };
                                        let screenshot = if trigger == "screen-reply" {
                                            commands::screenshot::capture_foreground_screenshot().ok()
                                        } else {
                                            None
                                        };
                                        let text_len = text.len();
                                        let event_text = if is_sensitive { String::new() } else { text };

                                        // 3. Position, show, focus.
                                        let _ = commands::position_window_at_cursor(win_clone.clone(), None).await;
                                        let _ = win_clone.show();
                                        let _ = win_clone.set_focus();

                                        // 4. Hand the captured text + context to the frontend.
                                        let decision = format!(
                                            "trigger={} text_len={} is_chat={} source_app={:?} title={:?}",
                                            trigger, text_len, final_is_chat, final_source_app, final_window_title
                                        );
                                        eprintln!("[Runbi] shortcut: {}", decision);
                                        commands::file_log(&app_handle, &decision);
                                        let _ = win_clone.emit(
                                            "runbi://captured-selection",
                                            serde_json::json!({
                                                "text": event_text,
                                                "sourceApp": final_source_app,
                                                "windowTitle": final_window_title,
                                                "screenshot": screenshot,
                                                "trigger": trigger,
                                            }),
                                        );
                                    });
                                }
                            }
                        }
                    })
                    .build(),
            )?;

            // Start Background Clipboard Copy Monitor
            let monitor_state = commands::clipboard_monitor::ClipboardMonitorState::default();
            app.manage(monitor_state.clone());
            commands::clipboard_monitor::start_clipboard_monitor(app.handle(), monitor_state);

            // Start Global Mouse Drag-Selection Monitor (Doubao / Cherry Studio style)
            let selection_state = commands::mouse_hook::SelectionMonitorState::default();
            app.manage(selection_state.clone());
            commands::mouse_hook::start_mouse_selection_monitor(app.handle(), selection_state);

            // Register the wake shortcut (persisted value, or the default)
            let shortcut_str = commands::load_shortcut(app.handle());
            match commands::register_with_fallback(app.handle(), &shortcut_str) {
                Ok((effective, used_fallback)) => {
                    if used_fallback {
                        let m = format!(
                            "wake shortcut '{shortcut_str}' was taken by another app, using fallback '{effective}'"
                        );
                        eprintln!("[Runbi] {}", m);
                        commands::file_log(app.handle(), &m);
                    } else {
                        let m = format!("wake shortcut registered: {effective}");
                        eprintln!("[Runbi] {}", m);
                        commands::file_log(app.handle(), &m);
                    }
                }
                Err(e) => {
                    let m = format!("Failed to register any wake shortcut: {e}");
                    eprintln!("[Runbi] {}", m);
                    commands::file_log(app.handle(), &m);
                }
            }

            // If started manually (not via Windows autostart / silent flag), show and center window
            let is_silent = std::env::args().any(|arg| arg == "--autostart" || arg == "--silent");
            if !is_silent {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.center();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Intercept close button to hide to tray instead of exiting
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_current_selection,
            commands::replace_text,
            commands::position_window_at_cursor,
            commands::test_llm_connection,
            commands::hide_window,
            commands::app_ready,
            commands::get_global_shortcut,
            commands::set_global_shortcut,
            commands::set_clipboard_monitor_enabled,
            commands::get_clipboard_monitor_enabled,
            commands::set_selection_monitor_enabled,
            commands::get_selection_monitor_enabled,
            commands::stream_llm_chat,
            commands::is_autostart_enabled,
            commands::set_autostart,
            commands::capture_foreground_screenshot,
            commands::load_app_config,
            commands::save_app_config,
            commands::set_auto_popup_enabled,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Runbi Desktop application");
}
