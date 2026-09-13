//! Chat Copilot Module
//! Provides viewport background capture and smart response delivery for supported chat apps.

use std::time::Duration;

#[cfg(windows)]
pub fn find_chat_window(
    process_name: Option<&str>,
) -> Option<windows_sys::Win32::Foundation::HWND> {
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM, RECT};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowLongPtrW, GetWindowRect, GetWindowThreadProcessId, IsWindowVisible,
        GWL_EXSTYLE, WS_EX_TOOLWINDOW,
    };

    let preferred = process_name
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_ascii_lowercase)
        .map(|name| name.strip_suffix(".exe").unwrap_or(&name).to_string());
    if let Some(name) = preferred.as_deref() {
        if crate::commands::screenshot::is_likely_conversation_window(Some(name), None) {
            if let Some(hwnd) = unsafe { crate::commands::screenshot::find_window_by_process(name) } {
                return Some(hwnd);
            }
        }
    }

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
        let matches = crate::commands::screenshot::CHAT_PROCESS_NAMES
            .iter()
            .any(|name| crate::commands::screenshot::process_name_matches(pid, name));
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

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct FeishuContextCapture {
    pub changed: bool,
    pub captures: Vec<String>,
}

#[derive(Clone)]
struct ViewportFingerprint {
    hwnd: isize,
    width: i32,
    height: i32,
    grid: [u8; 64 * 64],
}

static LAST_VIEWPORT: std::sync::Mutex<Option<ViewportFingerprint>> = std::sync::Mutex::new(None);

pub fn compute_message_area_grid(width: i32, height: i32, bgra: &[u8]) -> [u8; 64 * 64] {
    let mut grid = [0u8; 64 * 64];
    if width <= 0 || height <= 0 {
        return grid;
    }
    // Message bubble area: ignore top 8% (title bar/clock/tabs) and bottom 150px (input box with blinking cursor)
    let y_min = ((height as f32) * 0.08) as usize;
    let y_max = (height.saturating_sub(150) as usize)
        .min(((height as f32) * 0.82) as usize)
        .max(y_min + 10);
    let x_min = 0;
    let x_max = width as usize;

    let y_span = y_max - y_min;
    let x_span = x_max - x_min;

    for r in 0..64 {
        let py = y_min + (r * y_span) / 64;
        let row_offset = py * (width as usize);
        for c in 0..64 {
            let px = x_min + (c * x_span) / 64;
            let offset = (row_offset + px) * 4;
            if offset + 2 < bgra.len() {
                let b = bgra[offset] as u16;
                let g = bgra[offset + 1] as u16;
                let r_val = bgra[offset + 2] as u16;
                grid[r * 64 + c] = ((r_val + g * 2 + b) / 4) as u8;
            }
        }
    }
    grid
}

pub fn check_viewport_changed(
    hwnd_val: isize,
    width: i32,
    height: i32,
    bgra: &[u8],
    force: bool,
) -> (bool, usize) {
    let current_grid = compute_message_area_grid(width, height, bgra);
    let mut guard = LAST_VIEWPORT.lock().unwrap_or_else(|e| e.into_inner());

    if force {
        *guard = Some(ViewportFingerprint {
            hwnd: hwnd_val,
            width,
            height,
            grid: current_grid,
        });
        return (true, 4096);
    }

    if let Some(prev) = guard.as_ref() {
        if prev.hwnd != hwnd_val || prev.width != width || prev.height != height {
            *guard = Some(ViewportFingerprint {
                hwnd: hwnd_val,
                width,
                height,
                grid: current_grid,
            });
            return (true, 4096);
        }

        let mut diff_cells = 0;
        for i in 0..4096 {
            let diff = (current_grid[i] as i16 - prev.grid[i] as i16).abs();
            if diff > 10 {
                diff_cells += 1;
            }
        }

        // Out of 4096 cells, 16 cells is ~0.39% of the message area.
        // A single new message bubble or chat scroll changes 50~1000+ cells.
        // Blinking cursor in input box or subpixel jitter changes 0~5 cells.
        if diff_cells >= 16 {
            *guard = Some(ViewportFingerprint {
                hwnd: hwnd_val,
                width,
                height,
                grid: current_grid,
            });
            (true, diff_cells)
        } else {
            (false, diff_cells)
        }
    } else {
        *guard = Some(ViewportFingerprint {
            hwnd: hwnd_val,
            width,
            height,
            grid: current_grid,
        });
        (true, 4096)
    }
}

