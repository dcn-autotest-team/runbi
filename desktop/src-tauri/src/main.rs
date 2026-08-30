// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod tray;

use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_global_shortcut::ShortcutState;

const LEGACY_DEV_DSN_FRAGMENT: &str = "@localhost:3000/1";

#[cfg(debug_assertions)]
const DEV_SERVER_ADDR: &str = "127.0.0.1:1420";

#[cfg(debug_assertions)]
fn endpoint_ready(addr: &str) -> bool {
    let Ok(addr) = addr.parse() else {
        return false;
    };
    std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(150)).is_ok()
}

#[cfg(debug_assertions)]
fn resolve_vite_entry(desktop_dir: &std::path::Path) -> std::path::PathBuf {
    let local = desktop_dir.join("node_modules/vite/bin/vite.js");
    if local.exists() {
        local
    } else {
        desktop_dir.join("../node_modules/vite/bin/vite.js")
    }
}

/// `tauri dev` starts Vite through `beforeDevCommand`, but developers also
/// launch target/debug/runbi-desktop.exe directly. In that case no CLI exists
/// to run the hook, so start Vite here and wait before WebView2 is created.
#[cfg(debug_assertions)]
fn ensure_debug_frontend() -> Option<std::process::Child> {
    if endpoint_ready(DEV_SERVER_ADDR) {
        return None;
    }

    let desktop_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("desktop directory missing");
    let vite_entry = resolve_vite_entry(desktop_dir);
    let mut command = std::process::Command::new("node");
    command
        .arg(vite_entry)
        .args(["--host", "127.0.0.1", "--port", "1420", "--strictPort"])
        .current_dir(desktop_dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::inherit());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command
        .spawn()
        .expect("failed to start Vite; install Node.js and run npm install");
    for _ in 0..50 {
        if endpoint_ready(DEV_SERVER_ADDR) {
            eprintln!("[Runbi] debug frontend ready: http://127.0.0.1:1420");
            return Some(child);
        }
        if child.try_wait().ok().flatten().is_some() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    let _ = child.kill();
    panic!("Vite did not become ready on http://127.0.0.1:1420");
}

fn usable_config_dsn(dsn: &str) -> Option<String> {
    let trimmed = dsn.trim();
    (!trimmed.is_empty() && !trimmed.contains(LEGACY_DEV_DSN_FRAGMENT)).then(|| trimmed.to_string())
}

fn resolve_sentry_dsn() -> Option<String> {
    if let Ok(dsn) = std::env::var("RUNBI_GLITCHTIP_DSN") {
        let trimmed = dsn.trim().to_string();
        if !trimmed.is_empty() {
            return Some(trimmed);
        }
    }
    #[cfg(windows)]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let path = std::path::PathBuf::from(appdata)
                .join("com.runbi.desktop")
                .join("config.json");
            if let Ok(content) = std::fs::read_to_string(path) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(dsn) = json.get("glitchtipDsn").and_then(|v| v.as_str()) {
                        if let Some(dsn) = usable_config_dsn(dsn) {
                            return Some(dsn);
                        }
                    }
                }
            }
        }
    }
    None
}

