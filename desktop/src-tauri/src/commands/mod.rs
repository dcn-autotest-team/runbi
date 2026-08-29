pub mod selection;
pub mod replacer;
pub mod position;
pub mod transport;
pub mod shortcut;
pub mod clipboard_monitor;
pub mod clipboard_snapshot;
pub mod mouse_hook;
pub mod autostart;
pub mod screenshot;
pub mod config;
pub mod input;
#[cfg(windows)]
pub mod uia;
pub mod feedback;

use tauri::Manager;

/// Frontend-reachable append-only log (full-stack tracing).
#[tauri::command]
pub fn append_log(app: tauri::AppHandle, msg: String) {
    file_log(&app, &msg);
}

/// Append-only file log for release builds (no console):
/// %APPDATA%\com.runbi.desktop\runbi.log
pub fn file_log(app: &tauri::AppHandle, msg: &str) {
    use std::io::Write;
    let Ok(dir) = app.path().app_config_dir() else {
        return;
    };
    let _ = std::fs::create_dir_all(&dir);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("runbi.log"))
    {
        let _ = writeln!(f, "[{}] {}", ts, msg);
    }
}

pub use selection::*;
pub use replacer::*;
pub use position::*;
pub use transport::*;
pub use shortcut::*;
pub use clipboard_monitor::*;
pub use mouse_hook::*;
pub use autostart::*;
pub use screenshot::*;
pub use config::*;
pub use feedback::*;


