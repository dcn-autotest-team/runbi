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

fn paste_settle_delay(text_len: usize) -> Duration {
    Duration::from_millis((120 + text_len as u64 / 50).min(500))
}

const CLIPBOARD_POLL_INTERVAL: Duration = Duration::from_millis(20);

/// Waits for the synthetic paste to be consumed before restoring the original
/// clipboard. Polls `GetClipboardSequenceNumber`: a change means the target
/// app (or the user) has read/replaced the clipboard, so we restore early.
/// Bounded by a text-length deadline so we never hang on apps that paste
/// without modifying the clipboard sequence number.
async fn wait_for_paste_consumed(pre_seq: u32, text_len: usize) -> Duration {
    let deadline = paste_settle_delay(text_len);
    let start = std::time::Instant::now();
    loop {
        if get_clipboard_seq() != pre_seq {
            return start.elapsed();
        }
        if start.elapsed() >= deadline {
            return deadline;
        }
        tokio::time::sleep(CLIPBOARD_POLL_INTERVAL).await;
    }
}

#[cfg(windows)]
fn get_clipboard_seq() -> u32 {
    use windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber;
    unsafe { GetClipboardSequenceNumber() }
}

#[cfg(not(windows))]
fn get_clipboard_seq() -> u32 {
    0
}

#[tauri::command]
pub async fn replace_text(
    window: WebviewWindow,
    new_text: String,
    restore_original_clipboard: Option<bool>,
    hide_window: Option<bool>,
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

    let pre_paste_seq = get_clipboard_seq();

    // 4. Simulate Ctrl+V to paste
    #[cfg(windows)]
    unsafe {
        crate::commands::input::simulate_ctrl_v();
    }

    // 5. Restore the original text, image, or empty clipboard after the target
    // has had enough time to consume the synthetic paste event. Poll the
    // clipboard sequence number so we restore as soon as the app has read it,
    // bounded by a text-length deadline to avoid hanging.
    let actually_restored = if should_restore {
        // Wait for target app to consume Ctrl+V from input queue and read clipboard
        wait_for_paste_consumed(pre_paste_seq, new_text.chars().count()).await;
        let restored = snapshot.restore(app);
        let monitor_text = if restored {
            snapshot.text_for_monitor()
        } else {
            new_text.as_str()
        };
        crate::commands::input::set_internal_action(app, false, Some(monitor_text));
        restored
    } else {
        tokio::time::sleep(Duration::from_millis(100)).await;
        crate::commands::input::set_internal_action(app, false, Some(&new_text));
        false
    };

    Ok(ReplacerResponse {
        success: true,
        replaced_length: length,
        restored_clipboard: actually_restored,
        safe_to_copy_fallback: false,
        error: None,
    })
}

#[cfg(test)]
mod tests {
    use super::paste_settle_delay;
    use super::wait_for_paste_consumed;
    use super::get_clipboard_seq;

    #[test]
    fn paste_delay_scales_without_becoming_unbounded() {
        assert_eq!(paste_settle_delay(0).as_millis(), 120);
        assert!(paste_settle_delay(5_000).as_millis() > 120);
        assert_eq!(paste_settle_delay(1_000_000).as_millis(), 500);
    }

    #[tokio::test]
    async fn paste_waits_full_deadline_when_clipboard_unchanged() {
        // When the clipboard sequence doesn't change, we must wait out the
        // text-length deadline and then restore — never hang, never return early.
        let seq = get_clipboard_seq();
        let start = std::time::Instant::now();
        let waited = wait_for_paste_consumed(seq, 0).await;
        assert!(waited.as_millis() >= 120, "expected >= deadline, got {}", waited.as_millis());
        assert!(start.elapsed().as_millis() >= 120);
    }
}
