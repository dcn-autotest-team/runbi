//! Global Low-Level Mouse Hook for Automatic Text Selection Popup
//! Listens for mouse drag-selection or double-click text selection across all desktop applications
//! (similar to Doubao / Cherry Studio / PopClip / Bob), captures selected text, and pops up Runbi.

use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::position::position_window_at_cursor;

#[derive(Clone)]
pub struct SelectionMonitorState {
    pub enabled: Arc<AtomicBool>,
    pub auto_popup: Arc<AtomicBool>,
    pub is_internal_action: Arc<AtomicBool>,
    pub last_selected_text: Arc<Mutex<String>>,
}

impl Default for SelectionMonitorState {
    fn default() -> Self {
        Self {
            enabled: Arc::new(AtomicBool::new(true)),
            auto_popup: Arc::new(AtomicBool::new(true)),
            is_internal_action: Arc::new(AtomicBool::new(false)),
            last_selected_text: Arc::new(Mutex::new(String::new())),
        }
    }
}

#[cfg(windows)]
static MONITOR_STATE: Mutex<Option<(SelectionMonitorState, AppHandle)>> = Mutex::new(None);
#[cfg(windows)]
static LAST_DOWN_X: AtomicI32 = AtomicI32::new(0);
#[cfg(windows)]
static LAST_DOWN_Y: AtomicI32 = AtomicI32::new(0);
#[cfg(windows)]
static LAST_UP_MS: AtomicU64 = AtomicU64::new(0);

#[cfg(windows)]
fn current_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(windows)]
unsafe extern "system" fn low_level_mouse_proc(
    n_code: i32,
    w_param: usize,
    l_param: isize,
) -> isize {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, MSLLHOOKSTRUCT, WM_LBUTTONDOWN, WM_LBUTTONUP,
    };

    if n_code >= 0 {
        let hook_struct = *(l_param as *const MSLLHOOKSTRUCT);
        let pt = hook_struct.pt;
        let now = current_time_ms();

        if w_param == WM_LBUTTONDOWN as usize {
            LAST_DOWN_X.store(pt.x, Ordering::Relaxed);
            LAST_DOWN_Y.store(pt.y, Ordering::Relaxed);
        } else if w_param == WM_LBUTTONUP as usize {
            let down_x = LAST_DOWN_X.load(Ordering::Relaxed);
            let down_y = LAST_DOWN_Y.load(Ordering::Relaxed);

            let dx = (pt.x - down_x).abs();
            let dy = (pt.y - down_y).abs();
            let distance_sq = dx * dx + dy * dy;

            let mut is_selection_gesture = false;
            // A short or fast drag is still a valid text selection.
            if distance_sq >= 16 {
                is_selection_gesture = true;
            }

            // Also check double-click (within 350ms)
            if !is_selection_gesture {
                let last_up = LAST_UP_MS.load(Ordering::Relaxed);
                if last_up > 0 && now.saturating_sub(last_up) <= 350 {
                    is_selection_gesture = true;
                }
            }

            LAST_UP_MS.store(now, Ordering::Relaxed);

            if is_selection_gesture {
                if let Ok(guard) = MONITOR_STATE.lock() {
                    if let Some((state, app_handle)) = guard.as_ref() {
                        if state.enabled.load(Ordering::Relaxed)
                            && !state.is_internal_action.load(Ordering::Relaxed)
                        {
                            let app = app_handle.clone();
                            let state_clone = state.clone();

                            // Trigger grab asynchronously
                            tauri::async_runtime::spawn(async move {
                                // The low-level hook sees mouse-up before the target control does.
                                // Let it commit the selection before sending Ctrl+C.
                                tokio::time::sleep(Duration::from_millis(35)).await;

                                // 1. Check if the mouse is currently over our own Runbi window
                                if let Some(win) = app.get_webview_window("main") {
                                    if win.is_visible().unwrap_or(false) {
                                        if let (Ok(win_pos), Ok(win_size)) =
                                            (win.outer_position(), win.outer_size())
                                        {
                                            if pt.x >= win_pos.x
                                                && pt.x <= win_pos.x + win_size.width as i32
                                                && pt.y >= win_pos.y
                                                && pt.y <= win_pos.y + win_size.height as i32
                                            {
                                                return; // Clicked inside Runbi UI, don't grab
                                            }
                                        }
                                    }
                                }

                                // 2. Get foreground context (source_app, window_title)
                                let (source_app, window_title) = crate::commands::selection::get_foreground_context();
                                if crate::commands::clipboard_monitor::is_blacklisted_app(source_app.as_deref()) {
                                    return;
                                }

                                // 3. Grab selection text via dynamic short-polling (typically 15ms, max 150ms)
                                // Capture screen context first (stored Rust-side; for vision reply).
                                let has_screenshot = crate::commands::screenshot::capture_foreground_screenshot().is_ok();
                                let captured_text = match crate::commands::selection::grab_selected_text_with_retry(&app).await {
                                    Some(t) => t,
                                    None => return,
                                };

                                let trimmed = captured_text.trim();
                                if trimmed.is_empty()
                                    || trimmed.len() > 30000
                                    || crate::commands::clipboard_monitor::is_sensitive_or_password(trimmed)
                                {
                                    return;
                                }

                                let mut should_popup = false;
                                if let Ok(mut last) = state_clone.last_selected_text.lock() {
                                    if *last != captured_text {
                                        *last = captured_text.clone();
                                        should_popup = true;
                                    } else {
                                        // Same text, but user intentionally selected again
                                        should_popup = true;
                                    }
                                }

                                if should_popup {
                                    if let Some(window) = app.get_webview_window("main") {
                                        let _ = position_window_at_cursor(window.clone(), Some(false)).await;
                                        let _ = window.show();
                                        let _ = window.unminimize();
                                        let _ = window.set_focus();
                                        let _ = window.emit(
                                            "runbi://captured-selection",
                                            serde_json::json!({
                                                "text": captured_text,
                                                "sourceApp": source_app,
                                                "windowTitle": window_title,
                                                "hasScreenshot": has_screenshot,
                                                "trigger": "selection",
                                            }),
                                        );
                                    }
                                }
                            });
                        }
                    }
                }
            }
        }
    }

    CallNextHookEx(std::ptr::null_mut(), n_code, w_param, l_param)
}