/// Captures chat viewport context:
/// When unchanged, returns `changed: false` with empty captures immediately (0 JPEG encoding, 0 LLM tokens).
/// When changed, returns `changed: true` with the encoded JPEG captures.
#[tauri::command]
pub async fn capture_feishu_multi_turn_context(
    scroll_up_steps: Option<u32>,
    process_name: Option<String>,
    force: Option<bool>,
) -> Result<FeishuContextCapture, String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::{HWND, RECT};
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetAncestor, GetWindowRect, PostMessageW, WM_MOUSEWHEEL,
        };

        let hwnd = find_chat_window(process_name.as_deref())
            .ok_or_else(|| "未找到可读取的聊天窗口，请先打开一个受支持的聊天应用".to_string())?;

        let root = unsafe {
            GetAncestor(hwnd, 2 /* GA_ROOT */)
        };
        let target_hwnd = if !root.is_null() { root } else { hwnd };
        let target_hwnd_val = target_hwnd as isize;

        // 1. Fast raw pixel capture (~10-15ms)
        let (width, height, buffer) = unsafe {
            crate::commands::screenshot::capture_hwnd_pixels(target_hwnd_val as HWND)?
        };

        // 2. Check if the chat message area actually changed
        let (changed, _diff_cells) = check_viewport_changed(
            target_hwnd_val,
            width,
            height,
            &buffer,
            force.unwrap_or(false),
        );

        if !changed {
            return Ok(FeishuContextCapture {
                changed: false,
                captures: Vec::new(),
            });
        }

        // 3. Screen DID change: encode latest viewport to JPEG
        let latest_shot = crate::commands::screenshot::encode_bgra_to_jpeg(width, height, buffer)?;

        let steps = scroll_up_steps.unwrap_or(1).clamp(1, 10);
        let mut captures = Vec::new();

        // If user requested multi-turn context scrolling, scroll up first to grab history
        if steps > 1 {
            let mut rect: RECT = unsafe { std::mem::zeroed() };
            unsafe { GetWindowRect(target_hwnd, &mut rect) };
            let center_x = rect.left + (rect.right - rect.left) / 2;
            let center_y = rect.top + (rect.bottom - rect.top) / 2;
            let lparam = ((center_y as u32) << 16) | ((center_x as u32) & 0xFFFF);

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
            tokio::time::sleep(Duration::from_millis(200)).await;
            if let Ok(history_shot) = unsafe {
                crate::commands::screenshot::capture_hwnd_to_jpeg(target_hwnd_val as HWND)
            } {
                captures.push(history_shot);
            }

            // Scroll back down to bottom
            for _ in 0..steps {
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

        captures.push(latest_shot);

        Ok(FeishuContextCapture {
            changed: true,
            captures,
        })
    }
    #[cfg(not(windows))]
    {
        let _ = (scroll_up_steps, process_name, force);
        Err("聊天智能应答仅支持 Windows".to_string())
    }
}

