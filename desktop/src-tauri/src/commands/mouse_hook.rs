//! Global Low-Level Mouse Hook for Automatic Text Selection Popup
//! Listens for mouse drag-selection or double-click text selection across all desktop applications
//! (similar to Doubao / Cherry Studio / PopClip / Bob), captures selected text, and pops up Runbi.

use std::sync::atomic::{AtomicBool, AtomicI32, AtomicIsize, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};


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

const NO_CAPSULE: u64 = u64::MAX;
const OUTSIDE_DISMISS_GRACE_MS: u64 = 180;
pub static CAPSULE_GENERATION: AtomicU64 = AtomicU64::new(NO_CAPSULE);

pub fn leave_capsule_mode() {
    CAPSULE_GENERATION.store(NO_CAPSULE, Ordering::SeqCst);
}

#[cfg(windows)]
pub fn clear_outside_dismissal() {
    OUTSIDE_DISMISS_GENERATION.store(0, Ordering::SeqCst);
    OUTSIDE_DISMISS_LOCKED.store(false, Ordering::SeqCst);
}

fn take_capsule(state: &AtomicU64, generation: u64) -> bool {
    generation != NO_CAPSULE
        && state
            .compare_exchange(generation, NO_CAPSULE, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
}

// Call on the main thread, like show/emit below. A late hide must never touch
// a newer capsule or an expanded panel. No WebView event/IPC round trip needed.
pub fn dismiss_native_capsule(
    window: &tauri::WebviewWindow,
    generation: u64,
) -> Result<(), String> {
    if take_capsule(&CAPSULE_GENERATION, generation) {
        if let Err(error) = window.hide() {
            CAPSULE_GENERATION.store(generation, Ordering::SeqCst);
            return Err(error.to_string());
        }
    }
    Ok(())
}

pub fn show_native_capsule(window: &tauri::WebviewWindow, generation: u64) -> Result<bool, String> {
    let dismissed_generation = OUTSIDE_DISMISS_GENERATION.load(Ordering::SeqCst);
    // A blank click invalidates every capture already queued at that moment.
    // Do not let a race assign a newer generation to that same stale gesture
    // and reopen the capsule during the short dismissal window.
    if should_skip_capsule_show_due_to_dismissal(
        generation,
        dismissed_generation,
        current_time_ms(),
        OUTSIDE_DISMISS_UNTIL_MS.load(Ordering::Relaxed),
    ) {
        crate::commands::file_log(
            window.app_handle(),
            &format!(
                "capsule show skipped: outside-dismiss barrier generation={generation} dismissed_generation={dismissed_generation}"
            ),
        );
        return Ok(false);
    }
    if generation != SELECTION_GENERATION.load(Ordering::SeqCst) {
        let was_visible = window.is_visible().unwrap_or(false);
        let dismissed_generation = OUTSIDE_DISMISS_GENERATION.load(Ordering::SeqCst);
        let was_dismissed_by_blank_click = dismissed_generation != 0
            && generation <= dismissed_generation
            && CAPSULE_GENERATION.load(Ordering::SeqCst) == NO_CAPSULE;
        let _ = crate::commands::position::restore_panel_window(window);
        leave_capsule_mode();
        if was_dismissed_by_blank_click || !was_visible {
            let _ = window.hide();
        }
        crate::commands::file_log(
            window.app_handle(),
            &format!("capsule rollback: stale_generation={generation} current={} visible={was_visible}",
                SELECTION_GENERATION.load(Ordering::SeqCst)),
        );
        return Ok(false);
    }
    CAPSULE_GENERATION.store(generation, Ordering::SeqCst);
    // Register the generation before showing the native window. Otherwise a
    // click/keyboard event in this small gap can invalidate an apparent
    // non-capsule, and the old show then resurrects it after dismissal.
    if let Err(error) = window.show() {
        leave_capsule_mode();
        return Err(error.to_string());
    }
    if let Err(error) = window.unminimize() {
        leave_capsule_mode();
        let _ = window.hide();
        return Err(error.to_string());
    }
    if generation != SELECTION_GENERATION.load(Ordering::SeqCst) {
        leave_capsule_mode();
        let _ = window.hide();
        let _ = crate::commands::position::restore_panel_window(window);
        return Ok(false);
    }
    crate::commands::file_log(window.app_handle(), &format!("capsule shown: generation={generation}"));
    Ok(true)
}

fn should_skip_capsule_show_due_to_dismissal(
    _generation: u64,
    dismissed_generation: u64,
    _now: u64,
    _dismiss_until_ms: u64,
) -> bool {
    // A blank click is an explicit dismissal, not a short debounce. Keep the
    // dismissal barrier until the next real selection gesture clears it on
    // pointer-up. Otherwise a delayed UIA/clipboard task can arrive after the
    // grace period with a newer generation and resurrect the capsule.
    OUTSIDE_DISMISS_LOCKED.load(Ordering::Relaxed)
        || dismissed_generation != 0
}

#[cfg(windows)]
static MONITOR_STATE: OnceLock<(SelectionMonitorState, AppHandle)> = OnceLock::new();
#[cfg(windows)]
static RUNBI_WINDOW_HANDLE: AtomicIsize = AtomicIsize::new(0);
#[cfg(windows)]
static LAST_DOWN_X: AtomicI32 = AtomicI32::new(0);
#[cfg(windows)]
static LAST_DOWN_Y: AtomicI32 = AtomicI32::new(0);
#[cfg(windows)]
static DOWN_STARTED_INSIDE_CAPSULE: AtomicBool = AtomicBool::new(false);
#[cfg(windows)]
static OUTSIDE_DISMISS_UNTIL_MS: AtomicU64 = AtomicU64::new(0);
#[cfg(windows)]
static DISMISS_NEXT_SELECTION_UNTIL_MS: AtomicU64 = AtomicU64::new(0);
#[cfg(windows)]
static OUTSIDE_DISMISS_GENERATION: AtomicU64 = AtomicU64::new(0);
#[cfg(windows)]
static OUTSIDE_DISMISS_LOCKED: AtomicBool = AtomicBool::new(false);
#[cfg(windows)]
static LAST_UP_MS: AtomicU64 = AtomicU64::new(0);
#[cfg(windows)]
static LAST_UP_X: AtomicI32 = AtomicI32::new(0);
#[cfg(windows)]
static LAST_UP_Y: AtomicI32 = AtomicI32::new(0);

#[cfg(windows)]
pub fn set_runbi_window_handle(hwnd: isize) {
    RUNBI_WINDOW_HANDLE.store(hwnd, Ordering::SeqCst);
}

#[cfg(windows)]
unsafe fn hide_runbi_window_now() {
    use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, ShowWindowAsync, SW_HIDE};
    let hwnd = RUNBI_WINDOW_HANDLE.load(Ordering::SeqCst)
        as windows_sys::Win32::Foundation::HWND;
    if !hwnd.is_null() {
        // Post the hide to the host's UI thread and also hide synchronously.
        // Some WebView2 hosts ignore one of these calls while a low-level hook
        // is running on a different thread.
        ShowWindowAsync(hwnd, SW_HIDE);
        ShowWindow(hwnd, SW_HIDE);
    }
}

