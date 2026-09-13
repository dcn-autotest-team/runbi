//! Window Screenshot Command for Visual Context Perception
//! Captures the active foreground window using Win32 GDI and encodes as a compact JPEG data URL.

/// Encode a top-down BGRA pixel buffer into a JPEG data URL.
///
/// REGRESSION GUARD (2026-08-29): JPEG has no alpha channel and the `image`
/// crate REJECTS the Rgba8 color type for Jpeg encoding. The original code
/// converted BGRA->RGBA and encoded directly, so EVERY capture failed with
/// "Failed to encode JPEG: does not support the color type `Rgba8`" — the
/// error was swallowed by `.is_ok()` upstream and screen-reply never fired.
/// We convert BGRA->RGB8 (alpha dropped) BEFORE encoding and unit-test this
/// helper so the failure mode can never silently return.
pub(crate) fn encode_bgra_to_jpeg(
    width: i32,
    height: i32,
    bgra: Vec<u8>,
) -> Result<String, String> {
    if width <= 0 || height <= 0 {
        return Err(format!("Invalid capture dimensions: {}x{}", width, height));
    }
    let px = (width as usize) * (height as usize);
    if bgra.len() < px * 4 {
        return Err("Failed to construct image buffer".to_string());
    }

    // BGRA -> RGB (swap B and R, drop alpha). Output color matches the old
    // BGRA->RGBA->to_rgb8 path exactly.
    let mut rgb: Vec<u8> = Vec::with_capacity(px * 3);
    for chunk in bgra[..px * 4].chunks_exact(4) {
        rgb.push(chunk[2]); // R
        rgb.push(chunk[1]); // G
        rgb.push(chunk[0]); // B
    }
    let img = image::RgbImage::from_raw(width as u32, height as u32, rgb)
        .ok_or_else(|| "Failed to construct image buffer".to_string())?;

    // Keep Chinese chat text readable for vision models. 1280px + nearest
    // neighbour made small glyphs collapse into similar-looking characters.
    let target_img = if width > 1920 {
        let target_height = (height as f32 * 1920.0 / width as f32) as u32;
        image::imageops::resize(
            &img,
            1920,
            target_height,
            image::imageops::FilterType::Lanczos3,
        )
    } else {
        img
    };

    let mut jpeg_bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg_bytes, 90)
        .encode_image(&target_img)
        .map_err(|e| format!("Failed to encode JPEG: {}", e))?;

    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&jpeg_bytes);
    Ok(format!("data:image/jpeg;base64,{}", b64))
}

#[tauri::command]
pub fn capture_foreground_screenshot() -> Result<String, String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetAncestor, GetForegroundWindow};

        unsafe {
            let raw_hwnd: windows_sys::Win32::Foundation::HWND = GetForegroundWindow();
            if raw_hwnd.is_null() {
                return Err("No active foreground window".to_string());
            }
            let root = GetAncestor(raw_hwnd, 2 /* GA_ROOT */);
            let hwnd = if !root.is_null() { root } else { raw_hwnd };
            capture_hwnd_to_jpeg(hwnd)
        }
    }
    #[cfg(not(windows))]
    {
        Err("Screenshot not supported on non-windows platform".to_string())
    }
}

/// Capture a chat app window WITHOUT focusing it (e.g. reply to WeChat while
/// staying in the current app). Matches a top-level visible window by process
/// image name (case-insensitive, `.exe` suffix optional), prefers the largest.
#[tauri::command]
pub fn capture_app_screenshot(process_name: String) -> Result<String, String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::GetAncestor;

        let want = process_name.trim().to_ascii_lowercase();
        let want = want
            .strip_suffix(".exe")
            .unwrap_or(&want)
            .trim()
            .to_string();
        if want.is_empty() {
            return Err("Empty process name".to_string());
        }
        unsafe {
            let hwnd = find_window_by_process(&want)
                .ok_or_else(|| format!("No visible window found for process '{}'", want))?;
            let root = GetAncestor(hwnd, 2 /* GA_ROOT */);
            capture_hwnd_to_jpeg(if !root.is_null() { root } else { hwnd })
        }
    }
    #[cfg(not(windows))]
    {
        let _ = process_name;
        Err("Screenshot not supported on non-windows platform".to_string())
    }
}

