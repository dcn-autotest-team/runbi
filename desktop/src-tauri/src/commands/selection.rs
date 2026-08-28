//! Selection Grab Command
//! Simulates Ctrl+C on the active application window to capture currently selected text.

use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_clipboard_manager::ClipboardExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectionResult {
    pub text: String,
    pub cursor_x: i32,
    pub cursor_y: i32,
}

#[cfg(windows)]
unsafe fn simulate_ctrl_c() {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL,
    };

    let mut inputs: [INPUT; 4] = std::mem::zeroed();

    // Ctrl Down
    inputs[0].r#type = INPUT_KEYBOARD;
    inputs[0].Anonymous.ki = KEYBDINPUT {
        wVk: VK_CONTROL,
        wScan: 0,
        dwFlags: 0,
        time: 0,
        dwExtraInfo: 0,
    };

    // 'C' Down
    inputs[1].r#type = INPUT_KEYBOARD;
    inputs[1].Anonymous.ki = KEYBDINPUT {
        wVk: 0x43, // 'C'
        wScan: 0,
        dwFlags: 0,
        time: 0,
        dwExtraInfo: 0,
    };

    // 'C' Up
    inputs[2].r#type = INPUT_KEYBOARD;
    inputs[2].Anonymous.ki = KEYBDINPUT {
        wVk: 0x43,
        wScan: 0,
        dwFlags: KEYEVENTF_KEYUP,
        time: 0,
        dwExtraInfo: 0,
    };

    // Ctrl Up
    inputs[3].r#type = INPUT_KEYBOARD;
    inputs[3].Anonymous.ki = KEYBDINPUT {
        wVk: VK_CONTROL,
        wScan: 0,
        dwFlags: KEYEVENTF_KEYUP,
        time: 0,
        dwExtraInfo: 0,
    };

    SendInput(
        4,
        inputs.as_mut_ptr(),
        std::mem::size_of::<INPUT>() as i32,
    );
}

#[cfg(not(windows))]
unsafe fn simulate_ctrl_c() {
    // Non-windows fallback
}

#[tauri::command]
pub async fn get_current_selection(window: WebviewWindow) -> Result<SelectionResult, String> {
    // Get cursor position
    let cursor_pos = window.cursor_position().unwrap_or(tauri::PhysicalPosition::new(200.0, 200.0));

    // In a background task, simulate Ctrl+C
    #[cfg(windows)]
    unsafe {
        simulate_ctrl_c();
    }

    // Wait for clipboard to update
    tokio::time::sleep(Duration::from_millis(50)).await;

    // Read clipboard text
    let clipboard = window.app_handle().clipboard();
    let text = clipboard.read_text().unwrap_or_default();

    Ok(SelectionResult {
        text,
        cursor_x: cursor_pos.x as i32,
        cursor_y: cursor_pos.y as i32,
    })
}
