//! Windows UI Automation text selection fallback and paste acknowledgement.

use std::time::{Duration, Instant};
use windows::Win32::{
    System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_MULTITHREADED,
    },
    UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationTextPattern,
        IUIAutomationTreeWalker, TextPatternRangeEndpoint_Start, TextUnit_Character,
        UIA_EditControlTypeId, UIA_TextPatternId,
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
    let automation: IUIAutomation =
        CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
    let focused = automation.GetFocusedElement().ok()?;
    let pattern = focused.GetCurrentPatternAs(UIA_TextPatternId).ok()?;
    Some((guard, pattern))
}

fn edit_candidate_score(left: i32, top: i32, right: i32, bottom: i32) -> Option<(i32, i64)> {
    let width = (right - left) as i64;
    let height = (bottom - top) as i64;
    (width >= 80 && height >= 15).then_some((bottom, width * height))
}

unsafe fn find_bottom_edit(
    walker: &IUIAutomationTreeWalker,
    element: &IUIAutomationElement,
    best: &mut Option<((i32, i64), IUIAutomationElement)>,
    visited: &mut usize,
) {
    if *visited >= 2_000 {
        return;
    }
    *visited += 1;

    if element.CurrentControlType().ok() == Some(UIA_EditControlTypeId)
        && element
            .CurrentIsEnabled()
            .map(|v| v.as_bool())
            .unwrap_or(false)
        && element
            .CurrentIsKeyboardFocusable()
            .map(|v| v.as_bool())
            .unwrap_or(false)
    {
        if let Ok(rect) = element.CurrentBoundingRectangle() {
            if let Some(score) = edit_candidate_score(rect.left, rect.top, rect.right, rect.bottom)
            {
                if best.as_ref().map(|(old, _)| score > *old).unwrap_or(true) {
                    *best = Some((score, element.clone()));
                }
            }
        }
    }

    let Ok(mut child) = walker.GetFirstChildElement(element) else {
        return;
    };
    loop {
        find_bottom_edit(walker, &child, best, visited);
        let Ok(next) = walker.GetNextSiblingElement(&child) else {
            break;
        };
        child = next;
    }
}

/// Focuses the lowest editable control in a top-level application window.
/// Feishu exposes its message composer through UI Automation even though the
/// native HWND itself is a Chromium render surface.
pub fn focus_bottom_editable_in_window(hwnd: isize) -> bool {
    unsafe {
        if CoInitializeEx(None, COINIT_MULTITHREADED).ok().is_err() {
            return false;
        }
        let _guard = ComGuard;
        let Ok(automation): Result<IUIAutomation, _> =
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
        else {
            return false;
        };
        let Ok(root) = automation.ElementFromHandle(windows::Win32::Foundation::HWND(
            hwnd as *mut core::ffi::c_void,
        )) else {
            return false;
        };
        let Ok(walker) = automation.ControlViewWalker() else {
            return false;
        };
        let mut best = None;
        let mut visited = 0;
        find_bottom_edit(&walker, &root, &mut best, &mut visited);
        best.and_then(|(_, edit)| edit.SetFocus().ok()).is_some()
    }
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
            if let Some(text) = clean_text(
                ranges
                    .GetElement(index)
                    .ok()?
                    .GetText(30_001)
                    .ok()?
                    .to_string(),
            ) {
                parts.push(text);
            }
        }
        clean_text(parts.join("\n"))
    }
}

fn suffix_matches(actual: &str, expected: &str) -> bool {
    actual
        .replace('\r', "")
        .ends_with(&expected.replace('\r', ""))
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
    use super::{clean_text, edit_candidate_score, suffix_matches};

    #[test]
    fn normalizes_uia_text_without_accepting_empty_or_oversized_values() {
        assert_eq!(
            clean_text("\r\nselected\r\n".into()).as_deref(),
            Some("selected")
        );
        assert_eq!(clean_text(" \r\n".into()), None);
        assert!(clean_text("x".repeat(30_001)).is_none());
        assert!(suffix_matches("before\r\n润色完成", "润色完成"));
    }

    #[test]
    fn editable_candidate_rejects_tiny_controls_and_prefers_the_lower_one() {
        assert_eq!(edit_candidate_score(0, 0, 20, 20), None);
        assert!(edit_candidate_score(0, 500, 400, 650) > edit_candidate_score(0, 10, 300, 40));
    }
}
