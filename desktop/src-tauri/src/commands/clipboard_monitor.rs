//! Background Clipboard Monitor
//! Event-driven clipboard listener using Win32 AddClipboardFormatListener (WM_CLIPBOARDUPDATE).
//! Features privacy safeguards: default opt-in, sensitive password heuristics, and process blacklist.

use crate::commands::position::position_window_at_cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

#[derive(Clone)]
pub struct ClipboardMonitorState {
    pub enabled: Arc<AtomicBool>,
    pub started: Arc<AtomicBool>,
    pub last_content: Arc<Mutex<String>>,
    pub is_internal_action: Arc<AtomicBool>,
}

impl Default for ClipboardMonitorState {
    fn default() -> Self {
        Self {
            // Default opt-in to avoid unwanted popups and protect user privacy
            enabled: Arc::new(AtomicBool::new(false)),
            started: Arc::new(AtomicBool::new(false)),
            last_content: Arc::new(Mutex::new(String::new())),
            is_internal_action: Arc::new(AtomicBool::new(false)),
        }
    }
}

pub fn is_blacklisted_app(app_name: Option<&str>) -> bool {
    let app = app_name.unwrap_or_default().to_ascii_lowercase();
    let blacklist = [
        "keepass",
        "keepassxc",
        "1password",
        "bitwarden",
        "lastpass",
        "enpass",
        "dashlane",
        "authenticator",
        "authy",
        "roboform",
    ];
    blacklist.iter().any(|b| app.contains(b))
}

pub fn is_sensitive_or_password(text: &str) -> bool {
    let s = text.trim();
    if s.is_empty() {
        return false;
    }

    // 1. UUID format (36 chars: 8-4-4-4-12 hex)
    if s.len() == 36 && s.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        let parts: Vec<&str> = s.split('-').collect();
        if parts.len() == 5
            && parts[0].len() == 8
            && parts[1].len() == 4
            && parts[2].len() == 4
            && parts[3].len() == 4
            && parts[4].len() == 12
        {
            return true;
        }
    }

    // 2. High entropy token / random password heuristic:
    // Single-line string with no whitespace, length between 16 and 128, containing diverse character sets.
    // Paths/URLs share that shape (slashes + mixed charset) and are legitimate polish input,
    // so anything path/URL-shaped is exempt — silently dropping them read as "capsule dead".
    let looks_like_path_or_url = s.contains("://") || s.matches(['/', '\\']).count() >= 2;
    if !looks_like_path_or_url
        && !s.contains(|c: char| c.is_whitespace())
        && s.len() >= 16
        && s.len() <= 128
    {
        let has_lower = s.chars().any(|c| c.is_ascii_lowercase());
        let has_upper = s.chars().any(|c| c.is_ascii_uppercase());
        let has_digit = s.chars().any(|c| c.is_ascii_digit());
        let has_symbol = s.chars().any(|c| !c.is_ascii_alphanumeric());

        let variety =
            (has_lower as u8) + (has_upper as u8) + (has_digit as u8) + (has_symbol as u8);
        if variety >= 3 {
            return true;
        }
    }

    // 3. Chinese PII (whole-string-only policy: the trimmed text must BE the
    // sensitive value, not merely contain one — polishing a business message
    // that mentions a phone number must stay allowed). Catch: CN mobile
    // number, GB 11643-1999 ID card (checksum verified), Luhn bank card.
    if is_chinese_pii(s).is_some() {
        return true;
    }

    false
}

/// GB 11643-1999 ID card checksum (ISO 7064 MOD 11-2). `id` must be the full
/// 18-char uppercased ID with a digit or 'X' check digit.
fn id_card_checksum_valid(id: &str) -> bool {
    const WEIGHTS: [u32; 17] = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    const CHECK: [char; 11] = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];

    let chars: Vec<char> = id.chars().collect();
    if chars.len() != 18 || chars[17] != 'X' && !chars[17].is_ascii_digit() {
        return false;
    }
    let Some(sum) = chars[..17]
        .iter()
        .enumerate()
        .try_fold(0u32, |acc, (i, c)| {
            c.to_digit(10).map(|d| acc + d * WEIGHTS[i])
        })
    else {
        return false;
    };
    CHECK[(sum % 11) as usize].eq_ignore_ascii_case(&chars[17])
}

/// Luhn checksum for 13–19 digit bank card numbers.
fn luhn_valid(digits: &[u8]) -> bool {
    if digits.len() < 13 || digits.len() > 19 {
        return false;
    }
    let mut sum = 0u32;
    for (i, d) in digits.iter().rev().enumerate() {
        let mut d = *d as u32;
        if i % 2 == 1 {
            d *= 2;
            if d > 9 {
                d -= 9;
            }
        }
        sum += d;
    }
    sum % 10 == 0
}

