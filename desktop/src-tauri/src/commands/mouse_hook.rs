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
            auto_popup: Arc::new(AtomicBool::new(false)),
            is_internal_action: Arc::new(AtomicBool::new(false)),
            last_selected_text: Arc::new(Mutex::new(String::new())),
        }
    }
}

// Every physical interaction invalidates captures still awaiting UIA/clipboard.
// Shared with the clipboard path so it cannot resurrect a dismissed capsule.
pub static SELECTION_GENERATION: AtomicU64 = AtomicU64::new(0);

#[cfg(windows)]
static MONITOR_STATE: Mutex<Option<(SelectionMonitorState, AppHandle)>> = Mutex::new(None);
#[cfg(windows)]
static LAST_DOWN_X: AtomicI32 = AtomicI32::new(0);
#[cfg(windows)]
static LAST_DOWN_Y: AtomicI32 = AtomicI32::new(0);
#[cfg(windows)]
static LAST_UP_MS: AtomicU64 = AtomicU64::new(0);
/// 同一选区 2s 内只允许一次 position+emit:钩子/复制/剪贴板三路监听会对同一条
/// 文本各自开任务,并发 set_size/set_always_on_top 同一窗口曾触发堆破坏
/// (0xc0000374,WER 8/28 三份 release 报告同码),这里是硬闸。
#[cfg(windows)]
static LAST_POP_TEXT: Mutex<Option<(u64, u64, String)>> = Mutex::new(None);

#[cfg(windows)]
fn should_pop_once(text: &str) -> bool {
    let now = current_time_ms();
    let generation = SELECTION_GENERATION.load(Ordering::SeqCst);
    if let Ok(mut slot) = LAST_POP_TEXT.lock() {
        if let Some((previous_generation, ts, prev)) = slot.as_ref() {
            if *previous_generation == generation && now.saturating_sub(*ts) < 2000 && prev == text {
                return false;
            }
        }
        *slot = Some((generation, now, text.to_string()));
        true
    } else {
        false
    }
}

#[cfg(not(windows))]
fn should_pop_once(_text: &str) -> bool {
    true
}

#[cfg(windows)]
fn current_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn should_handle_selection(state: &SelectionMonitorState) -> bool {
    state.enabled.load(Ordering::Relaxed)
        && state.auto_popup.load(Ordering::Relaxed)
        && !state.is_internal_action.load(Ordering::Relaxed)
}

#[cfg(windows)]
unsafe fn is_runbi_window(hwnd: windows_sys::Win32::Foundation::HWND) -> bool {
    let mut pid = 0;
    windows_sys::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(hwnd, &mut pid);
    pid == std::process::id()
}

#[cfg(windows)]
fn invalidate_selection() {
    let generation = SELECTION_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    if let Ok(guard) = MONITOR_STATE.try_lock() {
        if let Some((_, app)) = guard.as_ref() {
            let app_handle = app.clone();
            // Never call blocking window operations from a low-level hook.
            let _ = app.run_on_main_thread(move || {
                let _ = app_handle.emit("runbi://selection-invalidated", generation);
            });
        }
    }
}

#[cfg(windows)]
unsafe extern "system" fn low_level_keyboard_proc(
    n_code: i32,
    w_param: usize,
    l_param: isize,
) -> isize {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetForegroundWindow, KBDLLHOOKSTRUCT, LLKHF_INJECTED,
        WM_KEYDOWN, WM_SYSKEYDOWN,
    };
    if n_code >= 0 && (w_param == WM_KEYDOWN as usize || w_param == WM_SYSKEYDOWN as usize) {
        let event = &*(l_param as *const KBDLLHOOKSTRUCT);
        // Ignore injected Ctrl+C and bare modifiers; the source app owns focus
        // while the capsule is visible, so DOM keydown/blur cannot observe these.
        let modifier = matches!(event.vkCode, 0x10..=0x12 | 0x5B..=0x5C | 0xA0..=0xA5);
        if event.flags & LLKHF_INJECTED == 0 && !modifier
            && !is_runbi_window(GetForegroundWindow())
        {
            invalidate_selection();
        }
    }
    CallNextHookEx(std::ptr::null_mut(), n_code, w_param, l_param)
}

