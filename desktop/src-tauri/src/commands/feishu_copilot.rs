//! Feishu (Lark) Copilot Module
//! Provides viewport background capture (scroll up / scroll down) and smart response delivery
//! (collaborative pre-fill into Feishu input box vs auto-pilot submit with Return).

use std::time::Duration;

#[cfg(windows)]
pub fn find_feishu_window() -> Option<windows_sys::Win32::Foundation::HWND> {
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM, RECT};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowLongPtrW, GetWindowRect, GetWindowThreadProcessId, IsWindowVisible,
        GWL_EXSTYLE, WS_EX_TOOLWINDOW,
    };

    struct Scan {
        best: Option<HWND>,
        best_area: i64,
    }

    unsafe extern "system" fn on_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let scan = &mut *(lparam as *mut Scan);
        if IsWindowVisible(hwnd) == 0 {
            return 1;
        }
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE as i32);
        if (ex & WS_EX_TOOLWINDOW as isize) != 0 {
            return 1;
        }
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 {
            return 1;
        }
        let matches = crate::commands::screenshot::process_name_matches(pid, "feishu")
            || crate::commands::screenshot::process_name_matches(pid, "lark");
        if !matches {
            return 1;
        }
        let mut rect: RECT = std::mem::zeroed();
        GetWindowRect(hwnd, &mut rect);
        let w = (rect.right - rect.left) as i64;
        let h = (rect.bottom - rect.top) as i64;
        let area = w * h;
        if area > scan.best_area {
            scan.best = Some(hwnd);
            scan.best_area = area;
        }
        1
    }

    let mut scan = Scan {
        best: None,
        best_area: 0,
    };
    unsafe {
        EnumWindows(Some(on_window), &mut scan as *mut Scan as LPARAM);
    }
    scan.best
}

/// Scrolls Feishu chat history up to capture historical background context, then scrolls back.
/// Returns an array of JPEG data URLs [historical_viewport, current_viewport].
#[tauri::command]
pub async fn capture_feishu_multi_turn_context(
    scroll_up_steps: Option<u32>,
) -> Result<Vec<String>, String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::{HWND, RECT};
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetAncestor, GetWindowRect, PostMessageW, WM_MOUSEWHEEL,
        };

        let hwnd = find_feishu_window()
            .ok_or_else(|| "未找到正在运行的飞书窗口，请先打开飞书客户端".to_string())?;

        let root = unsafe {
            GetAncestor(hwnd, 2 /* GA_ROOT */)
        };
        let target_hwnd = if !root.is_null() { root } else { hwnd };
        let target_hwnd_val = target_hwnd as isize;

        let mut rect: RECT = unsafe { std::mem::zeroed() };
        unsafe { GetWindowRect(target_hwnd, &mut rect) };
        let center_x = rect.left + (rect.right - rect.left) / 2;
        let center_y = rect.top + (rect.bottom - rect.top) / 2;
        let lparam = ((center_y as u32) << 16) | ((center_x as u32) & 0xFFFF);

        let steps = scroll_up_steps.unwrap_or(4).clamp(1, 10);

        let mut captures = Vec::new();

        // 1. If user requested context scrolling, scroll up first to grab history
        if steps > 1 {
            // WM_MOUSEWHEEL positive delta = wheel away from user = scroll UP in chat
            for _ in 0..steps {
                unsafe {
                    PostMessageW(
                        target_hwnd_val as HWND,
                        WM_MOUSEWHEEL,
                        (120 * 3) << 16,
                        lparam as isize,
                    );
                }
                tokio::time::sleep(Duration::from_millis(40)).await;
            }
            // Allow UI to render
            tokio::time::sleep(Duration::from_millis(200)).await;
            if let Ok(history_shot) = unsafe {
                crate::commands::screenshot::capture_hwnd_to_jpeg(target_hwnd_val as HWND)
            } {
                captures.push(history_shot);
            }

            // 2. Scroll back down to bottom
            for _ in 0..steps {
                // Negative delta = wheel toward user = scroll DOWN back to latest
                let neg_wheel: u32 = (-(120 * 3i32)) as u32;
                unsafe {
                    PostMessageW(
                        target_hwnd_val as HWND,
                        WM_MOUSEWHEEL,
                        neg_wheel as usize,
                        lparam as isize,
                    );
                }
                tokio::time::sleep(Duration::from_millis(40)).await;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }

        // 3. Capture current bottom (latest messages)
        let latest_shot =
            unsafe { crate::commands::screenshot::capture_hwnd_to_jpeg(target_hwnd_val as HWND)? };
        captures.push(latest_shot);

        Ok(captures)
    }
    #[cfg(not(windows))]
    {
        let _ = scroll_up_steps;
        Err("Feishu Copilot is only supported on Windows".to_string())
    }
}

