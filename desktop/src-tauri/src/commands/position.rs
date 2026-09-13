//! Multi-Monitor Cursor Positioning and Work Area Clamping
//! Ensures Runbi's floating window is gracefully positioned near the mouse
//! without overflowing outside screen boundaries.

use serde::{Deserialize, Serialize};
use tauri::{LogicalSize, Manager, PhysicalPosition, WebviewWindow};

pub static PANEL_SIZE: std::sync::Mutex<(f64, f64)> = std::sync::Mutex::new((640.0, 580.0));

#[tauri::command]
pub fn record_panel_size(width: f64, height: f64) {
    if width >= 480.0 && height >= 420.0 {
        if let Ok(mut lock) = PANEL_SIZE.lock() {
            *lock = (width, height);
        }
    }
}

#[cfg(windows)]
fn set_capsule_no_activate(window: &WebviewWindow, enabled: bool) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE,
    };
    const WS_EX_TOOLWINDOW: isize = 0x0000_0080;
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0;
    unsafe {
        let current = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        // The capsule must remain a real WebView hit target. WS_EX_NOACTIVATE
        // preserves source-app focus, but on transparent WebView2 windows it
        // can make the native hit-test and DOM mouse dispatch disagree.
        let next = if enabled {
            current | WS_EX_TOOLWINDOW
        } else {
            current & !WS_EX_TOOLWINDOW
        };
        if SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next) == 0 && current != 0 {
            return Err("SetWindowLongPtrW(GWL_EXSTYLE) failed".to_string());
        }
    }
    Ok(())
}

#[cfg(not(windows))]
fn set_capsule_no_activate(_window: &WebviewWindow, _enabled: bool) -> Result<(), String> {
    Ok(())
}

/// Roll back a compact resize when an asynchronous capsule capture becomes
/// stale after positioning but before its native show/emit step.
pub fn restore_panel_window(window: &WebviewWindow) -> Result<(), String> {
    let (w, h) = PANEL_SIZE.lock().map(|s| *s).unwrap_or((640.0, 580.0));
    window
        .set_min_size(Some(LogicalSize::new(480.0, 420.0)))
        .map_err(|e| e.to_string())?;
    window.set_resizable(true).map_err(|e| e.to_string())?;
    window
        .set_size(LogicalSize::new(w, h))
        .map_err(|e| e.to_string())?;
    set_capsule_no_activate(window, false)?;
    let _ = window.set_always_on_top(false);
    Ok(())
}

/// 全局几何写锁:鼠标钩子、复制兜底、剪贴板监听三条路径都会对同一个
/// WebView2 窗口并发做 set_min_size/set_resizable/set_size/set_position/
/// set_always_on_top,交错执行曾触发 WebView2 堆破坏(0xc0000374,8/28 与
/// 8/30 多份 WER 报告)。任何几何修改都必须先拿这把锁,一次做完。
pub static WINDOW_GEOMETRY_LOCK: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

fn acquire_geometry_lock() -> bool {
    WINDOW_GEOMETRY_LOCK
        .compare_exchange(
            false,
            true,
            std::sync::atomic::Ordering::SeqCst,
            std::sync::atomic::Ordering::SeqCst,
        )
        .is_ok()
}