#[cfg(windows)]
pub(crate) fn process_name_matches(process_id: u32, want_lower: &str) -> bool {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id);
        if handle.is_null() {
            return false;
        }
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len);
        CloseHandle(handle);
        if ok == 0 || len == 0 {
            return false;
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        // 两侧都去掉 .exe 后缀后精确相等：source_app 本就是映像文件名，
        // contains 会误伤同名前缀进程（如 "test" 命中 "latest.exe"）
        let name = path
            .rsplit(['\\', '/'])
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        let name = name.strip_suffix(".exe").unwrap_or(&name);
        name == want_lower
    }
}

#[cfg(windows)]
pub(crate) unsafe fn find_window_by_process(
    want_lower: &str,
) -> Option<windows_sys::Win32::Foundation::HWND> {
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM, RECT};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowLongPtrW, GetWindowRect, GetWindowThreadProcessId, IsWindowVisible,
        GWL_EXSTYLE, WS_EX_TOOLWINDOW,
    };

    struct Scan {
        want: String,
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
        if pid == 0 || !process_name_matches(pid, &scan.want) {
            return 1;
        }
        let mut rect: RECT = std::mem::zeroed();
        GetWindowRect(hwnd, &mut rect);
        let area = (rect.right - rect.left) as i64 * (rect.bottom - rect.top) as i64;
        if area > scan.best_area {
            scan.best = Some(hwnd);
            scan.best_area = area;
        }
        1
    }

    let mut scan = Scan {
        want: want_lower.to_string(),
        best: None,
        best_area: 0,
    };
    EnumWindows(Some(on_window), &mut scan as *mut Scan as LPARAM);
    scan.best
}