/// Deliver response to Feishu input box:
/// - prefill_only: pastes text into Feishu's active input box without sending (Collaborative mode).
/// - auto_submit: pastes text and triggers Return key to immediately send (Auto-Pilot mode).
#[tauri::command]
pub async fn send_to_feishu_input(
    app: tauri::AppHandle,
    text: String,
    auto_submit: bool,
) -> Result<bool, String> {
    #[cfg(windows)]
    {
        use tauri_plugin_clipboard_manager::ClipboardExt;
        use windows_sys::Win32::Foundation::HWND;
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_RETURN,
        };
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SetForegroundWindow, ShowWindow, SW_RESTORE,
        };

        if text.trim().is_empty() {
            return Err("Cannot deliver empty response".to_string());
        }

        let hwnd = find_feishu_window().ok_or_else(|| "未找到正在运行的飞书窗口".to_string())?;
        let hwnd_val = hwnd as isize;

        // 1. Bring Feishu window to foreground
        unsafe {
            ShowWindow(hwnd_val as HWND, SW_RESTORE);
            SetForegroundWindow(hwnd_val as HWND);
        }
        tokio::time::sleep(Duration::from_millis(150)).await;

        if !crate::commands::uia::focus_bottom_editable_in_window(hwnd_val) {
            return Err("未找到飞书消息输入框，请先打开一个聊天会话".to_string());
        }
        tokio::time::sleep(Duration::from_millis(80)).await;

        // 2. Set internal action flag to avoid tripping clipboard / selection monitors
        crate::commands::input::set_internal_action(&app, true, Some(&text));

        // 3. Write text to clipboard
        let clipboard = app.clipboard();
        if let Err(e) = clipboard.write_text(&text) {
            crate::commands::input::set_internal_action(&app, false, None);
            return Err(format!("Clipboard write failed: {}", e));
        }

        // 4. Paste into the focused composer and verify it through UIA before
        // auto-submit. Never press Enter on a timer alone: focus may have moved.
        let direct_ack = unsafe { crate::commands::input::paste_via_focused_control() };
        if !direct_ack {
            unsafe { crate::commands::input::simulate_ctrl_v() };
        }
        let pasted = if direct_ack {
            true
        } else {
            let expected = text.clone();
            tokio::task::spawn_blocking(move || {
                crate::commands::uia::wait_for_pasted_text(&expected, Duration::from_millis(900))
            })
            .await
            .unwrap_or(false)
        };

        // 5. Auto mode sends only after the exact draft is observed at the
        // caret. Collaborative mode leaves the pasted text for user review.
        if auto_submit {
            if !pasted {
                crate::commands::input::set_internal_action(&app, false, Some(&text));
                return Err("未确认回复已进入飞书输入框，已取消自动发送".to_string());
            }
            let sent = unsafe {
                let mut inputs: [INPUT; 2] = std::mem::zeroed();
                // Return Down
                inputs[0].r#type = INPUT_KEYBOARD;
                inputs[0].Anonymous.ki = KEYBDINPUT {
                    wVk: VK_RETURN,
                    wScan: 0,
                    dwFlags: 0,
                    time: 0,
                    dwExtraInfo: 0,
                };
                // Return Up
                inputs[1].r#type = INPUT_KEYBOARD;
                inputs[1].Anonymous.ki = KEYBDINPUT {
                    wVk: VK_RETURN,
                    wScan: 0,
                    dwFlags: KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                };
                SendInput(2, inputs.as_mut_ptr(), std::mem::size_of::<INPUT>() as i32) == 2
            };
            if !sent {
                crate::commands::input::set_internal_action(&app, false, Some(&text));
                return Err("飞书回车发送失败，回复仍保留在输入框中".to_string());
            }
        }

        crate::commands::input::set_internal_action(&app, false, Some(&text));

        Ok(true)
    }
    #[cfg(not(windows))]
    {
        let _ = (app, text, auto_submit);
        Err("Feishu Copilot is only supported on Windows".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_feishu_detection_does_not_panic() {
        #[cfg(windows)]
        {
            use std::sync::atomic::{AtomicUsize, Ordering};
            use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
            use windows_sys::Win32::UI::WindowsAndMessaging::{
                EnumWindows, GetWindowLongPtrW, GetWindowTextW, GetWindowThreadProcessId,
                IsWindowVisible, GWL_EXSTYLE, WS_EX_TOOLWINDOW,
            };

            static TOTAL_WINS: AtomicUsize = AtomicUsize::new(0);
            unsafe extern "system" fn debug_win(hwnd: HWND, _: LPARAM) -> BOOL {
                let count = TOTAL_WINS.fetch_add(1, Ordering::Relaxed) + 1;
                let vis = IsWindowVisible(hwnd);
                let mut pid = 0u32;
                GetWindowThreadProcessId(hwnd, &mut pid);
                let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE as i32);
                let is_tool = (ex & WS_EX_TOOLWINDOW as isize) != 0;

                let mut title_buf = [0u16; 256];
                let title_len = GetWindowTextW(hwnd, title_buf.as_mut_ptr(), 256);
                let title = String::from_utf16_lossy(&title_buf[..title_len as usize]);

                if count <= 5
                    || title.contains("飞书")
                    || title.contains("Feishu")
                    || title.contains("Code")
                {
                    println!(
                        "win #{}: hwnd=0x{:X} pid={} vis={} tool={} title='{}'",
                        count, hwnd as usize, pid, vis, is_tool, title
                    );
                }
                1
            }

            TOTAL_WINS.store(0, Ordering::Relaxed);
            unsafe {
                EnumWindows(Some(debug_win), 0);
            }
            println!("TOTAL_WINS: {}", TOTAL_WINS.load(Ordering::Relaxed));
            let hwnd = find_feishu_window();
            println!("find_feishu_window result: {:?}", hwnd);
        }
    }
}
