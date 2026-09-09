//! Input Simulation & Internal Action State Management
//! Unifies Win32 SendInput (Ctrl+C, Ctrl+V) and provides consistent
//! internal flag guards to prevent feedback loops between monitors.

use std::sync::atomic::{AtomicIsize, Ordering};
use tauri::{AppHandle, Manager};

#[cfg(windows)]
static LAST_TARGET_WINDOW: AtomicIsize = AtomicIsize::new(0);

/// Remember the application that owned focus before Runbi showed its capsule.
/// Clicking the capsule transfers focus to the WebView; paste must explicitly
/// return focus to the original control before sending Ctrl+V.
#[cfg(windows)]
pub fn remember_foreground_window() {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId,
    };
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return;
        }
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid != std::process::id() {
            LAST_TARGET_WINDOW.store(hwnd as isize, Ordering::SeqCst);
        }
    }
}

#[cfg(not(windows))]
pub fn remember_foreground_window() {}

#[cfg(windows)]
pub unsafe fn restore_foreground_window() -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        IsWindow, SetForegroundWindow, ShowWindow, SW_RESTORE,
    };
    let hwnd = LAST_TARGET_WINDOW.load(Ordering::SeqCst) as windows_sys::Win32::Foundation::HWND;
    if hwnd.is_null() || IsWindow(hwnd) == 0 {
        return false;
    }
    let _ = ShowWindow(hwnd, SW_RESTORE);
    SetForegroundWindow(hwnd) != 0
}

#[cfg(not(windows))]
pub unsafe fn restore_foreground_window() -> bool {
    false
}

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

    SendInput(4, inputs.as_mut_ptr(), std::mem::size_of::<INPUT>() as i32);
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

    SendInput(4, inputs.as_mut_ptr(), std::mem::size_of::<INPUT>() as i32);
}

#[cfg(not(windows))]
pub unsafe fn simulate_ctrl_v() {}

fn supports_synchronous_paste(class_name: &str) -> bool {
    let class = class_name.to_ascii_lowercase();
    class == "edit" || class.contains("richedit") || class.contains("scintilla")
}

/// Uses WM_PASTE only for standard editable controls. SendMessageTimeout
/// returns after the target has synchronously consumed the clipboard, giving
/// the replacer a real acknowledgement instead of a guessed delay.
#[cfg(windows)]
pub unsafe fn paste_via_focused_control() -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetGUIThreadInfo, GetWindowLongPtrW,
        GetWindowThreadProcessId, SendMessageTimeoutW, GUITHREADINFO, GWL_STYLE, SMTO_ABORTIFHUNG,
        SMTO_BLOCK, WM_PASTE,
    };

    let foreground = GetForegroundWindow();
    if foreground.is_null() {
        return false;
    }
    let thread_id = GetWindowThreadProcessId(foreground, std::ptr::null_mut());
    let mut info: GUITHREADINFO = std::mem::zeroed();
    info.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;
    if thread_id == 0 || GetGUIThreadInfo(thread_id, &mut info) == 0 {
        return false;
    }
    let target = if info.hwndFocus.is_null() {
        foreground
    } else {
        info.hwndFocus
    };
    let mut class_buf = [0u16; 128];
    let class_len = GetClassNameW(target, class_buf.as_mut_ptr(), class_buf.len() as i32);
    if class_len <= 0
        || !supports_synchronous_paste(&String::from_utf16_lossy(&class_buf[..class_len as usize]))
    {
        return false;
    }
    const ES_READONLY: isize = 0x0800;
    if GetWindowLongPtrW(target, GWL_STYLE) & ES_READONLY != 0 {
        return false;
    }

    let mut message_result = 0usize;
    SendMessageTimeoutW(
        target,
        WM_PASTE,
        0,
        0,
        SMTO_ABORTIFHUNG | SMTO_BLOCK,
        2_000,
        &mut message_result,
    ) != 0
}

#[cfg(not(windows))]
pub unsafe fn paste_via_focused_control() -> bool {
    false
}

/// Sets `is_internal_action` flag across all monitor states and optionally updates recorded texts.
pub fn set_internal_action(app: &AppHandle, is_internal: bool, updated_text: Option<&str>) {
    if let Some(state) =
        app.try_state::<crate::commands::clipboard_monitor::ClipboardMonitorState>()
    {
        state
            .is_internal_action
            .store(is_internal, Ordering::SeqCst);
        if let Some(text) = updated_text {
            if let Ok(mut last) = state.last_content.lock() {
                *last = text.to_string();
            }
        }
    }
    if let Some(state) = app.try_state::<crate::commands::mouse_hook::SelectionMonitorState>() {
        state
            .is_internal_action
            .store(is_internal, Ordering::SeqCst);
        if let Some(text) = updated_text {
            if let Ok(mut last) = state.last_selected_text.lock() {
                *last = text.to_string();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::supports_synchronous_paste;

    #[test]
    fn only_direct_pastes_into_known_edit_controls() {
        assert!(supports_synchronous_paste("Edit"));
        assert!(supports_synchronous_paste("RICHEDIT50W"));
        assert!(supports_synchronous_paste("Scintilla"));
        assert!(!supports_synchronous_paste("Chrome_RenderWidgetHostHWND"));
    }
}
