//! User-facing feedback submission.
//!
//! Privacy-first: feedback is only actually reported when the user has opted in
//! to telemetry (RUNBI_GLITCHTIP_DSN set). Otherwise we return a clear
//! "telemetry disabled" signal so the UI can guide the user instead of silently
//! dropping the feedback.

/// Submit a user feedback message to the configured GlitchTip/Sentry endpoint.
///
/// Returns:
///   Ok("telemetry_disabled")   -> no DSN configured, feedback NOT sent
///   Ok("queued")               -> sent for processing
///   Ok("event_id=<id>")        -> sent synchronously, event id returned
#[tauri::command]
pub fn submit_feedback(app: tauri::AppHandle, message: String) -> Result<String, String> {
    let dsn = std::env::var("RUNBI_GLITCHTIP_DSN").unwrap_or_default();
    let dsn = dsn.trim();

    if dsn.is_empty() {
        // Telemetry off — do NOT send anything. Return a clear signal so the
        // frontend can show "错误上报未启用" and point to the settings toggle.
        crate::commands::file_log(&app, &format!("feedback skipped (telemetry disabled): {}", message));
        return Ok("telemetry_disabled".to_string());
    }

    let msg = format!("[用户反馈] {}", message);
    // main.rs already init'd sentry with the same DSN when it was set, so the
    // global client is live and capture_message will reach GlitchTip.
    let event_id = sentry::capture_message(&msg, sentry::Level::Info);
    crate::commands::file_log(&app, &format!("feedback submitted: {}", message));

    if event_id.is_nil() {
        Ok("queued".to_string())
    } else {
        Ok(format!("event_id={}", event_id))
    }
}
