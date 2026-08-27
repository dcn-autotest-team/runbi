// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod tray;

use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

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

            // Setup Global Shortcut: Alt+Space
            let app_handle = app.handle().clone();
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(move |app, shortcut, event| {
                        if event.state() == ShortcutState::Pressed {
                            if let Some(window) = app.get_webview_window("main") {
                                if window.is_visible().unwrap_or(false) {
                                    let _ = window.hide();
                                } else {
                                    // Trigger grab and show
                                    let win_clone = window.clone();
                                    tauri::async_runtime::spawn(async move {
                                        let _ = commands::position_window_at_cursor(win_clone.clone()).await;
                                        let _ = win_clone.show();
                                        let _ = win_clone.set_focus();

                                        if let Ok(res) = commands::get_current_selection(win_clone.clone()).await {
                                            if !res.text.trim().is_empty() {
                                                let _ = win_clone.emit("runbi://captured-selection", serde_json::json!({
                                                    "text": res.text
                                                }));
                                            }
                                        }
                                    });
                                }
                            }
                        }
                    })
                    .build(),
            )?;

            // Register default shortcut
            if let Ok(shortcut) = "Alt+Space".parse::<Shortcut>() {
                let _ = app.global_shortcut().register(shortcut);
            }

            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Auto hide on focus loss
            WindowEvent::Focused(false) => {
                // If user unfocuses, smoothly hide floating window
                let _ = window.hide();
            }
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Runbi Desktop application");
}
