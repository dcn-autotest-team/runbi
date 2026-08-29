//! Selection Grab Command
//! Simulates Ctrl+C on the active application window to capture currently selected text.

use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{Manager, WebviewWindow};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionResult {
    pub text: String,
    pub cursor_x: i32,
    pub cursor_y: i32,
    pub source_app: Option<String>,
    pub window_title: Option<String>,
}

/// Foreground window context (process image name + window title) for the
/// context auto-sense classifier. Returns (None, None) outside Windows or on failure.
#[cfg(windows)]
pub fn get_foreground_context() -> (Option<String>, Option<String>) {
    unsafe {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
            PROCESS_QUERY_LIMITED_INFORMATION,
        };
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetAncestor, GetClassNameW, GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW,
            GetWindowThreadProcessId,
        };

        let raw_hwnd = GetForegroundWindow();
        if raw_hwnd.is_null() {
            return (None, None);
        }

        // Window title
        let title_len = GetWindowTextLengthW(raw_hwnd);
        let title = if title_len > 0 {
            let mut buf = vec![0u16; (title_len + 1) as usize];
            let copied = GetWindowTextW(raw_hwnd, buf.as_mut_ptr(), (title_len + 1) as i32);
            if copied > 0 {
                Some(String::from_utf16_lossy(&buf[..copied as usize]))
            } else {
                None
            }
        } else {
            None
        };

        // Window class name (reliable even when process query fails)
        let mut class_buf = [0u16; 256];
        let class_len = GetClassNameW(raw_hwnd, class_buf.as_mut_ptr(), class_buf.len() as i32);
        let class_name = if class_len > 0 {
            String::from_utf16_lossy(&class_buf[..class_len as usize])
        } else {
            String::new()
        };

        // Process image file name directly from foreground window
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(raw_hwnd, &mut pid);
        let mut app = if pid != 0 {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if !handle.is_null() {
                let mut buf = [0u16; 512];
                let mut size = buf.len() as u32;
                let ok = QueryFullProcessImageNameW(
                    handle,
                    PROCESS_NAME_WIN32,
                    buf.as_mut_ptr(),
                    &mut size,
                );
                CloseHandle(handle);
                if ok != 0 && size > 0 {
                    let full = String::from_utf16_lossy(&buf[..size as usize]);
                    full.rsplit(['\\', '/']).next().map(|s| s.to_string())
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };

        // Fallback: If app name wasn't resolved, try walking up to root window
        if app.is_none() {
            let root_hwnd = GetAncestor(raw_hwnd, 2 /* GA_ROOT */);
            if !root_hwnd.is_null() && root_hwnd != raw_hwnd {
                let mut root_pid: u32 = 0;
                GetWindowThreadProcessId(root_hwnd, &mut root_pid);
                if root_pid != 0 {
                    let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, root_pid);
                    if !handle.is_null() {
                        let mut buf = [0u16; 512];
                        let mut size = buf.len() as u32;
                        let ok = QueryFullProcessImageNameW(
                            handle,
                            PROCESS_NAME_WIN32,
                            buf.as_mut_ptr(),
                            &mut size,
                        );
                        CloseHandle(handle);
                        if ok != 0 && size > 0 {
                            let full = String::from_utf16_lossy(&buf[..size as usize]);
                            app = full.rsplit(['\\', '/']).next().map(|s| s.to_string());
                        }
                    }
                }
            }
        }

        // Fallback identification by famous Win32 chat window classes
        if app.is_none() {
            let class_lower = class_name.to_ascii_lowercase();
            if class_lower.contains("wechat") || class_lower.contains("weixin") {
                app = Some("WeChat.exe".to_string());
            } else if class_lower.contains("dingtalk") {
                app = Some("DingTalk.exe".to_string());
            } else if class_lower.contains("txguifoundation") {
                app = Some("QQ.exe".to_string());
            }
        }

        (app, title)
    }
}

#[cfg(not(windows))]
pub fn get_foreground_context() -> (Option<String>, Option<String>) {
    (None, None)
}

#[cfg(windows)]
pub fn get_clipboard_seq() -> u32 {
    unsafe { windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber() }
}

#[cfg(not(windows))]
pub fn get_clipboard_seq() -> u32 {
    0
}

