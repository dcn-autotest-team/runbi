//! System Tray Management for Runbi Desktop

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show_i = MenuItem::with_id(app, "show", "显示 润笔 (Show)", true, None::<&str>)?;
    let settings_i = MenuItem::with_id(app, "settings", "设置 (Settings)", true, None::<&str>)?;
    let hide_i = MenuItem::with_id(app, "hide", "隐藏 (Hide)", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "退出 (Quit)", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show_i, &settings_i, &hide_i, &quit_i])?;

    let mut tray_builder = TrayIconBuilder::new().tooltip("润笔 (Runbi) - AI 划词润色");
    if let Some(icon) = app.default_window_icon().cloned() {
        tray_builder = tray_builder.icon(icon);
    }

    let _tray = tray_builder
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    crate::commands::mouse_hook::leave_capsule_mode();
                    #[cfg(windows)]
                    crate::commands::mouse_hook::clear_outside_dismissal();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "settings" => {
                if let Some(window) = app.get_webview_window("main") {
                    crate::commands::mouse_hook::leave_capsule_mode();
                    #[cfg(windows)]
                    crate::commands::mouse_hook::clear_outside_dismissal();
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("runbi://open-settings", ());
                }
            }
            "hide" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    crate::commands::mouse_hook::leave_capsule_mode();
                    #[cfg(windows)]
                    crate::commands::mouse_hook::clear_outside_dismissal();
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}
