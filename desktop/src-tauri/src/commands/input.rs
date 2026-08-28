//! Input Simulation & Internal Action State Management
//! Unifies Win32 SendInput (Ctrl+C, Ctrl+V) and provides consistent
//! internal flag guards to prevent feedback loops between monitors.

use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager};

#[cfg(windows)]
pub unsafe fn simulate_ctrl_c() {
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
pub unsafe fn simulate_ctrl_c() {}

#[cfg(windows)]
pub unsafe fn simulate_ctrl_v() {
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
pub unsafe fn simulate_ctrl_v() {}

/// Sets `is_internal_action` flag across all monitor states and optionally updates recorded texts.
pub fn set_internal_action(app: &AppHandle, is_internal: bool, updated_text: Option<&str>) {
    if let Some(state) = app.try_state::<crate::commands::clipboard_monitor::ClipboardMonitorState>() {
        state.is_internal_action.store(is_internal, Ordering::SeqCst);
        if let Some(text) = updated_text {
            if let Ok(mut last) = state.last_content.lock() {
                *last = text.to_string();
            }
        }
    }
    if let Some(state) = app.try_state::<crate::commands::mouse_hook::SelectionMonitorState>() {
        state.is_internal_action.store(is_internal, Ordering::SeqCst);
        if let Some(text) = updated_text {
            if let Ok(mut last) = state.last_selected_text.lock() {
                *last = text.to_string();
            }
        }
    }
}
