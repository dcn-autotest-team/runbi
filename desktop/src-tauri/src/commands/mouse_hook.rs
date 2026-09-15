//! Global Low-Level Mouse Hook for Automatic Text Selection Popup
//! Listens for mouse drag-selection or double-click text selection across all desktop applications
//! (similar to Doubao / Cherry Studio / PopClip / Bob), captures selected text, and pops up Runbi.

use std::sync::atomic::{AtomicBool, AtomicI32, AtomicIsize, AtomicU64, AtomicUsize, Ordering};
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
            auto_popup: Arc::new(AtomicBool::new(true)),
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
const CAPSULE_CLICK_DISMISS_DELAY_MS: u64 = 700;
const INTERNAL_KEYBOARD_GRACE_ACTIVE_MS: u64 = 500;
const INTERNAL_KEYBOARD_GRACE_RELEASE_MS: u64 = 220;
pub static CAPSULE_GENERATION: AtomicU64 = AtomicU64::new(NO_CAPSULE);

#[cfg(windows)]
static INTERNAL_KEYBOARD_GRACE_UNTIL_MS: AtomicU64 = AtomicU64::new(0);
#[cfg(windows)]
static PENDING_SELECTION_CAPTURES: AtomicUsize = AtomicUsize::new(0);
#[cfg(windows)]
static CAPSULE_LEFT: AtomicI32 = AtomicI32::new(0);
#[cfg(windows)]
static CAPSULE_TOP: AtomicI32 = AtomicI32::new(0);
#[cfg(windows)]
static CAPSULE_WIDTH: AtomicI32 = AtomicI32::new(0);
#[cfg(windows)]
static CAPSULE_HEIGHT: AtomicI32 = AtomicI32::new(0);

pub fn leave_capsule_mode() {
    CAPSULE_GENERATION.store(NO_CAPSULE, Ordering::SeqCst);
    clear_capsule_bounds();
}

#[cfg(windows)]
pub fn set_capsule_bounds(bounds: Option<(i32, i32, i32, i32)>) {
    let (left, top, width, height) = bounds.unwrap_or((0, 0, 0, 0));
    CAPSULE_LEFT.store(left, Ordering::Relaxed);
    CAPSULE_TOP.store(top, Ordering::Relaxed);
    CAPSULE_WIDTH.store(width.max(0), Ordering::Relaxed);
    CAPSULE_HEIGHT.store(height.max(0), Ordering::Relaxed);
}

#[cfg(not(windows))]
pub fn set_capsule_bounds(_bounds: Option<(i32, i32, i32, i32)>) {}

#[cfg(windows)]
fn clear_capsule_bounds() {
    set_capsule_bounds(None);
}

#[cfg(not(windows))]
fn clear_capsule_bounds() {}

#[cfg(windows)]
unsafe fn current_capsule_bounds() -> Option<(i32, i32, i32, i32)> {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowRect;

    let hwnd = RUNBI_WINDOW_HANDLE.load(Ordering::SeqCst)
        as windows_sys::Win32::Foundation::HWND;
    if hwnd.is_null() {
        return None;
    }
    let mut rect = std::mem::zeroed::<windows_sys::Win32::Foundation::RECT>();
    if GetWindowRect(hwnd, &mut rect) == 0 {
        return None;
    }
    let width = rect.right.saturating_sub(rect.left);
    let height = rect.bottom.saturating_sub(rect.top);
    (is_capsule_rect(width, height))
        .then_some((rect.left, rect.top, width, height))
}

#[cfg(windows)]
fn is_capsule_rect(width: i32, height: i32) -> bool {
    // Exclude the 18x18 Tauri helper HWND and the restored panel. The lower
    // bound also prevents an unrelated tiny child window from becoming an
    // action target during a capsule click.
    (100..=500).contains(&width) && (20..=160).contains(&height)
}