fn main() {
    #[cfg(debug_assertions)]
    let mut spawned_dev_server = ensure_debug_frontend();

    // 错误遥测(GlitchTip/Sentry 协议):仅在设置 DSN 时启用，可来自环境变量或 config.json
    let _sentry_guard = resolve_sentry_dsn().map(|dsn| {
        sentry::init((
            dsn,
            sentry::ClientOptions {
                release: sentry::release_name!(),
                shutdown_timeout: std::time::Duration::from_secs(10),
                ..Default::default()
            },
        ))
    });

    let run_result = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
                            // Debounce key auto-repeat: a held key fires multiple Pressed events,
                            // each spawning a parallel capture+emit that clobbers the panel state.
                            static LAST_FIRE_MS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
                            let now_ms = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_millis() as u64;
                            let last_ms = LAST_FIRE_MS.load(std::sync::atomic::Ordering::Relaxed);
                            if now_ms.saturating_sub(last_ms) < 800 {
                                commands::file_log(app, "wake shortcut debounced (auto-repeat)");
                                return;
                            }
                            LAST_FIRE_MS.store(now_ms, std::sync::atomic::Ordering::Relaxed);
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
                                        let has_screenshot = if trigger == "screen-reply" {
                                            match commands::screenshot::capture_foreground_screenshot() {
                                                Ok(_) => true,
                                                Err(e) => {
                                                    commands::file_log(&app_handle, &format!("screenshot capture FAILED: {}", e));
                                                    false
                                                }
                                            }
                                        } else {
                                            false
                                        };
                                        let text_len = text.len();
                                        let event_text = if is_sensitive { String::new() } else { text };

                                        // 3. Position, show, focus.
                                        let _ = commands::position_window_at_cursor(win_clone.clone(), None).await;
                                        let _ = win_clone.show();
                                        let _ = win_clone.set_focus();

                                        // 4. Hand the captured text + context to the frontend.
                                        let decision = format!(
                                            "trigger={} text_len={} is_chat={} has_shot={} source_app={:?} title={:?}",
                                            trigger, text_len, final_is_chat, has_screenshot, final_source_app, final_window_title
                                        );
                                        eprintln!("[Runbi] shortcut: {}", decision);
                                        commands::file_log(&app_handle, &decision);
                                        let _ = win_clone.emit(
                                            "runbi://captured-selection",
                                            serde_json::json!({
                                                "text": event_text,
                                                "sourceApp": final_source_app,
                                                "windowTitle": final_window_title,
                                                "hasScreenshot": has_screenshot,
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

            // Clipboard monitoring is opt-in. Its Win32 listener thread starts
            // lazily only when the saved setting or user enables it.
            let monitor_state = commands::clipboard_monitor::ClipboardMonitorState::default();
            app.manage(monitor_state);

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
            commands::hide_capsule_window,
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
            commands::capture_app_screenshot,
            commands::set_window_opacity,
            commands::animate_window_opacity,
            commands::append_log,
            commands::submit_feedback,
            commands::open_url,
            commands::load_app_config,
            commands::save_app_config,
            commands::set_auto_popup_enabled,
        ])
        .run(tauri::generate_context!());

    #[cfg(debug_assertions)]
    if let Some(child) = spawned_dev_server.as_mut() {
        let _ = child.kill();
        let _ = child.wait();
    }

    run_result.expect("error while running Runbi Desktop application");
}

#[cfg(test)]
mod tests {
    use super::usable_config_dsn;

    #[cfg(debug_assertions)]
    #[test]
    fn debug_frontend_probe_detects_a_listening_endpoint() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        assert!(super::endpoint_ready(&addr));
    }

    #[cfg(debug_assertions)]
    #[test]
    fn debug_vite_entry_resolves_in_the_npm_workspace() {
        let root = std::env::temp_dir().join(format!(
            "runbi-vite-entry-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let desktop_dir = root.join("desktop");
        let vite_entry = root.join("node_modules/vite/bin/vite.js");
        std::fs::create_dir_all(vite_entry.parent().unwrap()).unwrap();
        std::fs::create_dir_all(&desktop_dir).unwrap();
        std::fs::write(&vite_entry, "").unwrap();

        assert!(super::resolve_vite_entry(&desktop_dir).is_file());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn config_telemetry_is_opt_in_and_ignores_legacy_dev_dsn() {
        assert_eq!(usable_config_dsn(""), None);
        assert_eq!(usable_config_dsn("http://abc@localhost:3000/1"), None);
        assert_eq!(
            usable_config_dsn(" https://key@errors.example.com/1 "),
            Some("https://key@errors.example.com/1".to_string())
        );
    }

    /// 冒烟测试:需要本地 GlitchTip 运行(infra/glitchtip/docker-compose.yml)。
    /// 运行: $env:RUNBI_GLITCHTIP_DSN="http://<public_key>@localhost:3000/1"; cargo test --release -- --ignored
    #[test]
    #[ignore = "requires RUNBI_GLITCHTIP_DSN pointing at a running GlitchTip instance"]
    fn sentry_smoke_reports_to_local_glitchtip() {
        let dsn = std::env::var("RUNBI_GLITCHTIP_DSN").expect("RUNBI_GLITCHTIP_DSN not set");
        let guard = sentry::init((
            dsn,
            sentry::ClientOptions {
                shutdown_timeout: std::time::Duration::from_secs(10),
                ..Default::default()
            },
        ));
        let event_id = sentry::capture_message("Runbi Rust SDK smoke test", sentry::Level::Info);
        assert!(!event_id.is_nil(), "sentry client should accept the event");
        drop(guard); // 触发 flush(shutdown_timeout 内完成)
    }
}
