//! Global Hotkey Management
//! Dynamic register/unregister of the wake-up shortcut, persisted via the store plugin.

use std::sync::Mutex;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
use tauri_plugin_store::{StoreExt, JsonValue};

pub const DEFAULT_SHORTCUT: &str = "Ctrl+Shift+Space";

/// Fallback candidates when the preferred shortcut is already taken
/// by another application (e.g. Antigravity / Cherry Studio floating panels).
const FALLBACK_SHORTCUTS: &[&str] = &["Ctrl+Alt+Space", "Ctrl+Shift+R", "Alt+Shift+R", "Ctrl+Alt+R"];

/// Tracks the currently registered shortcut so we can swap it at runtime.
static CURRENT: Mutex<Option<String>> = Mutex::new(None);

/// Read the persisted shortcut (or the default on first run).
pub fn load_shortcut(app: &AppHandle) -> String {
    if let Ok(cfg) = super::config::load_app_config(app.clone()) {
        if let Some(s) = cfg.get("wakeShortcut").or_else(|| cfg.get("runbi:wakeShortcut")).and_then(|v| v.as_str()) {
            if !s.trim().is_empty() {
                return s.to_string();
            }
        }
    }
    app.store("settings.json")
        .ok()
        .and_then(|s| s.get("wakeShortcut"))
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| DEFAULT_SHORTCUT.to_string())
}

/// Register the given shortcut, replacing the previously registered one.
pub fn register_shortcut(app: &AppHandle, shortcut_str: &str) -> Result<(), String> {
    let shortcut: Shortcut = shortcut_str.parse().map_err(|e| format!("Invalid shortcut: {}", e))?;

    // Unregister the previous one to avoid conflicts.
    let prev = CURRENT.lock().unwrap().clone();
    if let Some(prev_str) = prev {
        if let Ok(prev_shortcut) = prev_str.parse::<Shortcut>() {
            let _ = app.global_shortcut().unregister(prev_shortcut);
        }
    }

    app.global_shortcut()
        .register(shortcut)
        .map_err(|e| format!("Failed to register shortcut: {}", e))?;

    *CURRENT.lock().unwrap() = Some(shortcut_str.to_string());
    Ok(())
}

/// Register the preferred shortcut; if taken, silently try fallbacks.
/// Returns (effective_shortcut, used_fallback).
pub fn register_with_fallback(app: &AppHandle, preferred: &str) -> Result<(String, bool), String> {
    if register_shortcut(app, preferred).is_ok() {
        return Ok((preferred.to_string(), false));
    }
    for fb in FALLBACK_SHORTCUTS {
        if *fb == preferred {
            continue;
        }
        if register_shortcut(app, fb).is_ok() {
            return Ok((fb.to_string(), true));
        }
    }
    Err("All wake shortcut candidates are taken".to_string())
}

/// Get the currently active shortcut.
#[tauri::command]
pub fn get_global_shortcut(app: AppHandle) -> Result<String, String> {
    Ok(CURRENT.lock().unwrap().clone().unwrap_or_else(|| load_shortcut(&app)))
}

/// Set and persist a new wake shortcut. Returns the registered shortcut on success.
#[tauri::command]
pub fn set_global_shortcut(app: AppHandle, shortcut: String) -> Result<String, String> {
    let trimmed = shortcut.trim().to_string();
    if trimmed.is_empty() {
        return Err("Shortcut cannot be empty".to_string());
    }

    register_shortcut(&app, &trimmed)?;

    // Persist for next launch.
    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    store.set("wakeShortcut", JsonValue::String(trimmed.clone()));
    store.save().map_err(|e| e.to_string())?;

    Ok(trimmed)
}
