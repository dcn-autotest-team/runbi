//! In-Place Text Replacement Command
//! Writes polished text to the system clipboard and triggers simulated Ctrl+V
//! to replace selected text in the active target application.

use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{Manager, WebviewWindow};
use tauri_plugin_clipboard_manager::ClipboardExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplacerResponse {
    pub success: bool,
    pub replaced_length: usize,
    pub restored_clipboard: bool,
    pub safe_to_copy_fallback: bool,
    pub error: Option<String>,
}

fn deferred_restore_delay(text_len: usize) -> Duration {
    Duration::from_millis((10_000 + text_len as u64 / 2).min(30_000))
}

async fn wait_for_uia_paste_ack(expected: &str) -> bool {
    #[cfg(windows)]
    {
        let expected = expected.to_string();
        let task = tokio::task::spawn_blocking(move || {
            crate::commands::uia::wait_for_pasted_text(&expected, Duration::from_millis(900))
        });
        matches!(
            tokio::time::timeout(Duration::from_millis(1_100), task).await,
            Ok(Ok(true))
        )
    }
    #[cfg(not(windows))]
    {
        let _ = expected;
        false
    }
}

#[tauri::command]
pub async fn replace_text(
    window: WebviewWindow,
    new_text: String,
    restore_original_clipboard: Option<bool>,
    hide_window: Option<bool>,
    auto_send: Option<bool>,
) -> Result<ReplacerResponse, String> {
    if new_text.is_empty() {
        return Ok(ReplacerResponse {
            success: false,
            replaced_length: 0,
            restored_clipboard: false,
            safe_to_copy_fallback: false,
            error: Some("Cannot replace with empty text".to_string()),
        });
    }

    let should_restore = restore_original_clipboard.unwrap_or(true);
    let should_hide = hide_window.unwrap_or(true);
    let should_auto_send = auto_send.unwrap_or(false);
    let app = window.app_handle();
    let clipboard = app.clipboard();

    let snapshot = crate::commands::clipboard_snapshot::ClipboardSnapshot::capture(app);
    if should_restore && !snapshot.can_restore() {
        return Ok(ReplacerResponse {
            success: false,
            replaced_length: 0,
            restored_clipboard: false,
            safe_to_copy_fallback: false,
            error: Some("剪贴板中含文件或暂不支持的富媒体；为避免覆盖，已取消贴回。".to_string()),
        });
    }

    // Mark internal action to prevent monitors from triggering popup
    crate::commands::input::set_internal_action(app, true, Some(&new_text));

    // 2. Hide window if not pinned
    if should_hide {
        let _ = window.hide();
        tokio::time::sleep(Duration::from_millis(50)).await;
    } else {
        tokio::time::sleep(Duration::from_millis(30)).await;
    }

    // The capsule/panel takes focus when its action is clicked. Return focus
    // to the source control before writing and pasting, otherwise Ctrl+V is
    // delivered to the hidden Runbi WebView and the selected text stays put.
    let target_restored = unsafe { crate::commands::input::restore_foreground_window() };
    if !target_restored {
        crate::commands::input::set_internal_action(app, false, None);
        return Ok(ReplacerResponse {
            success: false,
            replaced_length: 0,
            restored_clipboard: true,
            safe_to_copy_fallback: true,
            error: Some("未找到要贴回的目标窗口，结果已复制，可在目标位置按 Ctrl+V".to_string()),
        });
    }
    tokio::time::sleep(Duration::from_millis(20)).await;

    // 3. Write new text to clipboard
    let length = new_text.len();
    if let Err(e) = clipboard.write_text(&new_text) {
        crate::commands::input::set_internal_action(app, false, None);
        return Ok(ReplacerResponse {
            success: false,
            replaced_length: 0,
            restored_clipboard: false,
            safe_to_copy_fallback: true,
            error: Some(format!("Failed to write to clipboard: {}", e)),
        });
    }

    // 4. Standard edit controls acknowledge WM_PASTE synchronously. Other
    // apps retain Ctrl+V compatibility and are verified through UIA below.
    let direct_ack = unsafe { crate::commands::input::paste_via_focused_control() };
    if !direct_ack {
        unsafe { crate::commands::input::simulate_ctrl_v() };
    }

    let acknowledged = direct_ack || wait_for_uia_paste_ack(&new_text).await;
    let auto_send_error = if should_auto_send && !acknowledged {
        Some("未确认回复已进入输入框，已取消自动发送".to_string())
    } else if should_auto_send {
        tokio::time::sleep(Duration::from_millis(80)).await;
        #[cfg(windows)]
        let sent = unsafe {
            use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
                SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_RETURN,
            };
            let mut inputs: [INPUT; 2] = std::mem::zeroed();
            inputs[0].r#type = INPUT_KEYBOARD;
            inputs[0].Anonymous.ki = KEYBDINPUT {
                wVk: VK_RETURN,
                wScan: 0,
                dwFlags: 0,
                time: 0,
                dwExtraInfo: 0,
            };
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
        #[cfg(not(windows))]
        let sent = false;
        (!sent).then(|| "回车发送失败，回复仍保留在输入框中".to_string())
    } else {
        None
    };

    // 5. Restore the original text, image, or empty clipboard after the target
    // acknowledges the paste. Clipboard sequence numbers cannot prove reads,
    // so they are deliberately not used as an acknowledgement.
    let actually_restored = if should_restore {
        if acknowledged {
            let restored = snapshot.restore(app);
            let monitor_text = if restored {
                snapshot.text_for_monitor()
            } else {
                new_text.as_str()
            };
            crate::commands::input::set_internal_action(app, false, Some(monitor_text));
            restored
        } else {
            // Unknown custom controls get a conservative, asynchronous restore.
            // Restore only while our exact text is still on the clipboard, so a
            // later user copy is never overwritten.
            crate::commands::input::set_internal_action(app, false, Some(&new_text));
            let app = app.clone();
            let snapshot = snapshot.clone();
            let expected = new_text.clone();
            let delay = deferred_restore_delay(new_text.chars().count());
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(delay).await;
                if app.clipboard().read_text().ok().as_deref() == Some(expected.as_str()) {
                    crate::commands::input::set_internal_action(&app, true, None);
                    let restored = snapshot.restore(&app);
                    let monitor_text = restored.then(|| snapshot.text_for_monitor());
                    crate::commands::input::set_internal_action(&app, false, monitor_text);
                }
            });
            false
        }
    } else {
        crate::commands::input::set_internal_action(app, false, Some(&new_text));
        false
    };

    Ok(ReplacerResponse {
        success: auto_send_error.is_none(),
        replaced_length: length,
        restored_clipboard: actually_restored,
        safe_to_copy_fallback: auto_send_error.is_some() && !acknowledged,
        error: auto_send_error,
    })
}

#[cfg(test)]
mod tests {
    use super::deferred_restore_delay;

    #[test]
    fn deferred_restore_is_conservative_but_bounded() {
        assert_eq!(deferred_restore_delay(0).as_millis(), 10_000);
        assert!(deferred_restore_delay(5_000).as_millis() > 10_000);
        assert_eq!(deferred_restore_delay(1_000_000).as_millis(), 30_000);
    }
}