fn release_geometry_lock() {
    WINDOW_GEOMETRY_LOCK.store(false, std::sync::atomic::Ordering::SeqCst);
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PositionResult {
    pub x: i32,
    pub y: i32,
}

/// Place a window of size `w`x`h` near the cursor so it never overlaps the
/// selected text line (cursor row) and never overflows the monitor work area.
///
/// Strategy: prefer the bigger free space of the two sides (above/below the
/// cursor, left/right of the cursor). Falls back to clamping within bounds.
pub fn position_near_cursor(
    cursor_x: i32,
    cursor_y: i32,
    window_w: i32,
    window_h: i32,
    work_w: i32,
    work_h: i32,
    margin: i32,
) -> (i32, i32) {
    // Vertical: put window above if there's more room, else below.
    let space_below = work_h - margin - (cursor_y + margin);
    let space_above = cursor_y - margin;
    let mut target_y = if space_above >= space_below || window_h > space_below {
        // above the cursor line
        cursor_y - window_h - 8
    } else {
        // below the cursor line
        cursor_y + 24
    };

    // Horizontal: put window to the right, or to the left if not enough room.
    let space_right = work_w - margin - (cursor_x + margin);
    let space_left = cursor_x - margin;
    let mut target_x = if space_left >= space_right || window_w > space_right {
        cursor_x - window_w - 12
    } else {
        cursor_x + 12
    };

    // Clamp within work area always.
    if target_x + window_w > work_w - margin {
        target_x = work_w - window_w - margin;
    }
    if target_x < margin {
        target_x = margin;
    }
    if target_y + window_h > work_h - margin {
        target_y = work_h - window_h - margin;
    }
    if target_y < margin {
        target_y = margin;
    }

    (target_x, target_y)
}

#[cfg(windows)]
pub fn get_global_cursor() -> (i32, i32) {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;
    unsafe {
        let mut pt: POINT = std::mem::zeroed();
        if GetCursorPos(&mut pt) != 0 {
            (pt.x, pt.y)
        } else {
            (400, 300)
        }
    }
}

#[cfg(not(windows))]
pub fn get_global_cursor() -> (i32, i32) {
    (400, 300)
}

#[cfg(windows)]
fn cursor_monitor_work_area(cursor_x: i32, cursor_y: i32) -> Option<(i32, i32, i32, i32)> {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };

    unsafe {
        let pt = POINT {
            x: cursor_x,
            y: cursor_y,
        };
        let hmon = MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST);
        if hmon.is_null() {
            return None;
        }
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(hmon, &mut info) == 0 {
            return None;
        }
        Some((
            info.rcWork.left,
            info.rcWork.top,
            info.rcWork.right,
            info.rcWork.bottom,
        ))
    }
}

#[cfg(not(windows))]
fn cursor_monitor_work_area(_x: i32, _y: i32) -> Option<(i32, i32, i32, i32)> {
    None
}

/// Commands to position the window at the current cursor location
#[tauri::command]
pub async fn position_window_at_cursor(
    window: WebviewWindow,
    is_capsule: Option<bool>,
) -> Result<PositionResult, String> {
    let is_capsule = is_capsule.unwrap_or(false);
    position_window_at_point_inner(window, is_capsule, None).await
}

/// Capsule positioning variant that uses the mouse-up point captured by the
/// global hook instead of a later, potentially moved cursor position.
pub async fn position_window_at_point(
    window: WebviewWindow,
    is_capsule: bool,
    cursor_x: i32,
    cursor_y: i32,
) -> Result<PositionResult, String> {
    position_window_at_point_inner(window, is_capsule, Some((cursor_x, cursor_y))).await
}

async fn position_window_at_point_inner(
    window: WebviewWindow,
    is_capsule: bool,
    cursor: Option<(i32, i32)>,
) -> Result<PositionResult, String> {
    if !is_capsule {
        crate::commands::mouse_hook::leave_capsule_mode();
    }

    // 几何写串行化:拿不到锁说明另一条路径正在弹层,直接放弃本次。
    // 晚 20ms 重试一次,再失败就静默丢(旧胶囊还挂着比堆崩溃好得多)。
    if !acquire_geometry_lock() {
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        if !acquire_geometry_lock() {
            return Err("window geometry busy".to_string());
        }
    }

    let result = position_window_at_cursor_locked(&window, is_capsule, cursor).await;
    release_geometry_lock();
    result
}

