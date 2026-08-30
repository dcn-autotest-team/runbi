//! App Configuration Persistence
//! Saves and loads app config to/from %APPDATA%\com.runbi.desktop\config.json

use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn get_config_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = match app.path().app_config_dir() {
        Ok(d) => d,
        Err(_) => {
            #[cfg(windows)]
            {
                if let Ok(appdata) = std::env::var("APPDATA") {
                    PathBuf::from(appdata).join("com.runbi.desktop")
                } else {
                    PathBuf::from(".").join(".config").join("com.runbi.desktop")
                }
            }
            #[cfg(not(windows))]
            {
                if let Ok(home) = std::env::var("HOME") {
                    PathBuf::from(home)
                        .join(".config")
                        .join("com.runbi.desktop")
                } else {
                    PathBuf::from(".").join(".config").join("com.runbi.desktop")
                }
            }
        }
    };

    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    Ok(dir.join("config.json"))
}

// ---- Secret protection (DPAPI) ------------------------------------------
// Secret fields (apiKey) are stored on disk as DPAPI blobs ("dpapi:<base64>")
// bound to the current Windows user. Frontend always receives/ sends plaintext
// via IPC only; plaintext never touches disk.

const SECRET_FIELDS: &[&str] = &["apiKey"];
const DPAPI_PREFIX: &str = "dpapi:";

#[cfg(windows)]
fn dpapi_protect(plain: &str) -> Result<String, String> {
    use base64::Engine;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB};

    unsafe {
        let bytes = plain.as_bytes();
        let in_blob = CRYPT_INTEGER_BLOB {
            cbData: bytes.len() as u32,
            pbData: bytes.as_ptr() as *mut u8,
        };
        let mut out = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };
        if CryptProtectData(
            &in_blob,
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            0,
            &mut out,
        ) == 0
        {
            return Err("CryptProtectData failed".to_string());
        }
        let slice = std::slice::from_raw_parts(out.pbData, out.cbData as usize);
        let encoded = base64::engine::general_purpose::STANDARD.encode(slice);
        LocalFree(out.pbData as _);
        Ok(format!("{}{}", DPAPI_PREFIX, encoded))
    }
}

#[cfg(windows)]
fn dpapi_unprotect(stored: &str) -> Result<String, String> {
    use base64::Engine;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(stored)
        .map_err(|e| format!("base64 decode failed: {}", e))?;
    unsafe {
        let in_blob = CRYPT_INTEGER_BLOB {
            cbData: bytes.len() as u32,
            pbData: bytes.as_ptr() as *mut u8,
        };
        let mut out = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };
        if CryptUnprotectData(
            &in_blob,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            0,
            &mut out,
        ) == 0
        {
            return Err("CryptUnprotectData failed".to_string());
        }
        let slice = std::slice::from_raw_parts(out.pbData, out.cbData as usize);
        let plain = String::from_utf8_lossy(slice).to_string();
        LocalFree(out.pbData as _);
        Ok(plain)
    }
}

/// Encrypt secret fields in a config object before writing to disk.
fn secure_for_disk(cfg: &mut serde_json::Value) {
    #[cfg(windows)]
    for field in SECRET_FIELDS {
        if let Some(obj) = cfg.as_object_mut() {
            if let Some(v) = obj.get(*field) {
                if let Some(s) = v.as_str() {
                    if !s.starts_with(DPAPI_PREFIX) {
                        if let Ok(enc) = dpapi_protect(s) {
                            obj.insert(field.to_string(), serde_json::Value::String(enc));
                        }
                    }
                }
            }
        }
    }
}

/// Decrypt secret fields for in-memory/frontend use.
fn unsecure_from_disk(cfg: &mut serde_json::Value) {
    #[cfg(windows)]
    for field in SECRET_FIELDS {
        if let Some(obj) = cfg.as_object_mut() {
            if let Some(v) = obj.get(*field).cloned() {
                if let Some(s) = v.as_str() {
                    if let Some(stored) = s.strip_prefix(DPAPI_PREFIX) {
                        if let Ok(plain) = dpapi_unprotect(stored) {
                            obj.insert(field.to_string(), serde_json::Value::String(plain));
                        }
                    }
                }
            }
        }
    }
}

fn has_plaintext_secret(cfg: &serde_json::Value) -> bool {
    SECRET_FIELDS.iter().any(|field| {
        cfg.get(field)
            .and_then(|value| value.as_str())
            .map(|value| !value.is_empty() && !value.starts_with(DPAPI_PREFIX))
            .unwrap_or(false)
    })
}

#[cfg(not(windows))]
fn secure_for_disk(_: &mut serde_json::Value) {}
#[cfg(not(windows))]
fn unsecure_from_disk(_: &mut serde_json::Value) {}

#[tauri::command]
pub fn load_app_config(app: AppHandle) -> Result<serde_json::Value, String> {
    let path = get_config_file_path(&app)?;
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }

    let content =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read config file: {}", e))?;

    if content.trim().is_empty() {
        return Ok(serde_json::json!({}));
    }

    let mut val: serde_json::Value =
        serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}));

    // Detect legacy plaintext before decrypting. Checking afterwards made every
    // normal DPAPI-backed startup rewrite config.json unnecessarily.
    let needs_secret_migration = has_plaintext_secret(&val);
    unsecure_from_disk(&mut val);

    // Migration: if a secret was stored in plaintext (pre-DPAPI build),
    // rewrite the file with the encrypted form immediately.
    if needs_secret_migration {
        let mut to_write = val.clone();
        secure_for_disk(&mut to_write);
        if let Ok(out) = serde_json::to_string_pretty(&to_write) {
            let _ = fs::write(&path, out);
        }
    }

    Ok(val)
}

#[cfg(test)]
mod tests {
    use super::has_plaintext_secret;

    #[test]
    fn only_legacy_plaintext_secrets_need_migration() {
        assert!(has_plaintext_secret(
            &serde_json::json!({ "apiKey": "legacy-key" })
        ));
        assert!(!has_plaintext_secret(
            &serde_json::json!({ "apiKey": "dpapi:encrypted" })
        ));
        assert!(!has_plaintext_secret(&serde_json::json!({ "apiKey": "" })));
    }
}

#[tauri::command]
pub fn save_app_config(app: AppHandle, config: serde_json::Value) -> Result<(), String> {
    let path = get_config_file_path(&app)?;
    let mut content = config;
    secure_for_disk(&mut content);
    let serialized = serde_json::to_string_pretty(&content)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    fs::write(&path, serialized).map_err(|e| format!("Failed to write config file: {}", e))?;

    Ok(())
}