#[cfg(windows)]
fn stored_capsule_bounds() -> (i32, i32, i32, i32) {
    (
        CAPSULE_LEFT.load(Ordering::Relaxed),
        CAPSULE_TOP.load(Ordering::Relaxed),
        CAPSULE_WIDTH.load(Ordering::Relaxed),
        CAPSULE_HEIGHT.load(Ordering::Relaxed),
    )
}

#[cfg(windows)]
fn capsule_bounds_for_pointer() -> (i32, i32, i32, i32) {
    // The host rect is authoritative after show/activation; the stored rect
    // is only a fallback for the short interval before Win32 exposes it.
    unsafe { current_capsule_bounds() }.unwrap_or_else(stored_capsule_bounds)
}

#[cfg(windows)]
unsafe fn capsule_bounds_at_point(
    pt: windows_sys::Win32::Foundation::POINT,
) -> Option<(i32, i32, i32, i32)> {
    use windows_sys::Win32::Foundation::{BOOL, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetParent, GetWindow, GetWindowRect, GetWindowThreadProcessId,
        WindowFromPoint, GW_OWNER,
    };

    let contains = |rect: &windows_sys::Win32::Foundation::RECT| {
        pt.x >= rect.left
            && pt.x < rect.right
            && pt.y >= rect.top
            && pt.y < rect.bottom
    };
    let as_capsule = |rect: windows_sys::Win32::Foundation::RECT| {
        let width = rect.right.saturating_sub(rect.left);
        let height = rect.bottom.saturating_sub(rect.top);
        (is_capsule_rect(width, height) && contains(&rect))
            .then_some((rect.left, rect.top, width, height))
    };

    // The host rectangle is authoritative. The window manager can move or
    // resize it after the positioning command returns (DPI/frame activation),
    // so never let an older cached rectangle win a hit test.
    if let Some((left, top, width, height)) = current_capsule_bounds() {
        if pt.x >= left
            && pt.x < left.saturating_add(width)
            && pt.y >= top
            && pt.y < top.saturating_add(height)
        {
            return Some((left, top, width, height));
        }
    }

    // Fallback for the short interval before GetWindowRect exposes the new
    // visible rectangle.
    let (stored_left, stored_top, stored_width, stored_height) = stored_capsule_bounds();
    if is_capsule_rect(stored_width, stored_height)
        && pt.x >= stored_left
        && pt.x < stored_left.saturating_add(stored_width)
        && pt.y >= stored_top
        && pt.y < stored_top.saturating_add(stored_height)
    {
        return Some((stored_left, stored_top, stored_width, stored_height));
    }

    // WindowFromPoint may return the WebView2 child rather than the Tauri
    // host. Walk parent/owner links and use the first capsule-sized rectangle
    // that actually contains the pointer.
    let mut hwnd = WindowFromPoint(pt);
    for _ in 0..16 {
        if hwnd.is_null() {
            break;
        }
        let mut rect = std::mem::zeroed::<windows_sys::Win32::Foundation::RECT>();
        if GetWindowRect(hwnd, &mut rect) != 0 {
            if let Some(bounds) = as_capsule(rect) {
                return Some(bounds);
            }
        }
        let parent = GetParent(hwnd);
        let owner = GetWindow(hwnd, GW_OWNER);
        hwnd = if !parent.is_null() {
            parent
        } else if !owner.is_null() {
            owner
        } else {
            break;
        };
    }

    // A WebView2 resize can briefly leave the hit-test child disconnected from
    // the host's parent chain. Look for this process's real capsule-sized top-
    // level window as a last native fallback.
    struct Hit {
        point: windows_sys::Win32::Foundation::POINT,
        bounds: Option<(i32, i32, i32, i32)>,
    }
    unsafe extern "system" fn visit(
        hwnd: windows_sys::Win32::Foundation::HWND,
        lparam: LPARAM,
    ) -> BOOL {
        let hit = &mut *(lparam as *mut Hit);
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid != std::process::id() {
            return 1;
        }
        let mut rect = std::mem::zeroed::<windows_sys::Win32::Foundation::RECT>();
        if GetWindowRect(hwnd, &mut rect) == 0 {
            return 1;
        }
        let width = rect.right.saturating_sub(rect.left);
        let height = rect.bottom.saturating_sub(rect.top);
        if is_capsule_rect(width, height)
            && hit.point.x >= rect.left
            && hit.point.x < rect.right
            && hit.point.y >= rect.top
            && hit.point.y < rect.bottom
        {
            hit.bounds = Some((rect.left, rect.top, width, height));
            return 0;
        }
        1
    }
    let mut hit = Hit {
        point: pt,
        bounds: None,
    };
    EnumWindows(Some(visit), &mut hit as *mut Hit as LPARAM);
    hit.bounds
}

