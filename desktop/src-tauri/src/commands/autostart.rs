//! Autostart Manager for Windows
//! Uses HKCU\Software\Microsoft\Windows\CurrentVersion\Run for zero-elevation user startup.

use tauri::AppHandle;

const APP_NAME: &str = "Runbi";
const REG_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";

#[tauri::command]
pub fn is_autostart_enabled() -> Result<bool, String> {
    #[cfg(windows)]
    {
        use std::process::Command;
        let output = Command::new("reg")
            .args(["query", REG_KEY, "/v", APP_NAME])
            .output()
            .map_err(|e| format!("Failed to query registry: {}", e))?;

        Ok(output.status.success())
    }
    #[cfg(not(windows))]
    {
        Ok(false)
    }
}

#[tauri::command]
pub fn set_autostart(_app: AppHandle, enabled: bool) -> Result<bool, String> {
    #[cfg(windows)]
    {
        use std::process::Command;
        if enabled {
            let current_exe = std::env::current_exe()
                .map_err(|e| format!("Failed to get current exe path: {}", e))?;
            let exe_path = current_exe.to_string_lossy().to_string();

            let reg_val = format!("\"{}\" --autostart", exe_path);

            let status = Command::new("reg")
                .args([
                    "add", REG_KEY, "/v", APP_NAME, "/t", "REG_SZ", "/d", &reg_val, "/f",
                ])
                .status()
                .map_err(|e| format!("Failed to add registry entry: {}", e))?;

            if !status.success() {
                return Err("Registry add command returned non-zero exit code".to_string());
            }
            Ok(true)
        } else {
            let _ = Command::new("reg")
                .args(["delete", REG_KEY, "/v", APP_NAME, "/f"])
                .status();
            Ok(false)
        }
    }
    #[cfg(not(windows))]
    {
        Ok(false)
    }
}