#[cfg(windows)]
unsafe fn point_inside_runbi_window(pt: windows_sys::Win32::Foundation::POINT) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowRect, IsWindowVisible};
    let hwnd = RUNBI_WINDOW_HANDLE.load(Ordering::SeqCst)
        as windows_sys::Win32::Foundation::HWND;
    if hwnd.is_null() || IsWindowVisible(hwnd) == 0 {
        return false;
    }
    let mut rect = std::mem::zeroed::<windows_sys::Win32::Foundation::RECT>();
    if GetWindowRect(hwnd, &mut rect) == 0 {
        return false;
    }
    pt.x >= rect.left && pt.x < rect.right && pt.y >= rect.top && pt.y < rect.bottom
}

#[cfg(windows)]
unsafe fn visible_capsule_window() -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowRect, IsWindowVisible};
    let hwnd = RUNBI_WINDOW_HANDLE.load(Ordering::SeqCst)
        as windows_sys::Win32::Foundation::HWND;
    if hwnd.is_null() || IsWindowVisible(hwnd) == 0 {
        return false;
    }
    let mut rect = std::mem::zeroed::<windows_sys::Win32::Foundation::RECT>();
    if GetWindowRect(hwnd, &mut rect) == 0 {
        return false;
    }
    let width = rect.right.saturating_sub(rect.left);
    let height = rect.bottom.saturating_sub(rect.top);
    width > 0 && width <= 500 && height > 0 && height <= 160
}