#[cfg(windows)]
fn point_inside_capsule_bounds(pt: windows_sys::Win32::Foundation::POINT) -> bool {
    unsafe { capsule_bounds_at_point(pt).is_some() }
}

#[cfg(windows)]
fn capsule_action_for_geometry(x: i32, left: i32, width: i32) -> Option<&'static str> {
    if width <= 0 || x < left || x >= left.saturating_add(width) {
        return None;
    }
    let index = (((i64::from(x) - i64::from(left)) * 5) / i64::from(width)) as usize;
    Some(match index {
        0 => "search",
        1 => "polish",
        2 => "reply",
        3 => "translate",
        4 => "copy",
        _ => return None,
    })
}

#[cfg(windows)]
fn capsule_action_for_point(pt: windows_sys::Win32::Foundation::POINT) -> Option<&'static str> {
    let (left, _top, width, _height) = unsafe { capsule_bounds_at_point(pt) }?;
    capsule_action_for_geometry(pt.x, left, width)
}

#[cfg(windows)]
fn emit_capsule_action(action: &'static str, generation: u64) {
    if let Some((_, app)) = MONITOR_STATE.get() {
        let app_handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            crate::commands::file_log(
                &app_handle,
                &format!("native capsule action: action={action} generation={generation}"),
            );
            let _ = app_handle.emit(
                "runbi://capsule-action",
                serde_json::json!({ "action": action, "generation": generation }),
            );
        });
    }
}

/// SendInput keyboard notifications can arrive after the caller has already
/// cleared its internal-action flag. Keep keyboard invalidation suppressed for
/// that short delivery tail, otherwise simulated Ctrl+C cancels the selection
/// it was meant to capture.
pub fn note_internal_keyboard_activity(active: bool) {
    #[cfg(windows)]
    {
        let duration = if active {
            INTERNAL_KEYBOARD_GRACE_ACTIVE_MS
        } else {
            INTERNAL_KEYBOARD_GRACE_RELEASE_MS
        };
        let until = current_time_ms().saturating_add(duration);
        INTERNAL_KEYBOARD_GRACE_UNTIL_MS.fetch_max(until, Ordering::Relaxed);
    }
    #[cfg(not(windows))]
    let _ = active;
}

#[cfg(windows)]
struct PendingSelectionCaptureGuard;

