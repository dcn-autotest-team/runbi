//! LLM Network Transport and Connection Testing
//! Bypasses browser CORS and connects directly to OpenAI / DeepSeek compatible endpoints.

use futures_util::StreamExt;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
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
    Chunk {
        delta: String,
    },
    Done {
        duration_ms: u64,
        total_tokens: usize,
    },
    Error {
        message: String,
    },
}

/// Id of the stream the frontend most recently aborted.
///
/// `stream_llm_chat` carries a unique, strictly increasing `stream_id` (the
/// frontend mints one per invocation) and stops reading as soon as its own id
/// equals this value.
///
/// Why this exists: the frontend `abortController.abort()` only silences local
/// callbacks. Without a Rust-side stop the SSE read loop keeps draining a
/// full-length generation whose result nobody wants, which holds the model
/// busy and makes the NEXT (wanted) request queue behind it. Log analysis of
/// 20 388 requests showed 1 940 streams that never reached `llm done` for
/// exactly this reason.
///
/// Equality (not `<=` / max) is deliberate: a late watcher may report an OLD
/// aborted id after a newer stream has started, and max-semantics would then
/// kill that innocent newer stream.
static ABORTED_STREAM_ID: AtomicU64 = AtomicU64::new(0);

/// True when the stream identified by `stream_id` was aborted by the frontend.
#[inline]
fn is_stream_aborted(stream_id: u64) -> bool {
    stream_id != 0 && stream_id == ABORTED_STREAM_ID.load(Ordering::Relaxed)
}

/// Armas the keyboard-invalidation grace for one LLM stream and releases it
/// when that stream ends.
///
/// The daemon thread wakes every 200ms to re-arm the 500ms grace so the user's
/// own typing cannot cancel a panel that is still streaming. It MUST be stopped
/// exactly when the stream finishes: a thread that outlives its stream keeps the
/// grace armed forever, which both wastes a thread per request and disables
/// keyboard-selection invalidation globally (stale panels then never clear).
struct KeybordGraceKepper {
    stop: Arc<AtomicBool>,
}

impl KeybordGraceKepper {
    fn start() -> KeybordGraceKepper {
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = stop.clone();
        std::thread::spawn(move || loop {
            crate::commands::mouse_hook::note_internal_keyboard_activity(true);
            std::thread::sleep(std::time::Duration::from_millis(200));
            if thread_stop.load(Ordering::Relaxed) {
                break;
            }
        });
        KeybordGraceKepper { stop }
    }
}