/// Detects Chinese high-frequency PII when the WHOLE trimmed string is that
/// value. Returns Some(reason) for reporting/tests; never flags substrings.
pub fn is_chinese_pii(s: &str) -> Option<&'static str> {
    let t = s.trim();

    // CN mobile number: 1[3-9] followed by 9 digits (11 total, digits only)
    if t.len() == 11
        && t.as_bytes()[0] == b'1'
        && t.as_bytes()[1].is_ascii_digit()
        && t.as_bytes()[1] >= b'3'
        && t.bytes().all(|b| b.is_ascii_digit())
    {
        return Some("疑似手机号");
    }

    // CN resident ID card: 18 chars, first 17 digits, check digit 0-9/X,
    // verified with the official MOD 11-2 weights to avoid false positives.
    // ponytail: 判长必须用字符数——`t.len()` 是字节数,6 个汉字(18 字节)曾让
    // chars[..17] 越界 panic,且 panic 发生在 extern "system" 回调里直接 abort。
    if t.chars().count() == 18 {
        let upper = t.to_ascii_uppercase();
        let chars: Vec<char> = upper.chars().collect();
        if chars.len() == 18
            && chars[..17].iter().all(|c| c.is_ascii_digit())
            && (chars[17].is_ascii_digit() || chars[17] == 'X')
            && id_card_checksum_valid(&upper)
        {
            return Some("疑似身份证号");
        }
    }

    // Bank card: 13–19 digits passing Luhn
    if t.len() >= 13 && t.len() <= 19 && t.bytes().all(|b| b.is_ascii_digit()) {
        let digits: Vec<u8> = t.bytes().map(|b| b - b'0').collect();
        if luhn_valid(&digits) {
            return Some("疑似银行卡号");
        }
    }

    None
}