#[cfg(windows)]
impl Drop for PendingSelectionCaptureGuard {
    fn drop(&mut self) {
        PENDING_SELECTION_CAPTURES.fetch_sub(1, Ordering::Relaxed);
    }
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
        clear_capsule_bounds();
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
    // The transparent host can receive a final DPI/frame adjustment during
    // show/unminimize. Refresh the hit rectangle only after that adjustment;
    // the pre-show geometry is not authoritative for mouse-hook hit testing.
    if let (Ok(position), Ok(size)) = (window.outer_position(), window.outer_size()) {
        crate::commands::mouse_hook::set_capsule_bounds(Some((
            position.x,
            position.y,
            size.width as i32,
            size.height as i32,
        )));
        crate::commands::file_log(
            window.app_handle(),
            &format!(
                "capsule bounds shown: actual=({}, {}) size={}x{}",
                position.x, position.y, size.width, size.height
            ),
        );
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

fn should_defer_capsule_dismissal(capsule_active: bool, outside: bool, dragged: bool) -> bool {
    capsule_active && outside && !dragged
}

fn should_invalidate_keyboard(
    injected: bool,
    capsule_active: bool,
    modifier: bool,
    inside_runbi: bool,
    internal_action: bool,
) -> bool {
    !injected && !capsule_active && !modifier && !inside_runbi && !internal_action
}

#[cfg(windows)]
fn schedule_capsule_click_dismissal(generation: u64) {
    // The low-level hook can misidentify a WebView2 child HWND as external.
    // Give the DOM pointer/mouse handlers enough time to clear the capsule
    // generation before treating the release as a real outside click.
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(CAPSULE_CLICK_DISMISS_DELAY_MS));
        if CAPSULE_GENERATION
            .compare_exchange(
                generation,
                NO_CAPSULE,
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_err()
        {
            return;
        }
        unsafe { hide_runbi_window_now(); }
        let invalidated_generation = invalidate_selection("outside-pointer-up");
        OUTSIDE_DISMISS_UNTIL_MS.store(
            current_time_ms().saturating_add(OUTSIDE_DISMISS_GRACE_MS),
            Ordering::Relaxed,
        );
        OUTSIDE_DISMISS_GENERATION.store(invalidated_generation, Ordering::SeqCst);
        OUTSIDE_DISMISS_LOCKED.store(true, Ordering::SeqCst);
    });
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
                crate::commands::file_log(
                    &app_handle,
                    &format!("selection invalidated: reason={reason} generation={generation}"),
                );
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
        let internal_action = MONITOR_STATE
            .get()
            .map(|(state, _)| state.is_internal_action.load(Ordering::Relaxed))
            .unwrap_or(false);
        let internal_keyboard_grace = {
            #[cfg(windows)]
            {
                current_time_ms() < INTERNAL_KEYBOARD_GRACE_UNTIL_MS.load(Ordering::Relaxed)
            }
            #[cfg(not(windows))]
            {
                false
            }
        };
        let selection_capture_pending = {
            #[cfg(windows)]
            {
                PENDING_SELECTION_CAPTURES.load(Ordering::Relaxed) != 0
            }
            #[cfg(not(windows))]
            {
                false
            }
        };
        if should_invalidate_keyboard(
            event.flags & LLKHF_INJECTED != 0,
            CAPSULE_GENERATION.load(Ordering::SeqCst) != NO_CAPSULE,
            modifier,
            is_runbi_window(GetForegroundWindow()),
            internal_action || internal_keyboard_grace || selection_capture_pending,
        ) {
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
                let inside = point_inside_capsule_bounds(pt)
                    || is_runbi_window(WindowFromPoint(pt));
                let (left, top, width, height) = capsule_bounds_for_pointer();
                let app_handle = app.clone();
                // File IO stays off the low-level hook thread.
                let _ = app.run_on_main_thread(move || {
                    crate::commands::file_log(&app_handle, &format!(
                        "capsule pointer-down: active={active} pt=({}, {}) bounds=({}, {}, {}x{}) inside={inside} injected={injected}",
                        pt.x, pt.y, left, top, width, height
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
            let capsule_hit = capsule_active && point_inside_capsule_bounds(pt);
            let outside_runbi = if capsule_visible {
                // WebView2 can deliver the hit to a child HWND while the
                // capsule geometry belongs to the Tauri host. Treat either
                // representation as an internal click so copy/action buttons
                // are not dismissed before their DOM handler runs.
                !(capsule_hit
                    || point_inside_runbi_window(pt)
                    || is_runbi_window(WindowFromPoint(pt)))
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
                if capsule_hit {
                    DOWN_STARTED_INSIDE_CAPSULE.store(true, Ordering::Relaxed);
                }
                // If the user switched to another app while the Runbi panel stayed
                // open, the low-level hook still sees that app as foreground before
                // Windows focuses the clicked Runbi button. Keep paste/send aimed at
                // the app the user just left instead of an older selection target.
                if !outside_runbi {
                    crate::commands::input::remember_foreground_window();
                }
                // Defer dismissal while a capsule is active. The hook sees
                // mouse-down before the WebView can deliver the button's DOM
                // click; hiding here can swallow the action on DPI/WebView
                // combinations where the hit-test briefly misses the host.
                if capsule_visible && outside_runbi && !capsule_active {
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
            if outside_runbi && !capsule_active {
                let invalidated_generation = invalidate_selection("outside-pointer-down");
                if capsule_visible {
                    OUTSIDE_DISMISS_GENERATION.store(invalidated_generation, Ordering::SeqCst);
                }
            }
        }

        // Fallback for environments that deliver the release without the
        // corresponding low-level press: an outside release still closes the
        // visible capsule and must not become a new selection.
        let inside_runbi_window = point_inside_capsule_bounds(pt)
            || point_inside_runbi_window(pt)
            || is_runbi_window(WindowFromPoint(pt));
        if w_param == WM_LBUTTONUP as usize
            && CAPSULE_GENERATION.load(Ordering::SeqCst) != NO_CAPSULE
            && !inside_runbi_window
        {
            let active_generation = CAPSULE_GENERATION.load(Ordering::SeqCst);
            let down_x = LAST_DOWN_X.load(Ordering::Relaxed);
            let down_y = LAST_DOWN_Y.load(Ordering::Relaxed);
            let dx = i64::from(pt.x) - i64::from(down_x);
            let dy = i64::from(pt.y) - i64::from(down_y);
            let dragged = dx * dx + dy * dy >= 16;
            if should_defer_capsule_dismissal(true, true, dragged) {
                // Prevent the ordinary click from becoming a double-click
                // selection while the delayed dismissal is pending.
                OUTSIDE_DISMISS_UNTIL_MS.store(
                    now.saturating_add(OUTSIDE_DISMISS_GRACE_MS),
                    Ordering::Relaxed,
                );
                DISMISS_NEXT_SELECTION_UNTIL_MS.store(
                    now.saturating_add(500),
                    Ordering::Relaxed,
                );
                schedule_capsule_click_dismissal(active_generation);
            } else {
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

            // Do not resize the native window from WM_LBUTTONDOWN: WebView2
            // still needs that press to finish its click. Emit one native
            // action after the release instead, using the original button
            // position so a tiny pointer drift cannot select another action.
            if started_inside_capsule && !dragged {
                if let Some(action) = capsule_action_for_point(windows_sys::Win32::Foundation::POINT {
                    x: down_x,
                    y: down_y,
                }) {
                    emit_capsule_action(action, CAPSULE_GENERATION.load(Ordering::SeqCst));
                }
            }
            if let Some((_, app)) = MONITOR_STATE.get() {
                let app_handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    crate::commands::file_log(&app_handle, &format!(
                        "selection pointer-up: pt=({}, {}) down=({}, {}) dragged={dragged} started_inside_capsule={started_inside_capsule} candidate={candidate_selection} dismiss_suppressed={dismiss_suppressed} gesture={is_selection_gesture}",
                        pt.x, pt.y, down_x, down_y,
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
                        #[cfg(windows)]
                        PENDING_SELECTION_CAPTURES.fetch_add(1, Ordering::Relaxed);
                        tauri::async_runtime::spawn(async move {
                            #[cfg(windows)]
                            let _pending_capture = PendingSelectionCaptureGuard;
                            // The low-level hook sees mouse-up before the target control does.
                            // Let it commit the selection before sending Ctrl+C.
                            tokio::time::sleep(Duration::from_millis(30)).await;
                            if generation != SELECTION_GENERATION.load(Ordering::SeqCst)
                                || !should_handle_selection(&state_clone)
                            {
                                crate::commands::file_log(
                                    &app,
                                    &format!(
                                        "selection capture canceled before grab: generation={} current={} enabled={} auto_popup={} internal={}",
                                        generation,
                                        SELECTION_GENERATION.load(Ordering::SeqCst),
                                        state_clone.enabled.load(Ordering::Relaxed),
                                        state_clone.auto_popup.load(Ordering::Relaxed),
                                        state_clone.is_internal_action.load(Ordering::Relaxed),
                                    ),
                                );
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
                                            crate::commands::file_log(
                                                &app,
                                                "selection capture skipped: pointer still inside Runbi window",
                                            );
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
                                        crate::commands::file_log(
                                            &app,
                                            "selection dropped: grab returned none",
                                        );
                                        return;
                                    }
                                };

                            if generation != SELECTION_GENERATION.load(Ordering::SeqCst) {
                                crate::commands::file_log(
                                    &app,
                                    &format!(
                                        "selection capture canceled after grab: generation={} current={}",
                                        generation,
                                        SELECTION_GENERATION.load(Ordering::SeqCst),
                                    ),
                                );
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
                                crate::commands::file_log(
                                    &app,
                                    &format!("selection dropped: empty/sensitive/oversize len={}", trimmed.len()),
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
                                    let _ = app.run_on_main_thread(move || {
                                        if !show_native_capsule(&window, generation)
                                            .unwrap_or(false)
                                        {
                                            return;
                                        }
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
                            } else {
                                crate::commands::file_log(
                                    &app,
                                    &format!(
                                        "selection popup skipped: should_popup={} text_len={}",
                                        should_popup,
                                        trimmed.len(),
                                    ),
                                );
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
    if let Some((_, app)) = MONITOR_STATE.get() {
        let app_handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            crate::commands::file_log(&app_handle, &format!("set_auto_popup_enabled: {enabled}"));
        });
    }
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
    fn capsule_button_click_is_deferred_but_drag_dismissal_is_immediate() {
        use super::should_defer_capsule_dismissal;

        assert!(should_defer_capsule_dismissal(true, true, false));
        assert!(!should_defer_capsule_dismissal(true, true, true));
        assert!(!should_defer_capsule_dismissal(false, true, false));
        assert!(!should_defer_capsule_dismissal(true, false, false));
    }

    #[cfg(windows)]
    #[test]
    fn native_capsule_action_mapping_matches_left_to_right_buttons() {
        use super::capsule_action_for_geometry;

        assert_eq!(capsule_action_for_geometry(100, 100, 200), Some("search"));
        assert_eq!(capsule_action_for_geometry(139, 100, 200), Some("search"));
        assert_eq!(capsule_action_for_geometry(140, 100, 200), Some("polish"));
        assert_eq!(capsule_action_for_geometry(179, 100, 200), Some("polish"));
        assert_eq!(capsule_action_for_geometry(180, 100, 200), Some("reply"));
        assert_eq!(capsule_action_for_geometry(220, 100, 200), Some("translate"));
        assert_eq!(capsule_action_for_geometry(259, 100, 200), Some("translate"));
        assert_eq!(capsule_action_for_geometry(260, 100, 200), Some("copy"));
        assert_eq!(capsule_action_for_geometry(299, 100, 200), Some("copy"));
        assert_eq!(capsule_action_for_geometry(300, 100, 0), None);
        assert_eq!(capsule_action_for_geometry(99, 100, 200), None);
        assert_eq!(capsule_action_for_geometry(300, 100, 200), None);
    }

    #[cfg(windows)]
    #[test]
    fn capsule_rect_filter_excludes_helper_and_restored_panel() {
        use super::is_capsule_rect;

        assert!(!is_capsule_rect(18, 18));
        assert!(!is_capsule_rect(560, 520));
        assert!(is_capsule_rect(235, 53));
    }

    #[test]
    fn internal_keyboard_injection_does_not_cancel_selection_capture() {
        use super::should_invalidate_keyboard;

        assert!(!should_invalidate_keyboard(false, false, false, false, true));
        assert!(!should_invalidate_keyboard(true, false, false, false, false));
        assert!(should_invalidate_keyboard(false, false, false, false, false));
    }

    #[test]
    fn automatic_selection_popup_is_opt_in_and_obeys_internal_guard() {
        let state = SelectionMonitorState::default();
        assert!(should_handle_selection(&state));

        state.auto_popup.store(false, Ordering::Relaxed);
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