#[cfg(windows)]
pub(crate) unsafe fn capture_hwnd_pixels(
    hwnd: windows_sys::Win32::Foundation::HWND,
) -> Result<(i32, i32, Vec<u8>), String> {
    use windows_sys::Win32::Foundation::{BOOL, HWND, RECT};
    use windows_sys::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
        HDC, SRCCOPY,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowRect;

    extern "system" {
        fn PrintWindow(hwnd: HWND, hdc_blt: HDC, n_flags: u32) -> BOOL;
    }

    unsafe {
        let mut rect: RECT = std::mem::zeroed();
        GetWindowRect(hwnd, &mut rect);
        let width = (rect.right - rect.left).max(1);
        let height = (rect.bottom - rect.top).max(1);
        let pixel_count = (width as usize)
            .checked_mul(height as usize)
            .filter(|count| *count <= 100_000_000)
            .ok_or_else(|| format!("Capture dimensions too large: {}x{}", width, height))?;

        let hdc_screen = GetDC(std::ptr::null_mut());
        if hdc_screen.is_null() {
            return Err("Failed to acquire screen DC".to_string());
        }
        let hdc_mem = CreateCompatibleDC(hdc_screen);
        if hdc_mem.is_null() {
            ReleaseDC(std::ptr::null_mut(), hdc_screen);
            return Err("Failed to create capture DC".to_string());
        }
        let h_bitmap = CreateCompatibleBitmap(hdc_screen, width, height);
        if h_bitmap.is_null() {
            DeleteDC(hdc_mem);
            ReleaseDC(std::ptr::null_mut(), hdc_screen);
            return Err("Failed to create capture bitmap".to_string());
        }
        let h_old_bmp = SelectObject(hdc_mem, h_bitmap);
        if h_old_bmp.is_null() {
            DeleteObject(h_bitmap);
            DeleteDC(hdc_mem);
            ReleaseDC(std::ptr::null_mut(), hdc_screen);
            return Err("Failed to select capture bitmap".to_string());
        }

        // BitBlt the screen first: it always reflects what the user actually
        // sees right now. PrintWindow(PW_RENDERFULLCONTENT) is only the
        // fallback — on Chromium/DirectComposition windows it can succeed yet
        // hand back a STALE frame (old tab content), which made the vision
        // model analyze a page the user had already navigated away from and
        // read as "the model is making things up".
        // ponytail: BitBlt captures whatever overlays the window rect when the
        // window is occluded — acceptable, since "what the user sees" is
        // exactly the goal; PrintWindow stays as the occluded-window fallback.
        let src_x = rect.left.max(0);
        let src_y = rect.top.max(0);
        let blt_w = (rect.right - src_x).min(width).max(1);
        let blt_h = (rect.bottom - src_y).min(height).max(1);
        BitBlt(
            hdc_mem, 0, 0, blt_w, blt_h, hdc_screen, src_x, src_y, SRCCOPY,
        );

        let mut bmi: BITMAPINFO = std::mem::zeroed();
        bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bmi.bmiHeader.biWidth = width;
        bmi.bmiHeader.biHeight = -height; // Top-down DIB
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = BI_RGB;

        let mut buffer: Vec<u8> = vec![0u8; pixel_count * 4];
        let copied_rows = GetDIBits(
            hdc_mem,
            h_bitmap,
            0,
            height as u32,
            buffer.as_mut_ptr() as *mut _,
            &mut bmi,
            DIB_RGB_COLORS,
        );

        // All-black read = window occluded/protected (BitBlt off screen gets
        // nothing usable). Retry with PrintWindow, which renders the window
        // content directly even while it is in the background.
        // ponytail: scanning with any() short-circuits on the first non-black
        // pixel (typically within a few rows). It only scans the full buffer
        // when the screen is actually all-black, avoiding PrintWindow's stale
        // DirectComposition frames on maximized Chromium windows whose top
        // border or dark titlebar is black.
        if copied_rows != 0 {
            let all_black = is_buffer_all_black(&buffer);
            if all_black && PrintWindow(hwnd, hdc_mem, 2) != 0 {
                GetDIBits(
                    hdc_mem,
                    h_bitmap,
                    0,
                    height as u32,
                    buffer.as_mut_ptr() as *mut _,
                    &mut bmi,
                    DIB_RGB_COLORS,
                );
            }
        }

        SelectObject(hdc_mem, h_old_bmp);
        DeleteObject(h_bitmap);
        DeleteDC(hdc_mem);
        ReleaseDC(std::ptr::null_mut(), hdc_screen);

        if copied_rows == 0 {
            return Err("Failed to read captured pixels".to_string());
        }

        Ok((width, height, buffer))
    }
}