#[cfg(windows)]
pub fn read_system_clipboard() -> Option<String> {
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
    };
    use windows_sys::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};

    const CF_UNICODETEXT: u32 = 13;

    unsafe {
        if OpenClipboard(std::ptr::null_mut()) == 0 {
            return None;
        }
        let result = if IsClipboardFormatAvailable(CF_UNICODETEXT) != 0 {
            let handle = GetClipboardData(CF_UNICODETEXT);
            if !handle.is_null() {
                let ptr = GlobalLock(handle) as *const u16;
                if !ptr.is_null() {
                    let max_units = GlobalSize(handle) / std::mem::size_of::<u16>();
                    let bounded = std::slice::from_raw_parts(ptr, max_units);
                    let len = bounded.iter().position(|&c| c == 0).unwrap_or(max_units);
                    let s = String::from_utf16_lossy(&bounded[..len]);
                    GlobalUnlock(handle);
                    Some(s)
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };
        CloseClipboard();
        result
    }
}

#[cfg(not(windows))]
pub fn read_system_clipboard() -> Option<String> {
    None
}

/// Core clipboard change evaluation
pub fn handle_clipboard_change(app: &AppHandle, state: &ClipboardMonitorState) {
    if !state.enabled.load(Ordering::Relaxed) {
        return;
    }

    if state.is_internal_action.load(Ordering::Relaxed) {
        return;
    }

    let current_clip = read_system_clipboard().or_else(|| app.clipboard().read_text().ok());
    let Some(text) = current_clip else { return };
    let trimmed = text.trim();

    if trimmed.is_empty() || trimmed.len() > 50000 {
        return;
    }

    // Heuristic 1: Filter out passwords, UUIDs, high entropy tokens
    if is_sensitive_or_password(trimmed) {
        return;
    }

    // Heuristic 2: Filter out password managers by foreground context
    let (source_app, window_title) = crate::commands::selection::get_foreground_context();
    if is_blacklisted_app(source_app.as_deref()) {
        return;
    }

    let mut should_trigger = false;
    if let Ok(mut last) = state.last_content.lock() {
        if *last != text {
            *last = text.clone();
            should_trigger = true;
        }
    }

    if should_trigger {
        let generation = crate::commands::mouse_hook::SELECTION_GENERATION.load(Ordering::SeqCst);
        let is_chat = crate::commands::screenshot::is_likely_conversation_window(
            source_app.as_deref(),
            window_title.as_deref(),
        );
        let screenshot = if is_chat {
            crate::commands::screenshot::capture_foreground_screenshot().ok()
        } else {
            None
        };

        if let Some(window) = app.get_webview_window("main") {
            let win_clone = window.clone();
            let text_clone = text.clone();
            tauri::async_runtime::spawn(async move {
                if generation != crate::commands::mouse_hook::SELECTION_GENERATION.load(Ordering::SeqCst) {
                    return;
                }
                // Automatic clipboard capture follows the same entry rule as
                // mouse selection: show the capsule, never the full panel.
                if let Err(e) = position_window_at_cursor(win_clone.clone(), Some(true)).await {
                    eprintln!("[Runbi] clipboard capsule positioning failed: {e}");
                    return;
                }
                let app = win_clone.app_handle().clone();
                let _ = app.run_on_main_thread(move || {
                    if generation != crate::commands::mouse_hook::SELECTION_GENERATION.load(Ordering::SeqCst) {
                        return;
                    }
                    let _ = win_clone.show();
                    let _ = win_clone.unminimize();
                    let _ = win_clone.emit(
                        "runbi://captured-selection",
                        serde_json::json!({
                            "text": text_clone,
                            "sourceApp": source_app,
                            "windowTitle": window_title,
                            "screenshot": screenshot,
                            "trigger": "clipboard",
                            "generation": generation,
                            "capsule": true,
                        }),
                    );
                });
            });
        }
    }
}

pub fn start_clipboard_monitor(app: &AppHandle, state: ClipboardMonitorState) {
    if state.started.swap(true, Ordering::SeqCst) {
        return;
    }
    let app_handle = app.clone();

    // Initialize with current clipboard content so it doesn't pop up on app start
    let initial_clip = read_system_clipboard().or_else(|| app_handle.clipboard().read_text().ok());
    if let Some(text) = initial_clip {
        if let Ok(mut last) = state.last_content.lock() {
            *last = text;
        }
    }

    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
        use windows_sys::Win32::System::DataExchange::{
            AddClipboardFormatListener, RemoveClipboardFormatListener,
        };
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW,
            PostQuitMessage, RegisterClassW, TranslateMessage, MSG, WM_CLIPBOARDUPDATE, WM_DESTROY,
            WNDCLASSW,
        };

        let state_clone = state.clone();
        let app_clone = app_handle.clone();

        std::thread::spawn(move || unsafe {
            static GLOBAL_STATE: OnceLock<(ClipboardMonitorState, AppHandle)> = OnceLock::new();
            let _ = GLOBAL_STATE.set((state_clone, app_clone));

            unsafe extern "system" fn window_proc(
                hwnd: HWND,
                msg: u32,
                w_param: WPARAM,
                l_param: LPARAM,
            ) -> LRESULT {
                match msg {
                    WM_CLIPBOARDUPDATE => {
                        if let Some((s, a)) = GLOBAL_STATE.get() {
                            handle_clipboard_change(a, s);
                        }
                        0
                    }
                    WM_DESTROY => {
                        RemoveClipboardFormatListener(hwnd);
                        PostQuitMessage(0);
                        0
                    }
                    _ => DefWindowProcW(hwnd, msg, w_param, l_param),
                }
            }

            let class_name: Vec<u16> = "RunbiClipboardListenerClass\0".encode_utf16().collect();
            let wc = WNDCLASSW {
                style: 0,
                lpfnWndProc: Some(window_proc),
                cbClsExtra: 0,
                cbWndExtra: 0,
                hInstance: std::ptr::null_mut(),
                hIcon: std::ptr::null_mut(),
                hCursor: std::ptr::null_mut(),
                hbrBackground: std::ptr::null_mut(),
                lpszMenuName: std::ptr::null(),
                lpszClassName: class_name.as_ptr(),
            };

            RegisterClassW(&wc);

            let hwnd = CreateWindowExW(
                0,
                class_name.as_ptr(),
                std::ptr::null(),
                0,
                0,
                0,
                0,
                0,
                std::ptr::null_mut(), // HWND_MESSAGE
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null(),
            );

            if !hwnd.is_null() {
                AddClipboardFormatListener(hwnd);

                let mut msg: MSG = std::mem::zeroed();
                while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }

                DestroyWindow(hwnd);
            }
        });
    }

    #[cfg(not(windows))]
    {
        // Fallback for non-windows platforms if needed
    }
}

#[tauri::command]
pub fn set_clipboard_monitor_enabled(
    app: AppHandle,
    state: tauri::State<ClipboardMonitorState>,
    enabled: bool,
) -> Result<bool, String> {
    state.enabled.store(enabled, Ordering::SeqCst);
    if enabled {
        start_clipboard_monitor(&app, state.inner().clone());
    }
    Ok(enabled)
}

