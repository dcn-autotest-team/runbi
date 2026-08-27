//! LLM Network Transport and Connection Testing
//! Bypasses browser CORS and connects directly to OpenAI / DeepSeek compatible endpoints.

use serde::{Deserialize, Serialize};
use std::time::Instant;
use tauri::WebviewWindow;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestConnectionRequest {
    pub endpoint: String,
    pub api_key: String,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestConnectionResponse {
    pub success: bool,
    pub latency_ms: u64,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn test_llm_connection(req: TestConnectionRequest) -> Result<TestConnectionResponse, String> {
    let client = reqwest::Client::new();
    let start = Instant::now();

    let model = req.model.unwrap_or_else(|| "deepseek-chat".to_string());

    let payload = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "user", "content": "ping"}
        ],
        "max_tokens": 1
    });

    let res = client
        .post(&req.endpoint)
        .header("Authorization", format!("Bearer {}", req.api_key))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await;

    let latency_ms = start.elapsed().as_millis() as u64;

    match res {
        Ok(resp) => {
            if resp.status().is_success() {
                Ok(TestConnectionResponse {
                    success: true,
                    latency_ms,
                    error: None,
                })
            } else {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                Ok(TestConnectionResponse {
                    success: false,
                    latency_ms,
                    error: Some(format!("HTTP {}: {}", status, text)),
                })
            }
        }
        Err(e) => Ok(TestConnectionResponse {
            success: false,
            latency_ms,
            error: Some(e.to_string()),
        }),
    }
}

#[tauri::command]
pub fn hide_window(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn app_ready(window: WebviewWindow) -> Result<(), String> {
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}