impl Drop for KeybordGraceKepper {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
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
    use_last_screenshot: Option<bool>,
    stream_id: Option<u64>,
    channel: Channel<StreamEvent>,
) -> Result<(), String> {
    let stream_id = stream_id.unwrap_or(0);
    let start = Instant::now();
    // Arms the keyboard grace only for the duration of this stream; the guard
    // stops the daemon thread on every return path below.
    let _kb_grace = KeybordGraceKepper::start();
    // Resolve the vision image: explicit data URL wins, else pull the last
    // captured screenshot from Rust-side state (it never crosses IPC whole).
    let img_url = match image_data_url {
        Some(ref u) if !u.is_empty() => Some(u.clone()),
        _ if use_last_screenshot.unwrap_or(false) => crate::commands::screenshot::last_screenshot(),
        _ => None,
    };
    // Streaming-friendly timeouts: connect_timeout covers dial + TLS handshake,
    // read_timeout covers each body chunk individually. A single total `timeout`
    // would kill long-running polish streams at the 60s mark even when healthy.
    // Bypass system/env proxies: loopback LLM endpoints get buffered and
    // throttled when routed through a local proxy (e.g. Clash on 7890).
    let client = Client::builder().no_proxy()
        .connect_timeout(std::time::Duration::from_secs(15))
        .read_timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let messages = if let Some(ref img_url) = img_url {
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
            img_url.is_some(),
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
        &format!("llm status: {} ({}ms)", status, start.elapsed().as_millis()),
    );
    if !status.is_success() {
        let err_text = response.text().await.unwrap_or_default();
        crate::commands::file_log(
            &app,
            &format!(
                "llm http error body: {}",
                &err_text[..err_text.len().min(500)]
            ),
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
    let mut snippet = String::new();
    // Batch SSE deltas into ~50ms IPC sends: per-chunk Channel messages cost
    // a WebView round-trip each, which throttles fast streams heavily.
    let mut pending_delta = String::new();
    let mut last_flush = std::time::Instant::now();

    while let Some(item) = stream.next().await {
        // Checkpoint 1: the user aborted while we were awaiting the next body
        // chunk. Stop reading at once and drop the socket instead of draining
        // a generation nobody will render.
        if is_stream_aborted(stream_id) {
            crate::commands::file_log(
                &app,
                &format!(
                    "llm aborted by frontend after {}ms",
                    start.elapsed().as_millis()
                ),
            );
            return Ok(());
        }
        match item {
            Ok(bytes) => {
                buffer.extend_from_slice(&bytes);

                while let Some(pos) = buffer.iter().position(|&b| b == b'\n') {
                    // Checkpoint 2: one body chunk can hold dozens of SSE lines,
                    // so also re-check per line (cheap atomic load).
                    if is_stream_aborted(stream_id) {
                        crate::commands::file_log(
                            &app,
                            &format!(
                                "llm aborted by frontend after {}ms",
                                start.elapsed().as_millis()
                            ),
                        );
                        return Ok(());
                    }
                    let line = String::from_utf8_lossy(&buffer[..pos]).trim().to_string();
                    buffer.drain(..=pos);

                    if line.is_empty() || line.starts_with(':') {
                        continue;
                    }

                    if line == "data: [DONE]" {
                        let head: String = snippet.chars().take(160).collect();
                        crate::commands::file_log(
                            &app,
                            &format!(
                                "llm done: {} chars, head: {}",
                                snippet.chars().count(),
                                head
                            ),
                        );
                        if !pending_delta.is_empty() {
                            let _ = channel.send(StreamEvent::Chunk {
                                delta: std::mem::take(&mut pending_delta),
                            });
                        }
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
                                if snippet.chars().count() < 300 {
                                    snippet.push_str(delta);
                                }
                                pending_delta.push_str(delta);
                                if last_flush.elapsed() >= std::time::Duration::from_millis(50) {
                                    let _ = channel.send(StreamEvent::Chunk {
                                        delta: std::mem::take(&mut pending_delta),
                                    });
                                    last_flush = std::time::Instant::now();
                                }
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

    let head: String = snippet.chars().take(160).collect();
    crate::commands::file_log(
        &app,
        &format!(
            "llm done (stream end): {} chars, head: {}",
            snippet.chars().count(),
            head
        ),
    );
    let _ = channel.send(StreamEvent::Done {
        duration_ms: start.elapsed().as_millis() as u64,
        total_tokens,
    });

    Ok(())
}

#[tauri::command]
#[allow(dead_code)]
pub fn abort_llm_stream(stream_id: u64) -> Result<(), String> {
    // Records the aborted id. A stream stops only when its own id matches,
    // so a late report for an already-finished stream cannot hurt a newer one.
    ABORTED_STREAM_ID.store(stream_id, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub async fn test_llm_connection(
    req: TestConnectionRequest,
) -> Result<TestConnectionResponse, String> {
    let client = reqwest::Client::builder().no_proxy()
        .connect_timeout(std::time::Duration::from_secs(8))
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let start = Instant::now();
    // A one-token connectivity probe has no panel to protect, so it arms no
    // keyboard grace: a daemon thread here would outlive the probe and slow
    // down every later real stream. It also needs `.no_proxy()` like the real
    // stream: a loopback endpoint behind a local proxy reports false negatives.

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
pub async fn hide_capsule_window(window: WebviewWindow, generation: u64) -> Result<(), String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            let _ = tx.send(crate::commands::mouse_hook::dismiss_native_capsule(
                &target, generation,
            ));
        })
        .map_err(|e| e.to_string())?;
    // Geometry is set by every position call; resizing a hidden window here can
    // race a new selection. Only hide the capsule this request belongs to.
    rx.await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn app_ready(_window: WebviewWindow) -> Result<(), String> {
    // Frontend is initialized in background. Keep window silent until user selection or wake shortcut.
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aborted_stream_id_stops_only_that_stream() {
        // 回归:旧代码里 kb_stop 建了却从不读取,每个请求泄一个永久线程;
        // 且前端 abort 完全不到 Rust,SSE 继续拉完整段生成,占着模型不放。
        // 日志里 20388 个请求中 1940 个永远没到 llm done,就是这样来的。
        ABORTED_STREAM_ID.store(0, Ordering::SeqCst);

        // 未 abort 时任何流都能跑。
        assert!(!is_stream_aborted(7));

        // abort 7 号流后,只有 7 号停。
        ABORTED_STREAM_ID.store(7, Ordering::SeqCst);
        assert!(is_stream_aborted(7));
        assert!(!is_stream_aborted(8));
        assert!(!is_stream_aborted(6));

        // 迟到的老 id 上报不能误杀新流。
        ABORTED_STREAM_ID.store(3, Ordering::SeqCst);
        assert!(!is_stream_aborted(8));
        assert!(is_stream_aborted(3));
    }

    #[test]
    fn stream_id_zero_never_matches() {
        // stream_id 缺失时(旧前端不发)必须保持旧行为:不因残留 id 误停。
        ABORTED_STREAM_ID.store(9, Ordering::SeqCst);
        assert!(!is_stream_aborted(0));
    }
}

/// Fetch through native HTTP so local endpoints work without browser CORS/CSP restrictions.
#[allow(dead_code)]
#[tauri::command]
pub async fn fetch_model_list(url: String, api_key: String) -> Result<String, String> {
    let url = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("仅支持 HTTP/HTTPS 端点".into());
    }
    let client = Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(8))
        .build().map_err(|e| e.to_string())?;
    let mut request = client.get(url);
    if !api_key.trim().is_empty() {
        request = request.bearer_auth(api_key.trim());
    }
    request.send().await.map_err(|e| e.to_string())?
        .error_for_status().map_err(|e| e.to_string())?
        .text().await.map_err(|e| e.to_string())
}