#[cfg(windows)]
unsafe extern "system" fn low_level_mouse_proc(
    n_code: i32,
    w_param: usize,
    l_param: isize,
) -> isize {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, WindowFromPoint, MSLLHOOKSTRUCT, LLMHF_INJECTED,
        WM_LBUTTONDOWN, WM_LBUTTONUP, WM_RBUTTONDOWN, WM_MBUTTONDOWN,
    };

    if n_code >= 0 {
        let hook_struct = *(l_param as *const MSLLHOOKSTRUCT);
        let pt = hook_struct.pt;
        let now = current_time_ms();

        if hook_struct.flags & LLMHF_INJECTED != 0 {
            return CallNextHookEx(std::ptr::null_mut(), n_code, w_param, l_param);
        }
        if matches!(w_param as u32, WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN) {
            if is_runbi_window(WindowFromPoint(pt)) {
                // Clicking a capsule action also cancels unfinished captures,
                // but must leave the capsule alive long enough to receive click.
                SELECTION_GENERATION.fetch_add(1, Ordering::SeqCst);
            } else {
                invalidate_selection();
            }
        }

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
                        if should_handle_selection(state) {
                            let app = app_handle.clone();
                            let state_clone = state.clone();
                            let generation = SELECTION_GENERATION.load(Ordering::SeqCst);

                            // Trigger grab asynchronously
                            tauri::async_runtime::spawn(async move {
                                // The low-level hook sees mouse-up before the target control does.
                                // Let it commit the selection before sending Ctrl+C.
                                tokio::time::sleep(Duration::from_millis(55)).await;
                                if generation != SELECTION_GENERATION.load(Ordering::SeqCst)
                                    || !should_handle_selection(&state_clone) {
                                    return;
                                }

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
                                let (source_app, window_title) =
                                    crate::commands::selection::get_foreground_context();
                                if crate::commands::clipboard_monitor::is_blacklisted_app(
                                    source_app.as_deref(),
                                ) {
                                    return;
                                }

                                // Screenshots are useful only for conversation windows. Capturing
                                // every ordinary selection was the dominant hot-path cost.
                                let is_chat =
                                    crate::commands::screenshot::is_likely_conversation_window(
                                        source_app.as_deref(),
                                        window_title.as_deref(),
                                    );
                                let has_screenshot = is_chat
                                    && crate::commands::screenshot::capture_foreground_screenshot()
                                        .is_ok();

                                // 3. Grab selection text via UIA / clipboard fallback.
                                let captured_text =
                                    match crate::commands::selection::grab_selected_text_with_retry(
                                        &app,
                                    )
                                    .await
                                    {
                                        Some(t) => t,
                                        None => {
                                            eprintln!(
                                                "[Runbi] selection dropped: grab returned none"
                                            );
                                            return;
                                        }
                                    };

                                if generation != SELECTION_GENERATION.load(Ordering::SeqCst) {
                                    return;
                                }
                                let trimmed = captured_text.trim();
                                if trimmed.is_empty()
                                    || trimmed.len() > 30000
                                    || crate::commands::clipboard_monitor::is_sensitive_or_password(
                                        trimmed,
                                    )
                                {
                                    eprintln!("[Runbi] selection dropped: empty/sensitive/oversize len={}", trimmed.len());
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

                                if should_popup && should_pop_once(&captured_text) {
                                    if let Some(window) = app.get_webview_window("main") {
                                        // 防止剪贴板监听把同一份文本当"新复制"再弹完整面板顶掉胶囊
                                        crate::commands::selection::sync_clipboard_monitor_baseline(
                                            &app,
                                            &captured_text,
                                        );
                                        // 划词路径固定弹微胶囊,点击后由前端展开为完整面板;
                                        // 快捷键/剪贴板路径(position None/false)保持完整面板。
                                        if let Err(e) =
                                            position_window_at_cursor(window.clone(), Some(true))
                                                .await
                                        {
                                            eprintln!(
                                                "[Runbi] selection capsule positioning failed: {e}"
                                            );
                                            return;
                                        }
                                        // Serialize show/emit with invalidation delivery on the
                                        // main thread; an already-cancelled capture must not show.
                                        let _ = app.run_on_main_thread(move || {
                                            if generation != SELECTION_GENERATION.load(Ordering::SeqCst) {
                                                return;
                                            }
                                            let _ = window.show();
                                            let _ = window.unminimize();
                                            // Keep focus and the selection in the source app. The
                                            // toolbar becomes active only when an action is clicked.
                                            let _ = window.emit(
                                                "runbi://captured-selection",
                                                serde_json::json!({
                                                    "text": captured_text,
                                                    "sourceApp": source_app,
                                                    "windowTitle": window_title,
                                                    "hasScreenshot": has_screenshot,
                                                    "trigger": "selection",
                                                    "generation": generation,
                                                    "capsule": true,
                                                }),
                                            );
                                        });
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
            DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage, MSG, WH_MOUSE_LL, WH_KEYBOARD_LL,
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

            let keyboard_hook = SetWindowsHookExW(
                WH_KEYBOARD_LL,
                Some(low_level_keyboard_proc),
                std::ptr::null_mut(),
                0,
            );
            if keyboard_hook.is_null() {
                eprintln!("[Runbi] Failed to install selection dismissal keyboard hook");
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

#[cfg(test)]
mod tests {
    use super::{should_handle_selection, should_pop_once, SelectionMonitorState};
    use std::sync::atomic::Ordering;

    #[test]
    fn automatic_selection_popup_is_opt_in_and_obeys_internal_guard() {
        let state = SelectionMonitorState::default();
        assert!(!should_handle_selection(&state));

        state.auto_popup.store(true, Ordering::Relaxed);
        assert!(should_handle_selection(&state));

        state.is_internal_action.store(true, Ordering::Relaxed);
        assert!(!should_handle_selection(&state));
    }

    #[test]
    fn same_text_cannot_pop_twice_within_dedup_window() {
        // 崩溃防御回归:三路监听对同一条选区各自开任务时,只有第一路能弹。
        let a = should_pop_once("weekly report text");
        let b = should_pop_once("weekly report text");
        // 换了新文本立即可弹;回到旧文本在窗口期内仍被挡(记录被新文本覆盖,
        // 这正是预期——挡的是同一时刻的重复任务,不是正常的新划词)。
        let c = should_pop_once("different text");
        assert!(a && !b && c);
    }
}