#[cfg(windows)]
pub(crate) unsafe fn capture_hwnd_to_jpeg(
    hwnd: windows_sys::Win32::Foundation::HWND,
) -> Result<String, String> {
    let (width, height, buffer) = capture_hwnd_pixels(hwnd)?;
    let data_url = encode_bgra_to_jpeg(width, height, buffer)?;
    // Keep the screenshot Rust-side: large base64 payloads get silently
    // dropped crossing the IPC bridge (WebView2 postMessage), so the
    // frontend only ever receives a hasScreenshot flag and the LLM call
    // pulls the image from here via use_last_screenshot.
    if let Ok(mut slot) = LAST_SCREENSHOT.lock() {
        *slot = Some(data_url.clone());
    }
    Ok(data_url)
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
pub(crate) const CHAT_PROCESS_NAMES: &[&str] = &[
    "wechat", "weixin", "wxwork", "dingtalk", "feishu", "lark", "slack", "teams", "telegram",
    "discord", "qq", "whatsapp", "skype", "line",
];

pub fn is_likely_conversation_window(source_app: Option<&str>, window_title: Option<&str>) -> bool {
    let app_lower = source_app.unwrap_or_default().to_ascii_lowercase();
    let title_lower = window_title.unwrap_or_default().to_ascii_lowercase();

    for app in CHAT_PROCESS_NAMES {
        if app_lower.contains(app) {
            return true;
        }
    }

    let chat_titles = [
        "微信",
        "企业微信",
        "钉钉",
        "飞书",
        "slack",
        "teams",
        "telegram",
        "discord",
        "qq",
        "whatsapp",
        "群聊",
        "会话",
        "chat",
    ];

    for title in &chat_titles {
        if title_lower.contains(title) {
            return true;
        }
    }

    false
}

/// Checks if every pixel in the BGRA buffer is black (R=G=B=0).
/// Short-circuits immediately on the first non-black pixel.
pub(crate) fn is_buffer_all_black(buffer: &[u8]) -> bool {
    !buffer.chunks_exact(4).any(|px| px[0] | px[1] | px[2] != 0)
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
        assert!(is_likely_conversation_window(
            Some("chrome.exe"),
            Some("微信网页版")
        ));
        assert!(is_likely_conversation_window(
            Some("msedge.exe"),
            Some("飞书 - 沟通")
        ));
        assert!(!is_likely_conversation_window(
            Some("notepad.exe"),
            Some("未命名 - 记事本")
        ));
    }

    #[test]
    fn test_capture_foreground_screenshot_does_not_panic() {
        let res = capture_foreground_screenshot();
        eprintln!(
            "[test_capture] res is_ok: {}, err: {:?}",
            res.is_ok(),
            res.as_ref().err()
        );
    }

    #[test]
    fn jpeg_encode_accepts_valid_bgra_buffer() {
        // 4x2 solid red pixels (BGRA: B=0 G=0 R=255 A=255)
        let mut buf = Vec::new();
        for _ in 0..8 {
            buf.extend_from_slice(&[0, 0, 255, 255]);
        }
        let url = encode_bgra_to_jpeg(4, 2, buf).expect("encode must succeed");
        assert!(url.starts_with("data:image/jpeg;base64,"));
        assert!(url.len() > 40);
    }

    #[test]
    fn jpeg_encode_downscales_wide_windows_instead_of_failing() {
        let buf = vec![10u8; 1921 * 2 * 4];
        let url = encode_bgra_to_jpeg(1921, 2, buf).expect("wide encode must succeed");
        assert!(url.starts_with("data:image/jpeg;base64,"));

        use base64::Engine;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(url.trim_start_matches("data:image/jpeg;base64,"))
            .unwrap();
        assert_eq!(image::load_from_memory(&bytes).unwrap().width(), 1920);
    }

    #[test]
    fn jpeg_encode_rejects_short_buffer_and_bad_dimensions() {
        assert!(encode_bgra_to_jpeg(4, 2, vec![0u8; 4]).is_err());
        assert!(encode_bgra_to_jpeg(0, 2, vec![0u8; 64]).is_err());
        assert!(encode_bgra_to_jpeg(-5, 2, vec![0u8; 64]).is_err());
    }

    /// Canary: the `image` crate refuses RGBA8 for Jpeg. If this test starts
    /// failing, the crate now supports RGBA-JPEG and the RGB8 conversion in
    /// encode_bgra_to_jpeg could be simplified — until then it is load-bearing.
    #[test]
    fn canary_image_crate_still_rejects_rgba8_jpeg() {
        let img = image::RgbaImage::from_raw(2, 2, vec![255u8; 16]).unwrap();
        let out: Result<Vec<u8>, _> = {
            let mut c = std::io::Cursor::new(Vec::new());
            let r = img.write_to(&mut c, image::ImageFormat::Jpeg);
            r.map(|_| c.into_inner())
        };
        assert!(
            out.is_err(),
            "crate now supports RGBA-Jpeg; revisit encode_bgra_to_jpeg comment"
        );
    }

    #[test]
    fn test_is_buffer_all_black() {
        // All black pixels
        let black = vec![0u8; 4096 * 4];
        assert!(is_buffer_all_black(&black));

        // First 4096 pixels black, but a non-black pixel at 4097
        let mut with_content = vec![0u8; 4096 * 4 + 4];
        with_content[4096 * 4 + 1] = 255; // G = 255
        assert!(!is_buffer_all_black(&with_content));

        // Alpha non-zero does NOT count as non-black
        let mut black_opaque = vec![0u8; 16];
        black_opaque[3] = 255;
        black_opaque[7] = 255;
        assert!(is_buffer_all_black(&black_opaque));
    }
}
