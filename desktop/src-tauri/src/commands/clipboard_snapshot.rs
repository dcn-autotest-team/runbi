//! Minimal clipboard snapshot used around synthetic Ctrl+C / Ctrl+V.
//! Preserves the common text and image cases and refuses unknown non-empty formats.

use tauri::{image::Image, AppHandle};
use tauri_plugin_clipboard_manager::ClipboardExt;

pub enum ClipboardSnapshot {
    Text(String),
    Image {
        rgba: Vec<u8>,
        width: u32,
        height: u32,
    },
    Empty,
    Unsupported,
}

impl ClipboardSnapshot {
    pub fn capture(app: &AppHandle) -> Self {
        let clipboard = app.clipboard();
        if let Ok(text) = clipboard.read_text() {
            return Self::Text(text);
        }
        if let Ok(image) = clipboard.read_image() {
            return Self::Image {
                rgba: image.rgba().to_vec(),
                width: image.width(),
                height: image.height(),
            };
        }
        if clipboard_has_formats() {
            Self::Unsupported
        } else {
            Self::Empty
        }
    }

    pub fn can_restore(&self) -> bool {
        !matches!(self, Self::Unsupported)
    }

    pub fn text_for_monitor(&self) -> &str {
        match self {
            Self::Text(text) => text,
            _ => "",
        }
    }

    pub fn restore(&self, app: &AppHandle) -> bool {
        let clipboard = app.clipboard();
        match self {
            Self::Text(text) => clipboard.write_text(text).is_ok(),
            Self::Image {
                rgba,
                width,
                height,
            } => clipboard
                .write_image(&Image::new_owned(rgba.clone(), *width, *height))
                .is_ok(),
            Self::Empty => clipboard.clear().is_ok(),
            Self::Unsupported => false,
        }
    }
}

#[cfg(windows)]
fn clipboard_has_formats() -> bool {
    use windows_sys::Win32::System::DataExchange::CountClipboardFormats;
    unsafe { CountClipboardFormats() > 0 }
}

#[cfg(not(windows))]
fn clipboard_has_formats() -> bool {
    false
}