#[tauri::command]
pub fn get_clipboard_monitor_enabled(
    state: tauri::State<ClipboardMonitorState>,
) -> Result<bool, String> {
    Ok(state.enabled.load(Ordering::SeqCst))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_uuid_filtered() {
        assert!(is_sensitive_or_password(
            "123e4567-e89b-12d3-a456-426614174000"
        ));
        assert!(is_sensitive_or_password(
            "c9bf9e57-1685-4c89-bafb-ff5af830be8a"
        ));
    }

    #[test]
    fn cjk_text_of_18_bytes_never_panics_pii_check() {
        // 回归:6 个汉字 = 18 字节,旧代码按字节判长后 chars[..17] 越界,
        // 在 extern "system" 回调线程里 panic 直接 abort 整个进程。
        assert_eq!(is_chinese_pii("深度学习调研报告"), None);
        assert_eq!(is_chinese_pii("本周重点进展与渠道画像梳理"), None);
        // 真身份证(校验位合法)仍要拦
        assert_eq!(is_chinese_pii("11010519491231002X"), Some("疑似身份证号"));
    }

    #[test]
    fn test_random_password_filtered() {
        // High entropy alphanumeric + symbol string
        assert!(is_sensitive_or_password("dK9#mX2$pL9@vN4!"));
        assert!(is_sensitive_or_password("aB3$eF9#hJ2!kL5%"));
    }

    #[test]
    fn test_paths_and_urls_not_flagged_as_tokens() {
        // Regression: path/URL shape tripped the variety heuristic and the
        // capsule silently never appeared for file-path selections.
        assert!(!is_sensitive_or_password(
            "(file:///C:/Users/54191/lobsterai/project/research/architecture.md), 36KB)"
        ));
        assert!(!is_sensitive_or_password(
            "https://example.com/some/long/path/segment/that/is/pretty/long123"
        ));
        assert!(!is_sensitive_or_password(
            "C:\\Users\\someone\\Documents\\report_draft_v2.docx"
        ));
        // But a path-free random token is still caught.
        assert!(is_sensitive_or_password("Zx91Kk4$Qw7!Pp2@"));
    }

    #[test]
    fn test_normal_text_allowed() {
        assert!(!is_sensitive_or_password("这是一段正常的中文测试句子。"));
        assert!(!is_sensitive_or_password(
            "Please polish this sentence for my research paper."
        ));
        assert!(!is_sensitive_or_password("Hello World!"));
    }

    #[test]
    fn test_password_manager_blacklist() {
        assert!(is_blacklisted_app(Some("1Password.exe")));
        assert!(is_blacklisted_app(Some("KeePassXC.exe")));
        assert!(is_blacklisted_app(Some("bitwarden.exe")));
        assert!(!is_blacklisted_app(Some("Code.exe")));
        assert!(!is_blacklisted_app(Some("chrome.exe")));
        assert!(!is_blacklisted_app(None));
    }

    #[test]
    fn test_cn_mobile_number_filtered() {
        assert!(is_sensitive_or_password("13812345678"));
        assert!(is_sensitive_or_password("19912345678"));
        // 12x/10x prefixes are not mobile numbers
        assert!(!is_sensitive_or_password("12312345678"));
        assert!(!is_sensitive_or_password("10412345678"));
    }

    #[test]
    fn test_cn_id_card_checksum_enforced() {
        // Checksum-valid samples (ISO 7064 MOD 11-2)
        assert!(is_sensitive_or_password("11010519491231002X"));
        assert!(is_sensitive_or_password("11010519491231002x"));
        // 18 digits but checksum-invalid → likely an order number, allow it
        assert!(!is_sensitive_or_password("110105194912310021"));
        assert!(!is_sensitive_or_password("110105194912310022"));
    }

    #[test]
    fn test_bank_card_luhn_enforced() {
        // Luhn-valid test PANs
        assert!(is_sensitive_or_password("4111111111111111"));
        assert!(is_sensitive_or_password("5500005555555559"));
        // 16 digits failing Luhn → allow
        assert!(!is_sensitive_or_password("4111111111111112"));
        // 8-digit short number is not a card
        assert!(!is_sensitive_or_password("41111111"));
    }

    #[test]
    fn test_normal_text_still_allowed() {
        // Business text mentioning numbers inline must NOT be blocked
        // (whole-string-only policy)
        assert!(!is_sensitive_or_password(
            "客户电话是13812345678，请今天回电。"
        ));
        assert!(!is_sensitive_or_password("订单号 20260829 已发货"));
        assert!(!is_sensitive_or_password("会议改到明天下午三点"));
    }
}

