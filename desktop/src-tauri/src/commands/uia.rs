//! Windows UI Automation text selection fallback and paste acknowledgement.

use std::time::{Duration, Instant};
use windows::Win32::{
    System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_MULTITHREADED,
    },
    UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationTextPattern, TextPatternRangeEndpoint_Start,
        TextUnit_Character, UIA_TextPatternId,
    },
};

struct ComGuard;

impl Drop for ComGuard {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

unsafe fn focused_text_pattern() -> Option<(ComGuard, IUIAutomationTextPattern)> {
    CoInitializeEx(None, COINIT_MULTITHREADED).ok().ok()?;
    let guard = ComGuard;
    let automation: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
    let focused = automation.GetFocusedElement().ok()?;
    let pattern = focused.GetCurrentPatternAs(UIA_TextPatternId).ok()?;
    Some((guard, pattern))
}

fn clean_text(text: String) -> Option<String> {
    let text = text.trim_matches(['\0', '\r', '\n']).to_string();
    (!text.trim().is_empty() && text.chars().count() <= 30_000).then_some(text)
}

pub fn selected_text() -> Option<String> {
    unsafe {
        let (_guard, pattern) = focused_text_pattern()?;
        let ranges = pattern.GetSelection().ok()?;
        let mut parts = Vec::new();
        for index in 0..ranges.Length().ok()? {
            if let Some(text) = clean_text(ranges.GetElement(index).ok()?.GetText(30_001).ok()?.to_string()) {
                parts.push(text);
            }
        }
        clean_text(parts.join("\n"))
    }
}

fn suffix_matches(actual: &str, expected: &str) -> bool {
    actual.replace('\r', "").ends_with(&expected.replace('\r', ""))
}

/// Polls the focused UIA text range until the text immediately before the
/// caret contains the pasted value. This is an acknowledgement, not a timer.
pub fn wait_for_pasted_text(expected: &str, timeout: Duration) -> bool {
    unsafe {
        let Some((_guard, pattern)) = focused_text_pattern() else {
            return false;
        };
        let wanted = expected.chars().count().min(30_000) as i32;
        let started = Instant::now();
        while started.elapsed() < timeout {
            if let Ok(ranges) = pattern.GetSelection() {
                if let Ok(range) = ranges.GetElement(0) {
                    let _ = range.MoveEndpointByUnit(
                        TextPatternRangeEndpoint_Start,
                        TextUnit_Character,
                        -(wanted + 2),
                    );
                    if let Ok(text) = range.GetText(wanted + 4) {
                        if suffix_matches(&text.to_string(), expected) {
                            return true;
                        }
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(40));
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::{clean_text, suffix_matches};

    #[test]
    fn normalizes_uia_text_without_accepting_empty_or_oversized_values() {
        assert_eq!(clean_text("\r\nselected\r\n".into()).as_deref(), Some("selected"));
        assert_eq!(clean_text(" \r\n".into()), None);
        assert!(clean_text("x".repeat(30_001)).is_none());
        assert!(suffix_matches("before\r\n润色完成", "润色完成"));
    }
}
