//! User-facing feedback submission and external URL opening.
//!
//! Privacy-first: feedback is always saved to the local log and feedback store.
//! If telemetry (RUNBI_GLITCHTIP_DSN) is configured, it is also sent to GlitchTip/Sentry.

use tauri::Manager;

/// Submit a user feedback message to the local log and configured GlitchTip/Sentry endpoint.
#[tauri::command]
pub fn submit_feedback(app: tauri::AppHandle, message: String) -> Result<String, String> {
    let clean_msg = message.trim().to_string();
    if clean_msg.is_empty() {
        return Err("Feedback message cannot be empty".to_string());
    }

    // 1. Always record feedback to local file_log
    crate::commands::file_log(&app, &format!("[USER_FEEDBACK] {}", clean_msg));

    // 2. Also append to dedicated user_feedback.txt in app data directory
    if let Ok(dir) = app.path().app_config_dir() {
        let _ = std::fs::create_dir_all(&dir);
        let feedback_file = dir.join("user_feedback.txt");
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(feedback_file)
        {
            let _ = writeln!(f, "[{}] {}", ts, clean_msg);
        }
    }

    // 3. Optional Sentry/GlitchTip reporting if configured
    let dsn = std::env::var("RUNBI_GLITCHTIP_DSN")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            app.path().app_config_dir().ok().and_then(|dir| {
                let path = dir.join("config.json");
                std::fs::read_to_string(path).ok().and_then(|c| {
                    serde_json::from_str::<serde_json::Value>(&c)
                        .ok()
                        .and_then(|j| {
                            j.get("glitchtipDsn")
                                .and_then(|v| v.as_str())
                                .map(|s| s.trim().to_string())
                                .filter(|s| !s.is_empty())
                        })
                })
            })
        })
        .unwrap_or_default();

    if !dsn.is_empty() {
        let msg = format!("[用户反馈] {}", clean_msg);
        let event_id = sentry::capture_message(&msg, sentry::Level::Info);
        if !event_id.is_nil() {
            return Ok(format!("event_id={}", event_id));
        }
    }

    Ok("saved_locally".to_string())
}

/// Open an external URL in the user's default browser.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::process::Command;
        Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}