fn is_selection_gesture(dragged: bool, now: u64, previous_click: u64, dx: i64, dy: i64) -> bool {
    dragged || (previous_click != 0 && now.saturating_sub(previous_click) <= 350
        && dx.abs() <= 4 && dy.abs() <= 4)
}

fn should_capture_after_pointer_up(
    suppress_capture: bool,
    dragged: bool,
    now: u64,
    previous_click: u64,
    dx: i64,
    dy: i64,
) -> bool {
    // The first ordinary click outside a visible capsule dismisses it. Do not
    // let the stale double-click timestamp turn that same click into a second
    // capture and immediately reopen the capsule.
    !suppress_capture && is_selection_gesture(dragged, now, previous_click, dx, dy)
}

fn outside_dismiss_blocks_capture(dragged: bool, now: u64, until_ms: u64) -> bool {
    // A real drag is a new selection and must be allowed immediately after a
    // blank-click dismissal. Only suppress ordinary clicks during the short
    // native hide window.
    !dragged && now < until_ms
}

fn dismissal_suppresses_selection(now: u64, suppress_until_ms: u64) -> bool {
    suppress_until_ms != 0 && now < suppress_until_ms
}
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
            let age = now.saturating_sub(*ts);
            // A new selection generation is an explicit user gesture, even
            // when it selects the same text again. Only collapse duplicate
            // producers for the very same generation.
            if prev == text && *previous_generation == generation && age < 2000 {
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
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetAncestor, GetParent, GetWindow, GetWindowThreadProcessId, GA_ROOT, GA_ROOTOWNER,
        GW_OWNER,
    };
    if hwnd.is_null() {
        return false;
    }
    let runbi_hwnd = RUNBI_WINDOW_HANDLE.load(Ordering::SeqCst)
        as windows_sys::Win32::Foundation::HWND;
    if !runbi_hwnd.is_null() {
        // WebView2 can return a child HWND whose process/root metadata differs
        // from the Tauri host. Walk parent/owner links and compare the actual
        // registered Runbi host handle before falling back to PID checks.
        let mut current = hwnd;
        for _ in 0..16 {
            if current == runbi_hwnd {
                return true;
            }
            let parent = GetParent(current);
            let owner = GetWindow(current, GW_OWNER);
            current = if !parent.is_null() {
                parent
            } else if !owner.is_null() {
                owner
            } else {
                break;
            };
        }
    }
    // WindowFromPoint may return either the WebView2 child or the Tauri host.
    // Check both root variants; using only GA_ROOT misclassified capsule
    // clicks on some WebView2 builds and dismissed the window before its DOM
    // handler could run.
    let candidates = [hwnd, GetAncestor(hwnd, GA_ROOT), GetAncestor(hwnd, GA_ROOTOWNER)];
    candidates.iter().any(|candidate| {
        if candidate.is_null() {
            return false;
        }
        let mut pid = 0;
        GetWindowThreadProcessId(*candidate, &mut pid);
        pid == std::process::id()
    })
}

#[cfg(windows)]
fn invalidate_selection(reason: &'static str) -> u64 {
    let generation = SELECTION_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    if let Some((_, app)) = MONITOR_STATE.get() {
        let app_handle = app.clone();
        let started = std::time::Instant::now();
        // Never call blocking window operations from a low-level hook.
        let _ = app.run_on_main_thread(move || {
                let active = CAPSULE_GENERATION.load(Ordering::SeqCst);
                if active < generation {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let result = dismiss_native_capsule(&window, active);
                        crate::commands::file_log(&app_handle, &format!(
                            "capsule dismiss: reason={reason} generation={active} event={generation} elapsed_ms={} hidden={} error={:?}",
                            started.elapsed().as_millis(), !window.is_visible().unwrap_or(true), result.err()
                        ));
                    }
                } else if active == NO_CAPSULE
                    && OUTSIDE_DISMISS_GENERATION.load(Ordering::SeqCst) == generation
                {
                    // The low-level hook hides immediately, but keep a main-thread
                    // fallback for WebView hosts that ignore ShowWindow from the hook
                    // thread. The generation check prevents this late callback from
                    // hiding a newer capsule or an expanded panel.
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let result = window.hide();
                        crate::commands::file_log(&app_handle, &format!(
                            "capsule dismiss fallback: reason={reason} generation={generation} hidden={} error={:?}",
                            !window.is_visible().unwrap_or(true), result.err()
                        ));
                    }
                }
                let _ = app_handle.emit("runbi://selection-invalidated", generation);
            });
    }
    generation
}

