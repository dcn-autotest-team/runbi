pub mod autostart;
pub mod clipboard_monitor;
pub mod clipboard_snapshot;
pub mod config;
pub mod feedback;
pub mod feishu_copilot;
pub mod input;
pub mod mouse_hook;
pub mod position;
pub mod replacer;
pub mod screenshot;
pub mod selection;
pub mod shortcut;
pub mod transport;
#[cfg(windows)]
pub mod uia;

use tauri::Manager;

/// Frontend-reachable append-only log (full-stack tracing).
#[tauri::command]
pub fn append_log(app: tauri::AppHandle, msg: String) {
    file_log(&app, &msg);
}

/// Adjust panel window opacity (0.2..1.0). Tauri 2.11 exposes no set_opacity
/// binding, so we drive the Win32 layered-window style directly.
#[tauri::command]
pub fn set_window_opacity(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    opacity: f64,
) -> Result<(), String> {
    let result = set_window_opacity_inner(&window, opacity);
    file_log(
        &app,
        &format!("set_window_opacity({}) -> {:?}", opacity, result.is_ok()),
    );
    result
}

fn set_window_opacity_inner(window: &tauri::WebviewWindow, opacity: f64) -> Result<(), String> {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetLayeredWindowAttributes, SetWindowLongPtrW, GWL_EXSTYLE,
            WS_EX_LAYERED,
        };
        const LWA_ALPHA: u32 = 2;
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0;
        let clamped = opacity.clamp(0.2, 1.0);
        if clamped >= 1.0 {
            // 全不透明: 摘掉 WS_EX_LAYERED,窗口回到普通样式(alpha 复位)。
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE as i32);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE as i32, ex & !WS_EX_LAYERED as isize);
            return Ok(());
        }
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE as i32);
        if (ex & WS_EX_LAYERED as isize) == 0 {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE as i32, ex | WS_EX_LAYERED as isize);
        }
        let alpha = (clamped * 255.0).round() as u8;
        if SetLayeredWindowAttributes(hwnd, 0, alpha, LWA_ALPHA) == 0 {
            return Err("SetLayeredWindowAttributes failed".to_string());
        }
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        let _ = (window, opacity);
        Err("Opacity not supported on non-windows platform".to_string())
    }
}

/// Animate window opacity toward `target` on the Rust side.
/// WebView2 throttles requestAnimationFrame whenever the panel loses focus or
/// is hidden, so the JS-driven easing silently stalls mid-drag; driving the
/// interpolation here keeps the animation alive regardless of webview state.
#[tauri::command]
pub fn animate_window_opacity(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    target: f64,
) -> Result<(), String> {
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    static ANIM_RUNNING: AtomicBool = AtomicBool::new(false);
    static CURRENT_ALPHA: AtomicU32 = AtomicU32::new(255);

    let clamped = target.clamp(0.2, 1.0);
    let goal = (clamped * 255.0).round() as u32;
    CURRENT_ALPHA.store(goal, Ordering::SeqCst);
    if !ANIM_RUNNING.swap(true, Ordering::SeqCst) {
        let win = window.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let goal = CURRENT_ALPHA.load(Ordering::SeqCst) as i32;
                let cur = win.opacity_alpha().unwrap_or(255);
                if cur == goal {
                    break;
                }
                // 线性插值：每帧固定走剩余距离的 1/20（约 320ms 全程），
                // 不做指数缓动 —— 指数前段跨度过大，拖动时窗口 alpha
                // 远快于滑杆数值，稍拉就变得非常透明（Issue #12）。
                let dist = goal - cur;
                let next: i32 = if dist.abs() <= 2 {
                    goal
                } else {
                    cur + dist / 20
                };
                let _ = win.set_opacity_alpha(next as u32);
                if next == goal {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(16)).await;
            }
            ANIM_RUNNING.store(false, Ordering::SeqCst);
        });
    }
    let _ = &app;
    Ok(())
}

/// Raw alpha helpers on WebviewWindow (Win32 layered window, kept private to
/// this module via `pub(crate)`-free inherent impl on a local trait instead of
/// polluting the public surface).
trait OpacityAlpha {
    fn opacity_alpha(&self) -> Result<i32, String>;
    fn set_opacity_alpha(&self, alpha: u32) -> Result<(), String>;
}

impl OpacityAlpha for tauri::WebviewWindow {
    fn opacity_alpha(&self) -> Result<i32, String> {
        #[cfg(windows)]
        unsafe {
            use windows_sys::Win32::UI::WindowsAndMessaging::GetLayeredWindowAttributes;
            use windows_sys::Win32::UI::WindowsAndMessaging::{
                GetWindowLongPtrW, GWL_EXSTYLE, WS_EX_LAYERED,
            };
            let hwnd = self.hwnd().map_err(|e| e.to_string())?.0;
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE as i32);
            if (ex & WS_EX_LAYERED as isize) == 0 {
                return Ok(255);
            }
            let mut color: u32 = 0;
            let mut alpha: u8 = 255;
            let mut flags: u32 = 0;
            if GetLayeredWindowAttributes(hwnd, &mut color, &mut alpha, &mut flags) == 0 {
                return Ok(255);
            }
            return Ok(alpha as i32);
        }
        #[cfg(not(windows))]
        Ok(255)
    }

    fn set_opacity_alpha(&self, alpha: u32) -> Result<(), String> {
        #[cfg(windows)]
        unsafe {
            use windows_sys::Win32::UI::WindowsAndMessaging::{
                GetWindowLongPtrW, SetLayeredWindowAttributes, SetWindowLongPtrW, GWL_EXSTYLE,
                WS_EX_LAYERED,
            };
            const LWA_ALPHA: u32 = 2;
            let hwnd = self.hwnd().map_err(|e| e.to_string())?.0;
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE as i32);
            if (ex & WS_EX_LAYERED as isize) == 0 {
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE as i32, ex | WS_EX_LAYERED as isize);
            }
            if SetLayeredWindowAttributes(hwnd, 0, alpha.min(255) as u8, LWA_ALPHA) == 0 {
                return Err("SetLayeredWindowAttributes failed".to_string());
            }
            return Ok(());
        }
        #[cfg(not(windows))]
        {
            let _ = alpha;
            Ok(())
        }
    }
}

/// Append-only file log for release builds (no console):
/// %APPDATA%\com.runbi.desktop\runbi.log
pub fn file_log(app: &tauri::AppHandle, msg: &str) {
    use std::io::Write;
    static LOG_LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    let _guard = LOG_LOCK
        .get_or_init(|| std::sync::Mutex::new(()))
        .lock()
        .ok();
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

pub use autostart::*;
pub use clipboard_monitor::*;
pub use config::*;
pub use feedback::*;
pub use mouse_hook::*;
pub use position::*;
pub use replacer::*;
pub use screenshot::*;
pub use selection::*;
pub use shortcut::*;
pub use transport::*;