async fn position_window_at_cursor_locked(
    window: &WebviewWindow,
    is_capsule: bool,
    cursor: Option<(i32, i32)>,
) -> Result<PositionResult, String> {
    let (logical_w, logical_h) = if is_capsule {
        // 196px 五等宽动作条(搜索/润色/回复/翻译/复制)。
        (196.0, 44.0)
    } else {
        PANEL_SIZE.lock().map(|s| *s).unwrap_or((640.0, 580.0))
    };
    // The panel minimum configured at startup used to force the compact capsule
    // back to 480x420, making it look as if the capsule never appeared.
    let min_size = if is_capsule {
        LogicalSize::new(logical_w, logical_h)
    } else {
        LogicalSize::new(480.0, 420.0)
    };
    window
        .set_min_size(Some(min_size))
        .map_err(|e| e.to_string())?;
    window
        .set_resizable(!is_capsule)
        .map_err(|e| e.to_string())?;
    window
        .set_size(LogicalSize::new(logical_w, logical_h))
        .map_err(|e| e.to_string())?;
    // Keep the transient capsule out of the taskbar while allowing its
    // WebView content to receive real pointer input.
    set_capsule_no_activate(window, is_capsule)?;

    let (cursor_x, cursor_y) = cursor.unwrap_or_else(get_global_cursor);

    // Default dimensions
    let (win_w, win_h) = window
        .outer_size()
        .map(|s| (s.width as i32, s.height as i32))
        .unwrap_or((560, 520));

    // Work area of the monitor UNDER THE CURSOR (not the window's stale monitor).
    // Hidden windows have no reliable current_monitor(), which used to clamp the
    // popup to the wrong screen rect and land it in a screen corner.
    let (origin_x, origin_y, work_w, work_h) = cursor_monitor_work_area(cursor_x, cursor_y)
        .map(|(l, t, r, b)| (l, t, r - l, b - t))
        .or_else(|| {
            window.current_monitor().ok().flatten().map(|m| {
                let wa = m.work_area();
                (
                    wa.position.x as i32,
                    wa.position.y as i32,
                    wa.size.width as i32,
                    wa.size.height as i32,
                )
            })
        })
        .unwrap_or((0, 0, 1920, 1080));

    // Convert global cursor coordinates to relative monitor coordinates
    let rel_cursor_x = cursor_x - origin_x;
    let rel_cursor_y = cursor_y - origin_y;

    let (rel_target_x, rel_target_y) = if is_capsule {
        // In capsule mode, position the micro-icon right next to the cursor
        let mut x = rel_cursor_x + 10;
        let mut y = rel_cursor_y + 8;
        if x + win_w > work_w - 8 {
            x = (rel_cursor_x - win_w - 4).max(8);
        }
        if y + win_h > work_h - 8 {
            y = (rel_cursor_y - win_h - 4).max(8);
        }
        (x.max(8), y.max(8))
    } else {
        position_near_cursor(rel_cursor_x, rel_cursor_y, win_w, win_h, work_w, work_h, 16)
    };

    let target_x = rel_target_x + origin_x;
    let target_y = rel_target_y + origin_y;

    if cfg!(debug_assertions) {
        eprintln!(
            "[Runbi] position: cursor=({cursor_x},{cursor_y}) monitor=({origin_x},{origin_y} {work_w}x{work_h}) win={win_w}x{win_h} capsule={} target=({target_x},{target_y})",
            is_capsule
        );
    }

    let _ = window.set_position(PhysicalPosition::new(target_x, target_y));

    if is_capsule {
        // set_position may be adjusted by the window manager (DPI, borders,
        // work-area constraints). Hit-test against the final physical rect,
        // not the pre-position estimate.
        let actual_position = window
            .outer_position()
            .map(|position| (position.x, position.y))
            .unwrap_or((target_x, target_y));
        let actual_size = window
            .outer_size()
            .map(|size| (size.width as i32, size.height as i32))
            .unwrap_or((win_w, win_h));
        crate::commands::mouse_hook::set_capsule_bounds(Some((
            actual_position.0,
            actual_position.1,
            actual_size.0,
            actual_size.1,
        )));
        crate::commands::file_log(
            window.app_handle(),
            &format!(
                "capsule bounds: target=({target_x},{target_y}) actual=({},{}) size={}x{}",
                actual_position.0, actual_position.1, actual_size.0, actual_size.1
            ),
        );
    }

    // 胶囊是划词瞬态浮条,必须盖过用户当前应用(PopClip 同款);展开回面板时解除,
    // 让面板遵循普通焦点规则。置顶状态跟随后续 position 调用按模式翻转。
    let _ = window.set_always_on_top(is_capsule);

    if !is_capsule {
        let _ = window.show();
        let _ = window.set_focus();
    }

    Ok(PositionResult {
        x: target_x,
        y: target_y,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_position_near_cursor_clamping() {
        // Cursor at bottom-right corner of 1920x1080
        let (x, y) = position_near_cursor(1900, 1050, 560, 520, 1920, 1080, 16);
        assert!(x + 560 <= 1920 - 16);
        assert!(y + 520 <= 1080 - 16);
        assert!(x >= 16);
        assert!(y >= 16);

        // Cursor at top-left corner
        let (x2, y2) = position_near_cursor(5, 5, 560, 520, 1920, 1080, 16);
        assert!(x2 >= 16);
        assert!(y2 >= 16);
    }
}