fn is_fresh_clipboard_text(
    initial_seq: u32,
    current_seq: u32,
    original_text: &str,
    candidate: &str,
) -> bool {
    !candidate.trim().is_empty()
        && (current_seq != initial_seq || candidate != original_text)
}

fn spawn_uia_selection() -> tokio::task::JoinHandle<Option<String>> {
    #[cfg(windows)]
    {
        tokio::task::spawn_blocking(crate::commands::uia::selected_text)
    }
    #[cfg(not(windows))]
    {
        tokio::spawn(async { None })
    }
}

async fn await_uia_selection(
    task: &mut Option<tokio::task::JoinHandle<Option<String>>>,
    timeout: Duration,
) -> Option<String> {
    let outcome = tokio::time::timeout(timeout, task.as_mut()?).await;
    match outcome {
        Ok(Ok(text)) => {
            task.take();
            text
        }
        Ok(Err(_)) => {
            task.take();
            None
        }
        Err(_) => None,
    }
}

/// Robustly captures selected text from the active foreground window via simulated Ctrl+C
pub async fn grab_selected_text_with_retry(app: &tauri::AppHandle) -> Option<String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;

    // UIA is both faster and clipboard-free when the target exposes TextPattern.
    // Start it first, then keep it running as the fallback while Ctrl+C is tried.
    let mut uia_task = Some(spawn_uia_selection());
    if let Some(text) = await_uia_selection(&mut uia_task, Duration::from_millis(80)).await {
        eprintln!("[Runbi] selection captured via UI Automation");
        return Some(text);
    }

    let snapshot = crate::commands::clipboard_snapshot::ClipboardSnapshot::capture(app);
    if !snapshot.can_restore() {
        let text = await_uia_selection(&mut uia_task, Duration::from_millis(350)).await;
        if text.is_none() {
            eprintln!("[Runbi] Selection capture skipped to preserve unsupported clipboard content");
        }
        return text;
    }

    crate::commands::input::set_internal_action(app, true, None);

    let initial_seq = get_clipboard_seq();
    let original_clip = snapshot.text_for_monitor();

    let mut captured_text = None;
    'capture: for _ in 0..2 {
        #[cfg(windows)]
        unsafe {
            crate::commands::input::simulate_ctrl_c();
        }

        for _ in 0..6 {
            tokio::time::sleep(Duration::from_millis(20)).await;
            let current_seq = get_clipboard_seq();
            if let Some(text) = crate::commands::clipboard_monitor::read_system_clipboard()
                .or_else(|| app.clipboard().read_text().ok())
            {
                if is_fresh_clipboard_text(initial_seq, current_seq, &original_clip, &text) {
                    captured_text = Some(text);
                    break 'capture;
                }
            }
        }
    }

    let Some(captured_text) = captured_text else {
        let restored = snapshot.restore(app);
        crate::commands::input::set_internal_action(
            app,
            false,
            restored.then(|| snapshot.text_for_monitor()),
        );
        let text = await_uia_selection(&mut uia_task, Duration::from_millis(200)).await;
        if text.is_some() {
            eprintln!("[Runbi] Ctrl+C failed; selection recovered via UI Automation");
        }
        return text;
    };

    let restored = snapshot.restore(app);
    let final_clipboard = if restored {
        snapshot.text_for_monitor()
    } else {
        captured_text.as_str()
    };
    crate::commands::input::set_internal_action(app, false, Some(final_clipboard));
    Some(captured_text)
}

#[tauri::command]
pub async fn get_current_selection(window: WebviewWindow) -> Result<SelectionResult, String> {
    let cursor_pos = window.cursor_position().unwrap_or(tauri::PhysicalPosition::new(200.0, 200.0));
    let (source_app, window_title) = get_foreground_context();
    let app = window.app_handle();

    let text = grab_selected_text_with_retry(app).await.unwrap_or_default();

    Ok(SelectionResult {
        text,
        cursor_x: cursor_pos.x as i32,
        cursor_y: cursor_pos.y as i32,
        source_app,
        window_title,
    })
}

#[cfg(test)]
mod tests {
    use super::is_fresh_clipboard_text;

    #[test]
    fn rejects_stale_clipboard_but_accepts_a_repeated_selection_copy() {
        assert!(!is_fresh_clipboard_text(7, 7, "same text", "same text"));
        assert!(is_fresh_clipboard_text(7, 8, "same text", "same text"));
        assert!(!is_fresh_clipboard_text(7, 8, "old", "  \n"));
    }
}
