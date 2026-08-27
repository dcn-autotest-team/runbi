//! Multi-Monitor Cursor Positioning and Work Area Clamping
//! Ensures Runbi's floating window is gracefully positioned near the mouse
//! without overflowing outside screen boundaries.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewWindow};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PositionResult {
    pub x: i32,
    pub y: i32,
}

/// Clamps target coordinates so a window of width `w` and height `h`
/// stays entirely within screen boundaries.
pub fn clamp_coordinates(
    cursor_x: i32,
    cursor_y: i32,
    window_w: i32,
    window_h: i32,
    screen_w: i32,
    screen_h: i32,
    margin: i32,
) -> (i32, i32) {
    let mut target_x = cursor_x + 12;
    let mut target_y = cursor_y + 16;

    if target_x + window_w > screen_w - margin {
        target_x = screen_w - window_w - margin;
    }
    if target_x < margin {
        target_x = margin;
    }

    if target_y + window_h > screen_h - margin {
        target_y = cursor_y - window_h - 12;
    }
    if target_y < margin {
        target_y = margin;
    }

    (target_x, target_y)
}

/// Commands to position the window at the current cursor location
#[tauri::command]
pub async fn position_window_at_cursor(window: WebviewWindow) -> Result<PositionResult, String> {
    let cursor_pos = window.cursor_position().map_err(|e| e.to_string())?;

    // Default dimensions
    let win_size = window.outer_size().map_err(|e| e.to_string())?;
    let win_w = win_size.width as i32;
    let win_h = win_size.height as i32;

    // Get current monitor
    let monitor = window.current_monitor().map_err(|e| e.to_string())?;
    let (screen_w, screen_h) = if let Some(m) = monitor {
        let size = m.size();
        (size.width as i32, size.height as i32)
    } else {
        (1920, 1080)
    };

    let (clamped_x, clamped_y) = clamp_coordinates(
        cursor_pos.x as i32,
        cursor_pos.y as i32,
        win_w,
        win_h,
        screen_w,
        screen_h,
        16,
    );

    window
        .set_position(PhysicalPosition::new(clamped_x, clamped_y))
        .map_err(|e| e.to_string())?;

    Ok(PositionResult {
        x: clamped_x,
        y: clamped_y,
    })
}
