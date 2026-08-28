//! In-Place Text Replacement Command
//! Writes polished text to the system clipboard and triggers simulated Ctrl+V
//! to replace selected text in the active target application.

use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_clipboard_manager::ClipboardExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplacerResponse {
    pub success: boolean_or_bool,
    pub replaced_length: usize,
    pub restored_clipboard: bool,
    pub error: Option<String>,
}

type boolean_or_bool = bool;

#[cfg(windows)]
unsafe fn simulate_ctrl_v() {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL,
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

    // 'V' Down
    inputs[1].r#type = INPUT_KEYBOARD;
    inputs[1].Anonymous.ki = KEYBDINPUT {
        wVk: 0x56, // 'V'
        wScan: 0,
        dwFlags: 0,
        time: 0,
        dwExtraInfo: 0,
    };

    // 'V' Up
    inputs[2].r#type = INPUT_KEYBOARD;
    inputs[2].Anonymous.ki = KEYBDINPUT {
        wVk: 0x56,
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
unsafe fn simulate_ctrl_v() {
    // Non-windows fallback
}

#[tauri::command]
pub async fn replace_text(
    window: WebviewWindow,
    new_text: String,
    restore_original_clipboard: Option<bool>,
) -> Result<ReplacerResponse, String> {
    if new_text.is_empty() {
        return Ok(ReplacerResponse {
            success: false,
            replaced_length: 0,
            restored_clipboard: false,
            error: Some("Cannot replace with empty text".to_string()),
        });
    }

    let should_restore = restore_original_clipboard.unwrap_or(true);
    let clipboard = window.app_handle().clipboard();

    // 1. Read existing clipboard content
    let original_clip = clipboard.read_text().unwrap_or_default();

    // 2. Hide window so focus returns to the target application
    let _ = window.hide();
    tokio::time::sleep(Duration::from_millis(50)).await;

    // 3. Write new text to clipboard
    let length = new_text.len();
    if let Err(e) = clipboard.write_text(&new_text) {
        return Ok(ReplacerResponse {
            success: false,
            replaced_length: 0,
            restored_clipboard: false,
            error: Some(format!("Failed to write to clipboard: {}", e)),
        });
    }

    // 4. Simulate Ctrl+V to paste
    #[cfg(windows)]
    unsafe {
        simulate_ctrl_v();
    }

    // 5. Restore original clipboard if requested
    if should_restore {
        tokio::time::sleep(Duration::from_millis(100)).await;
        if !original_clip.is_empty() {
            let _ = clipboard.write_text(&original_clip);
        }
    }

    Ok(ReplacerResponse {
        success: true,
        replaced_length: length,
        restored_clipboard: should_restore,
        error: None,
    })
}