#[cfg(windows)]
unsafe extern "system" fn low_level_keyboard_proc(
    n_code: i32,
    w_param: usize,
    l_param: isize,
) -> isize {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetForegroundWindow, KBDLLHOOKSTRUCT, LLKHF_INJECTED, WM_KEYDOWN,
        WM_SYSKEYDOWN,
    };
    if n_code >= 0 && (w_param == WM_KEYDOWN as usize || w_param == WM_SYSKEYDOWN as usize) {
        let event = &*(l_param as *const KBDLLHOOKSTRUCT);
        // Ignore injected Ctrl+C and bare modifiers; the source app owns focus
        // while the capsule is visible, so DOM keydown/blur cannot observe these.
        let modifier = matches!(event.vkCode, 0x10..=0x12 | 0x5B..=0x5C | 0xA0..=0xA5);
        if event.flags & LLKHF_INJECTED == 0
            && CAPSULE_GENERATION.load(Ordering::SeqCst) == NO_CAPSULE
            && !modifier
            && !is_runbi_window(GetForegroundWindow())
        {
            clear_outside_dismissal();
            invalidate_selection("keyboard");
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
        CallNextHookEx, WindowFromPoint, LLMHF_INJECTED, MSLLHOOKSTRUCT, WM_LBUTTONDOWN,
        WM_LBUTTONUP, WM_MBUTTONDOWN, WM_RBUTTONDOWN,
    };

    if n_code >= 0 {
        let hook_struct = *(l_param as *const MSLLHOOKSTRUCT);
        let pt = hook_struct.pt;
        let now = current_time_ms();

        if CAPSULE_GENERATION.load(Ordering::SeqCst) != NO_CAPSULE
            && matches!(w_param as u32, WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN) {
            if let Some((_, app)) = MONITOR_STATE.get() {
                let active = CAPSULE_GENERATION.load(Ordering::SeqCst);
                let injected = hook_struct.flags & LLMHF_INJECTED != 0;
                let inside = is_runbi_window(WindowFromPoint(pt));
                let app_handle = app.clone();
                // File IO stays off the low-level hook thread.
                let _ = app.run_on_main_thread(move || {
                    crate::commands::file_log(&app_handle, &format!(
                        "capsule pointer-down: active={active} inside={inside} injected={injected}"
                    ));
                });
            }
        }

        if matches!(
            w_param as u32,
            WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN
        ) {
            // Keep actions inside Runbi alive; every outside press invalidates
            // the selection, independently of whether its release selects text.
            let capsule_active = CAPSULE_GENERATION.load(Ordering::SeqCst) != NO_CAPSULE;
            let capsule_visible = capsule_active || visible_capsule_window();
            let outside_runbi = if capsule_visible {
                // WebView2 can deliver the hit to a child HWND while the
                // capsule geometry belongs to the Tauri host. Treat either
                // representation as an internal click so copy/action buttons
                // are not dismissed before their DOM handler runs.
                !(point_inside_runbi_window(pt) || is_runbi_window(WindowFromPoint(pt)))
            } else {
                !is_runbi_window(WindowFromPoint(pt))
            };
            if w_param == WM_LBUTTONDOWN as usize {
                if let Some((_, app)) = MONITOR_STATE.get() {
                    let app_handle = app.clone();
                    let auto_popup = MONITOR_STATE
                        .get()
                        .map(|(state, _)| state.auto_popup.load(Ordering::Relaxed))
                        .unwrap_or(false);
                    let _ = app.run_on_main_thread(move || {
                        crate::commands::file_log(&app_handle, &format!(
                            "selection pointer-down: active={capsule_active} outside={outside_runbi} auto_popup={auto_popup}"
                        ));
                    });
                }
            }
            if w_param == WM_LBUTTONDOWN as usize {
                if capsule_visible && outside_runbi {
                    // A blank click dismisses the current capsule. Give any
                    // already queued clipboard/UIA capture a short grace
                    // period so it cannot resurrect the same capsule.
                    CAPSULE_GENERATION.store(NO_CAPSULE, Ordering::SeqCst);
                    OUTSIDE_DISMISS_UNTIL_MS.store(
                        now.saturating_add(OUTSIDE_DISMISS_GRACE_MS),
                        Ordering::Relaxed,
                    );
                    DISMISS_NEXT_SELECTION_UNTIL_MS.store(
                        now.saturating_add(500),
                        Ordering::Relaxed,
                    );
                    OUTSIDE_DISMISS_LOCKED.store(true, Ordering::SeqCst);
                    hide_runbi_window_now();
                }
                DOWN_STARTED_INSIDE_CAPSULE.store(
                    !outside_runbi && capsule_visible,
                    Ordering::Relaxed,
                );
            }
            if outside_runbi {
                let invalidated_generation = invalidate_selection("outside-pointer-down");
                if capsule_visible {
                    OUTSIDE_DISMISS_GENERATION.store(invalidated_generation, Ordering::SeqCst);
                }
            }
        }

        // Fallback for environments that deliver the release without the
        // corresponding low-level press: an outside release still closes the
        // visible capsule and must not become a new selection.
        let inside_runbi_window = point_inside_runbi_window(pt)
            || is_runbi_window(WindowFromPoint(pt));
        if w_param == WM_LBUTTONUP as usize
            && CAPSULE_GENERATION.load(Ordering::SeqCst) != NO_CAPSULE
            && !inside_runbi_window
        {
            CAPSULE_GENERATION.store(NO_CAPSULE, Ordering::SeqCst);
            OUTSIDE_DISMISS_UNTIL_MS.store(
                now.saturating_add(OUTSIDE_DISMISS_GRACE_MS),
                Ordering::Relaxed,
            );
            hide_runbi_window_now();
            let invalidated_generation = invalidate_selection("outside-pointer-up");
            OUTSIDE_DISMISS_GENERATION.store(invalidated_generation, Ordering::SeqCst);
            OUTSIDE_DISMISS_LOCKED.store(true, Ordering::SeqCst);
            DOWN_STARTED_INSIDE_CAPSULE.store(false, Ordering::Relaxed);
        }

        // Outside clicks dismiss even when generated by accessibility/remote
        // input. Only automatic text capture excludes injected mouse input.
        if hook_struct.flags & LLMHF_INJECTED != 0 {
            return CallNextHookEx(std::ptr::null_mut(), n_code, w_param, l_param);
        }

        if w_param == WM_LBUTTONDOWN as usize {
            LAST_DOWN_X.store(pt.x, Ordering::Relaxed);
            LAST_DOWN_Y.store(pt.y, Ordering::Relaxed);
        } else if w_param == WM_LBUTTONUP as usize {
            let down_x = LAST_DOWN_X.load(Ordering::Relaxed);
            let down_y = LAST_DOWN_Y.load(Ordering::Relaxed);

            let dx = i64::from(pt.x) - i64::from(down_x);
            let dy = i64::from(pt.y) - i64::from(down_y);
            let distance_sq = dx * dx + dy * dy;
            let dragged = distance_sq >= 16;
            let started_inside_capsule =
                DOWN_STARTED_INSIDE_CAPSULE.swap(false, Ordering::Relaxed);
            let candidate_selection = !outside_dismiss_blocks_capture(
                dragged,
                now,
                OUTSIDE_DISMISS_UNTIL_MS.load(Ordering::Relaxed),
            ) && should_capture_after_pointer_up(
                // An outside drag that starts while the capsule is visible is
                // a new selection. Only a click/drag that starts inside the
                // capsule belongs to the capsule UI and must not capture.
                started_inside_capsule,
                dragged,
                now,
                LAST_UP_MS.load(Ordering::Relaxed),
                i64::from(pt.x) - i64::from(LAST_UP_X.load(Ordering::Relaxed)),
                i64::from(pt.y) - i64::from(LAST_UP_Y.load(Ordering::Relaxed)),
            );
            let dismiss_suppressed = !dragged
                && candidate_selection
                && dismissal_suppresses_selection(
                    now,
                    DISMISS_NEXT_SELECTION_UNTIL_MS.load(Ordering::Relaxed),
                );
            if dismiss_suppressed {
                DISMISS_NEXT_SELECTION_UNTIL_MS.store(0, Ordering::Relaxed);
            } else if candidate_selection {
                // A real selection after the dismissal window explicitly
                // re-arms automatic capture; delayed clipboard work alone
                // cannot clear this lock.
                OUTSIDE_DISMISS_LOCKED.store(false, Ordering::Relaxed);
                let dismissed_generation = OUTSIDE_DISMISS_GENERATION.swap(0, Ordering::Relaxed);
                if dismissed_generation != 0 {
                    if let Some((_, app)) = MONITOR_STATE.get() {
                        let app_handle = app.clone();
                        let _ = app.run_on_main_thread(move || {
                            crate::commands::file_log(
                                &app_handle,
                                &format!(
                                    "outside-dismiss barrier cleared by new selection generation={dismissed_generation}"
                                ),
                            );
                        });
                    }
                }
            }
            let is_selection_gesture = candidate_selection && !dismiss_suppressed;
            if let Some((_, app)) = MONITOR_STATE.get() {
                let app_handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    crate::commands::file_log(&app_handle, &format!(
                        "selection pointer-up: dragged={dragged} suppress={} dismiss_suppressed={dismiss_suppressed} gesture={is_selection_gesture}",
                        started_inside_capsule
                    ));
                });
            }
            // A click inside the capsule belongs to its UI. An outside drag
            // is allowed to start a new selection immediately.
            LAST_UP_MS.store(if dragged { 0 } else { now }, Ordering::Relaxed);
            LAST_UP_X.store(pt.x, Ordering::Relaxed);
            LAST_UP_Y.store(pt.y, Ordering::Relaxed);

            if is_selection_gesture {
                if let Some((state, app_handle)) = MONITOR_STATE.get() {
                    if should_handle_selection(state) {
                        let app = app_handle.clone();
                        let state_clone = state.clone();
                        let generation = SELECTION_GENERATION.load(Ordering::SeqCst);

                        // Trigger grab asynchronously
                        tauri::async_runtime::spawn(async move {
                            // The low-level hook sees mouse-up before the target control does.
                            // Let it commit the selection before sending Ctrl+C.
                            tokio::time::sleep(Duration::from_millis(30)).await;
                            if generation != SELECTION_GENERATION.load(Ordering::SeqCst)
                                || !should_handle_selection(&state_clone)
                            {
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
                            crate::commands::input::remember_foreground_window();
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
                                        eprintln!("[Runbi] selection dropped: grab returned none");
                                        return;
                                    }
                                };

                            if generation != SELECTION_GENERATION.load(Ordering::SeqCst) {
                                return;
                            }
                            if outside_dismiss_blocks_capture(
                                dragged,
                                current_time_ms(),
                                OUTSIDE_DISMISS_UNTIL_MS.load(Ordering::Relaxed),
                            ) {
                                crate::commands::file_log(
                                    &app,
                                    &format!("selection capture skipped: outside-dismiss grace dragged={dragged}"),
                                );
                                return;
                            }
                            let trimmed = captured_text.trim();
                            if trimmed.is_empty()
                                || trimmed.len() > 30000
                                || crate::commands::clipboard_monitor::is_sensitive_or_password(
                                    trimmed,
                                )
                            {
                                eprintln!(
                                    "[Runbi] selection dropped: empty/sensitive/oversize len={}",
                                    trimmed.len()
                                );
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
                                        crate::commands::position::position_window_at_point(
                                            window.clone(),
                                            true,
                                            pt.x,
                                            pt.y,
                                        )
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
                                        if !show_native_capsule(&window, generation)
                                            .unwrap_or(false)
                                        {
                                            return;
                                        }
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

    CallNextHookEx(std::ptr::null_mut(), n_code, w_param, l_param)
}

pub fn start_mouse_selection_monitor(app: &AppHandle, state: SelectionMonitorState) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage, MSG,
            WH_KEYBOARD_LL, WH_MOUSE_LL,
        };

        if MONITOR_STATE.set((state, app.clone())).is_err() {
            return;
        }

        // Run hook message pump in dedicated OS thread.
        let log_app = app.clone();
        std::thread::spawn(move || unsafe {
            let hook = SetWindowsHookExW(
                WH_MOUSE_LL,
                Some(low_level_mouse_proc),
                std::ptr::null_mut(),
                0,
            );

            if hook.is_null() {
                eprintln!("[Runbi] Failed to install global mouse selection hook");
                crate::commands::file_log(&log_app, "selection hook install FAILED");
                return;
            }
            crate::commands::file_log(&log_app, "selection hook installed");

            let keyboard_hook = SetWindowsHookExW(
                WH_KEYBOARD_LL,
                Some(low_level_keyboard_proc),
                std::ptr::null_mut(),
                0,
            );
            if keyboard_hook.is_null() {
                eprintln!("[Runbi] Failed to install selection dismissal keyboard hook");
                crate::commands::file_log(&log_app, "keyboard dismissal hook install FAILED");
            } else {
                crate::commands::file_log(&log_app, "keyboard dismissal hook installed");
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
    fn clicking_elsewhere_after_selection_does_not_start_another_capture() {
        use super::{
            dismissal_suppresses_selection, is_selection_gesture, outside_dismiss_blocks_capture,
            should_capture_after_pointer_up,
            should_skip_capsule_show_due_to_dismissal,
        };
        assert!(is_selection_gesture(true, 1000, 0, 0, 0));
        // A drag clears previous_click, including when clicking near its end.
        assert!(!should_capture_after_pointer_up(true, false, 1100, 1000, 0, 0));
        assert!(!should_capture_after_pointer_up(true, true, 1100, 1000, 40, 0));
        assert!(should_capture_after_pointer_up(false, true, 1100, 1000, 40, 0));
        assert!(!is_selection_gesture(false, 1100, 0, 0, 0));
        assert!(!is_selection_gesture(false, 1200, 1100, 100, 0));
        assert!(!is_selection_gesture(false, 1200, 1100, 0, 100));
        assert!(is_selection_gesture(false, 1200, 1100, 2, 2));
        assert!(!is_selection_gesture(false, 1600, 1100, 2, 2));
        assert!(outside_dismiss_blocks_capture(false, 1100, 1200));
        assert!(!outside_dismiss_blocks_capture(true, 1100, 1200));
        assert!(!outside_dismiss_blocks_capture(false, 1300, 1200));
        assert!(dismissal_suppresses_selection(1100, 1500));
        assert!(!dismissal_suppresses_selection(1500, 1500));
        // A race cannot bypass dismissal by assigning a newer generation, even
        // after the old short grace period has elapsed.
        assert!(should_skip_capsule_show_due_to_dismissal(1201, 1200, 1100, 1200));
        assert!(should_skip_capsule_show_due_to_dismissal(1201, 1200, 1300, 1200));
    }

    #[test]
    fn repeated_dismissal_rejects_stale_hides_and_preserves_panels() {
        use super::{take_capsule, AtomicU64, NO_CAPSULE};
        let active = AtomicU64::new(NO_CAPSULE);
        for generation in 0..1000 {
            active.store(generation, Ordering::SeqCst);
            assert!(take_capsule(&active, generation));
            assert!(!take_capsule(&active, generation));
            active.store(generation + 1, Ordering::SeqCst);
            assert!(!take_capsule(&active, generation));
            assert_eq!(active.load(Ordering::SeqCst), generation + 1);
            active.store(NO_CAPSULE, Ordering::SeqCst); // expanded panel
            assert!(!take_capsule(&active, generation + 1));
            assert!(!take_capsule(&active, NO_CAPSULE));
        }
    }

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
        // 换了新文本立即可弹；同一 generation 的重复生产者仍被挡。
        let c = should_pop_once("different text");
        assert!(a && !b && c);
    }
}
