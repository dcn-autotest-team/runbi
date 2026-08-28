//! Window Screenshot Command for Visual Context Perception
//! Captures the active foreground window using Win32 GDI and encodes as a compact JPEG data URL.

#[tauri::command]
pub fn capture_foreground_screenshot() -> Result<String, String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::{HWND, RECT, BOOL};
        use windows_sys::Win32::Graphics::Gdi::{
            BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
            GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
            SRCCOPY, HDC,
        };
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetAncestor, GetForegroundWindow, GetWindowRect,
        };

        extern "system" {
            fn PrintWindow(hwnd: HWND, hdc_blt: HDC, n_flags: u32) -> BOOL;
        }

        unsafe {
            let raw_hwnd: HWND = GetForegroundWindow();
            if raw_hwnd.is_null() {
                return Err("No active foreground window".to_string());
            }

            let root_hwnd = GetAncestor(raw_hwnd, 2 /* GA_ROOT */);
            let hwnd = if !root_hwnd.is_null() { root_hwnd } else { raw_hwnd };

            let mut rect: RECT = std::mem::zeroed();
            GetWindowRect(hwnd, &mut rect);
            let width = (rect.right - rect.left).max(1);
            let height = (rect.bottom - rect.top).max(1);

            let hdc_screen = GetDC(std::ptr::null_mut());
            let hdc_mem = CreateCompatibleDC(hdc_screen);
            let h_bitmap = CreateCompatibleBitmap(hdc_screen, width, height);
            let h_old_bmp = SelectObject(hdc_mem, h_bitmap);

            // Try PrintWindow first with PW_RENDERFULLCONTENT (2) for hardware-accelerated / DWM windows
            let printed = PrintWindow(hwnd, hdc_mem, 2);
            if printed == 0 {
                let src_x = rect.left.max(0);
                let src_y = rect.top.max(0);
                let blt_w = (rect.right - src_x).min(width).max(1);
                let blt_h = (rect.bottom - src_y).min(height).max(1);
                BitBlt(
                    hdc_mem,
                    0,
                    0,
                    blt_w,
                    blt_h,
                    hdc_screen,
                    src_x,
                    src_y,
                    SRCCOPY,
                );
            }

            let mut bmi: BITMAPINFO = std::mem::zeroed();
            bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
            bmi.bmiHeader.biWidth = width;
            bmi.bmiHeader.biHeight = -height; // Top-down DIB
            bmi.bmiHeader.biPlanes = 1;
            bmi.bmiHeader.biBitCount = 32;
            bmi.bmiHeader.biCompression = BI_RGB;

            let mut buffer: Vec<u8> = vec![0u8; (width * height * 4) as usize];
            GetDIBits(
                hdc_mem,
                h_bitmap,
                0,
                height as u32,
                buffer.as_mut_ptr() as *mut _,
                &mut bmi,
                DIB_RGB_COLORS,
            );

            SelectObject(hdc_mem, h_old_bmp);
            DeleteObject(h_bitmap);
            DeleteDC(hdc_mem);
            ReleaseDC(std::ptr::null_mut(), hdc_screen);

            // Convert BGRA to RGBA
            for chunk in buffer.chunks_exact_mut(4) {
                let b = chunk[0];
                let r = chunk[2];
                chunk[0] = r;
                chunk[2] = b;
                chunk[3] = 255;
            }

            let img = image::RgbaImage::from_raw(width as u32, height as u32, buffer)
                .ok_or_else(|| "Failed to construct image buffer".to_string())?;

            // Downscale to max width 1280 to keep latency minimal (< 10ms with Nearest)
            let target_img = if width > 1280 {
                let target_height = (height as f32 * 1280.0 / width as f32) as u32;
                image::imageops::resize(&img, 1280, target_height, image::imageops::FilterType::Nearest)
            } else {
                img
            };

            let mut jpeg_bytes = Vec::new();
            let mut cursor = std::io::Cursor::new(&mut jpeg_bytes);
            // JPEG has no alpha channel: the `image` crate rejects Rgba8, so drop to RGB8 first.
            image::DynamicImage::ImageRgba8(target_img)
                .to_rgb8()
                .write_to(&mut cursor, image::ImageFormat::Jpeg)
                .map_err(|e| format!("Failed to encode JPEG: {}", e))?;

            use base64::Engine;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&jpeg_bytes);
            let data_url = format!("data:image/jpeg;base64,{}", b64);
            // Keep the screenshot Rust-side: large base64 payloads get silently
            // dropped crossing the IPC bridge (WebView2 postMessage), so the
            // frontend only ever receives a hasScreenshot flag and the LLM call
            // pulls the image from here via use_last_screenshot.
            if let Ok(mut slot) = LAST_SCREENSHOT.lock() {
                *slot = Some(data_url.clone());
            }
            Ok(data_url)
        }
    }
    #[cfg(not(windows))]
    {
        Err("Screenshot not supported on non-windows platform".to_string())
    }
}

/// Last captured screenshot, kept in Rust memory (never crosses IPC whole).
#[allow(dead_code)]
pub static LAST_SCREENSHOT: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

#[allow(dead_code)]
pub fn last_screenshot() -> Option<String> {
    LAST_SCREENSHOT.lock().ok().and_then(|s| s.clone())
}

#[tauri::command]
#[allow(dead_code)]
pub fn has_last_screenshot() -> bool {
    LAST_SCREENSHOT.lock().map(|s| s.is_some()).unwrap_or(false)
}

/// Checks if foreground window is likely an IM / chat communication application
/// where vision context (screenshots) is genuinely useful for smart replies.
pub fn is_likely_conversation_window(source_app: Option<&str>, window_title: Option<&str>) -> bool {
    let app_lower = source_app.unwrap_or_default().to_ascii_lowercase();
    let title_lower = window_title.unwrap_or_default().to_ascii_lowercase();

    let chat_apps = [
        "wechat", "weixin", "wxwork", "dingtalk", "feishu", "lark",
        "slack", "teams", "telegram", "discord", "qq", "whatsapp", "skype", "line",
    ];

    for app in &chat_apps {
        if app_lower.contains(app) {
            return true;
        }
    }

    let chat_titles = [
        "微信", "企业微信", "钉钉", "飞书", "slack", "teams", "telegram",
        "discord", "qq", "whatsapp", "群聊", "会话", "chat",
    ];

    for title in &chat_titles {
        if title_lower.contains(title) {
            return true;
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_conversation_window_detection() {
        assert!(is_likely_conversation_window(Some("WeChat.exe"), None));
        assert!(is_likely_conversation_window(Some("Feishu.exe"), None));
        assert!(is_likely_conversation_window(Some("Lark.exe"), None));
        assert!(is_likely_conversation_window(Some("DingTalk.exe"), None));
        assert!(is_likely_conversation_window(Some("chrome.exe"), Some("微信网页版")));
        assert!(is_likely_conversation_window(Some("msedge.exe"), Some("飞书 - 沟通")));
        assert!(!is_likely_conversation_window(Some("notepad.exe"), Some("未命名 - 记事本")));
    }

    #[test]
    fn test_capture_foreground_screenshot_does_not_panic() {
        let res = capture_foreground_screenshot();
        eprintln!("[test_capture] res is_ok: {}, err: {:?}", res.is_ok(), res.as_ref().err());
    }
}