pub fn start_mouse_selection_monitor(app: &AppHandle, state: SelectionMonitorState) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage, MSG, WH_MOUSE_LL,
        };

        if let Ok(mut lock) = MONITOR_STATE.lock() {
            *lock = Some((state, app.clone()));
        }

        // Run hook message pump in dedicated OS thread
        std::thread::spawn(|| unsafe {
            let hook = SetWindowsHookExW(
                WH_MOUSE_LL,
                Some(low_level_mouse_proc),
                std::ptr::null_mut(),
                0,
            );

            if hook.is_null() {
                eprintln!("[Runbi] Failed to install global mouse selection hook");
                return;
            }

            let mut msg: MSG = std::mem::zeroed();
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        });
    }
}

#[tauri::command]
pub fn set_selection_monitor_enabled(
    state: tauri::State<SelectionMonitorState>,
    enabled: bool,
) -> Result<bool, String> {
    state.enabled.store(enabled, Ordering::SeqCst);
    Ok(enabled)
}

#[tauri::command]
pub fn get_selection_monitor_enabled(
    state: tauri::State<SelectionMonitorState>,
) -> Result<bool, String> {
    Ok(state.enabled.load(Ordering::SeqCst))
}

#[tauri::command]
pub fn set_auto_popup_enabled(
    state: tauri::State<SelectionMonitorState>,
    enabled: bool,
) -> Result<bool, String> {
    state.auto_popup.store(enabled, Ordering::SeqCst);
    Ok(enabled)
}
