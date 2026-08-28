//! LLM Network Transport and Connection Testing
//! Bypasses browser CORS and connects directly to OpenAI / DeepSeek compatible endpoints.

use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Instant;
use tauri::ipc::Channel;
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum StreamEvent {
    Chunk { delta: String },
    Done { duration_ms: u64, total_tokens: usize },
    Error { message: String },
}

#[tauri::command]
pub async fn stream_llm_chat(
    app: tauri::AppHandle,
    endpoint: String,
    api_key: String,
    model: String,
    system_prompt: String,
    user_prompt: String,
    temperature: Option<f32>,
    image_data_url: Option<String>,
    channel: Channel<StreamEvent>,
) -> Result<(), String> {
    let start = Instant::now();
    // Streaming-friendly timeouts: connect_timeout covers dial + TLS handshake,
    // read_timeout covers each body chunk individually. A single total `timeout`
    // would kill long-running polish streams at the 60s mark even when healthy.
    let client = Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .read_timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let messages = if let Some(ref img_url) = image_data_url {
        if !img_url.is_empty() {
            serde_json::json!([
                { "role": "system", "content": system_prompt },
                {
                    "role": "user",
                    "content": [
                        { "type": "text", "text": user_prompt },
                        { "type": "image_url", "image_url": { "url": img_url } }
                    ]
                }
            ])
        } else {
            serde_json::json!([
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": user_prompt }
            ])
        }
    } else {
        serde_json::json!([
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_prompt }
        ])
    };

    let payload = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": true,
        "temperature": temperature.unwrap_or(0.7),
    });

    let payload_kb = serde_json::to_vec(&payload)
        .map(|v| v.len() / 1024)
        .unwrap_or(0);
    crate::commands::file_log(
        &app,
        &format!(
            "llm request: model={} image={} payload_kb={} endpoint={}",
            model,
            image_data_url.is_some(),
            payload_kb,
            endpoint
        ),
    );

    let res = client
        .post(&endpoint)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await;

    let response = match res {
        Ok(r) => r,
        Err(e) => {
            crate::commands::file_log(&app, &format!("llm send error: {}", e));
            let _ = channel.send(StreamEvent::Error {
                message: format!("网络连接失败: {}", e),
            });
            return Ok(());
        }
    };

    let status = response.status();
    crate::commands::file_log(
        &app,
        &format!(
            "llm status: {} ({}ms)",
            status,
            start.elapsed().as_millis()
        ),
    );
    if !status.is_success() {
        let err_text = response.text().await.unwrap_or_default();
        crate::commands::file_log(
            &app,
            &format!("llm http error body: {}", &err_text[..err_text.len().min(500)]),
        );
        let human_err = match status.as_u16() {
            401 => "API Key 错误或未授权 (401)。请在设置中检查填写的 Key 是否正确。".to_string(),
            402 => "API 账户余额不足 (402)。请前往模型服务商后台充值。".to_string(),
            404 => format!("接口地址或模型名称不存在 (404): {}", err_text),
            429 => "请求过于频繁或超出并发限制 (429)。请稍后重试。".to_string(),
            _ => format!("API 请求失败 ({}): {}", status, err_text),
        };
        let _ = channel.send(StreamEvent::Error { message: human_err });
        return Ok(());
    }

    let mut stream = response.bytes_stream();
    // Buffer RAW bytes and only decode complete lines: an SSE chunk boundary can
    // split a multi-byte UTF-8 char (CJK is 3 bytes), and from_utf8_lossy per
    // chunk would corrupt it with U+FFFD. '\n' (0x0A) never occurs inside a
    // multi-byte UTF-8 sequence, so decoding per line is always safe.
    let mut buffer: Vec<u8> = Vec::new();
    let mut total_tokens = 0;

    while let Some(item) = stream.next().await {
        match item {
            Ok(bytes) => {
                buffer.extend_from_slice(&bytes);

                while let Some(pos) = buffer.iter().position(|&b| b == b'\n') {
                    let line = String::from_utf8_lossy(&buffer[..pos]).trim().to_string();
                    buffer.drain(..=pos);

                    if line.is_empty() || line.starts_with(':') {
                        continue;
                    }

                    if line == "data: [DONE]" {
                        let _ = channel.send(StreamEvent::Done {
                            duration_ms: start.elapsed().as_millis() as u64,
                            total_tokens,
                        });
                        return Ok(());
                    }

                    if let Some(stripped) = line.strip_prefix("data: ") {
                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(stripped) {
                            if let Some(delta) = val["choices"][0]["delta"]["content"].as_str() {
                                total_tokens += 1;
                                let _ = channel.send(StreamEvent::Chunk {
                                    delta: delta.to_string(),
                                });
                            }
                        }
                    }
                }
            }
            Err(e) => {
                let _ = channel.send(StreamEvent::Error {
                    message: format!("数据流读取中断: {}", e),
                });
                return Ok(());
            }
        }
    }

    let _ = channel.send(StreamEvent::Done {
        duration_ms: start.elapsed().as_millis() as u64,
        total_tokens,
    });

    Ok(())
}

#[tauri::command]
pub async fn test_llm_connection(req: TestConnectionRequest) -> Result<TestConnectionResponse, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(8))
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
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
pub fn app_ready(_window: WebviewWindow) -> Result<(), String> {
    // Frontend is initialized in background. Keep window silent until user selection or wake shortcut.
    Ok(())
}
