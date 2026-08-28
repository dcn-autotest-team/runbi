//! Multi-Monitor Cursor Positioning and Work Area Clamping
//! Ensures Runbi's floating window is gracefully positioned near the mouse
//! without overflowing outside screen boundaries.

use serde::{Deserialize, Serialize};
use tauri::{LogicalSize, PhysicalPosition, WebviewWindow};

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
        let pt = POINT { x: cursor_x, y: cursor_y };
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
    let (logical_w, logical_h) = if is_capsule {
        // 36px button + 4px padding on every side in App.tsx.
        (44.0, 44.0)
    } else {
        (560.0, 520.0)
    };
    window
        .set_size(LogicalSize::new(logical_w, logical_h))
        .map_err(|e| e.to_string())?;

    let (cursor_x, cursor_y) = get_global_cursor();

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
        position_near_cursor(
            rel_cursor_x,
            rel_cursor_y,
            win_w,
            win_h,
            work_w,
            work_h,
            16,
        )
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