/// Deliver response to a supported chat input box:
/// - prefill_only: pastes text into the active input box without sending (Collaborative mode).
/// - auto_submit: pastes text and triggers Return key to immediately send (Auto-Pilot mode).
#[tauri::command]
pub async fn send_to_feishu_input(
    app: tauri::AppHandle,
    text: String,
    auto_submit: bool,
    process_name: Option<String>,
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

        let hwnd = find_chat_window(process_name.as_deref())
            .ok_or_else(|| "未找到可发送的聊天窗口".to_string())?;
        let hwnd_val = hwnd as isize;

        // 1. Bring the chat window to foreground
        unsafe {
            ShowWindow(hwnd_val as HWND, SW_RESTORE);
            SetForegroundWindow(hwnd_val as HWND);
        }
        tokio::time::sleep(Duration::from_millis(150)).await;

        // Best effort: focus bottom editable in window via UIA (e.g. Feishu composer).
        // If UIA tree traversal misses, continue since the target window is foregrounded.
        let _ = crate::commands::uia::focus_bottom_editable_in_window(hwnd_val);
        tokio::time::sleep(Duration::from_millis(80)).await;

        let snapshot = crate::commands::clipboard_snapshot::ClipboardSnapshot::capture(&app);

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

        // 5. Auto mode sends after draft delivery. Collaborative mode leaves the pasted text for user review.
        if auto_submit {
            if !direct_ack && !pasted {
                tokio::time::sleep(Duration::from_millis(100)).await;
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
                let restored = app.clipboard().read_text().ok().as_deref() == Some(text.as_str())
                    && snapshot.restore(&app);
                let monitor_text = if restored {
                    snapshot.text_for_monitor()
                } else {
                    text.as_str()
                };
                crate::commands::input::set_internal_action(&app, false, Some(monitor_text));
                return Err("回车发送失败，回复仍保留在输入框中".to_string());
            }
        }

        let restored = app.clipboard().read_text().ok().as_deref() == Some(text.as_str())
            && snapshot.restore(&app);
        let monitor_text = if restored {
            snapshot.text_for_monitor()
        } else {
            text.as_str()
        };
        crate::commands::input::set_internal_action(&app, false, Some(monitor_text));

        Ok(true)
    }
    #[cfg(not(windows))]
    {
        let _ = (app, text, auto_submit, process_name);
        Err("聊天智能应答仅支持 Windows".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chat_detection_does_not_panic() {
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
            let hwnd = find_chat_window(None);
            println!("find_chat_window result: {:?}", hwnd);
        }
    }

    #[test]
    fn test_viewport_change_detection_logic() {
        let width = 800;
        let height = 600;
        let mut bgra = vec![255u8; (width * height * 4) as usize];

        // 1. Initial baseline capture should report changed = true
        let (c1, _) = check_viewport_changed(1001, width, height, &bgra, false);
        assert!(c1, "First capture must establish baseline as changed");

        // 2. Identical frame should report changed = false
        let (c2, diff) = check_viewport_changed(1001, width, height, &bgra, false);
        assert!(!c2, "Identical frame must report changed = false");
        assert_eq!(diff, 0);

        // 3. Changing pixels in bottom input area (y >= 500) must be ignored (cursor blinking)
        for y in 500..550 {
            for x in 100..150 {
                let idx = ((y * width + x) * 4) as usize;
                bgra[idx] = 0; // Blue
                bgra[idx + 1] = 0; // Green
                bgra[idx + 2] = 0; // Red
            }
        }
        let (c3, diff3) = check_viewport_changed(1001, width, height, &bgra, false);
        assert!(!c3, "Changes inside bottom input area must not trigger viewport change");
        assert_eq!(diff3, 0);

        // 4. Changing pixels in message bubble area (y = 250..350) MUST trigger changed = true
        for y in 250..350 {
            for x in 100..400 {
                let idx = ((y * width + x) * 4) as usize;
                bgra[idx] = 0;
                bgra[idx + 1] = 0;
                bgra[idx + 2] = 0;
            }
        }
        let (c4, diff4) = check_viewport_changed(1001, width, height, &bgra, false);
        assert!(c4, "New message bubbles in message area must trigger changed = true");
        assert!(diff4 >= 16, "diff_cells ({}) must exceed threshold", diff4);

        // 5. Force refresh should return changed = true even if unchanged
        let (c5, _) = check_viewport_changed(1001, width, height, &bgra, true);
        assert!(c5, "Force flag must return changed = true");
    }
}

