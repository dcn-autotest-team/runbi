//! Native Rust Autonomous Agent Engine (EVA-inspired)
//!
//! Provides autonomous tool-use agent capabilities:
//! - Environment probing (OS, dev tools, project directory tree)
//! - Multi-turn tool execution loop with streaming thinking & reasoning support
//! - Safe CLI execution (read-only auto-approval vs human-in-the-loop gate)
//! - Memory hint persistence and context compaction (leave_memory_hints)
//! - Polynomial rolling hash repetition checker (prevents thinking loops)

use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::ipc::Channel;

// ---------------------------------------------------------------------------
// Events emitted to Frontend via Tauri Channel
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum AgentEvent {
    ThinkingChunk { delta: String },
    ContentChunk { delta: String },
    ToolProposed {
        call_id: String,
        name: String,
        command: String,
        requires_approval: bool,
    },
    ToolExecuted {
        call_id: String,
        name: String,
        output: String,
        exit_code: Option<i32>,
    },
    MemoryCompacted { hints: String },
    Status { message: String },
    Done { success: bool, total_tokens: usize },
    Error { message: String },
}

// Global state for pending tool approvals: call_id -> oneshot sender
type ApprovalSender = tokio::sync::oneshot::Sender<bool>;
static PENDING_APPROVALS: Mutex<Option<HashMap<String, ApprovalSender>>> = Mutex::new(None);
static ACTIVE_AGENT_ABORT: AtomicBool = AtomicBool::new(false);

fn ensure_approval_map() {
    let mut lock = PENDING_APPROVALS.lock().unwrap();
    if lock.is_none() {
        *lock = Some(HashMap::new());
    }
}

// ---------------------------------------------------------------------------
// 1. Repeat Suffix Checker (Polynomial Rolling Hash)
// ---------------------------------------------------------------------------

pub struct RepeatSuffixChecker {
    min_unit_len: usize,
    base: i64,
    modulo: i64,
    prefix_hash: Vec<i64>,
    pow_base: Vec<i64>,
}

impl RepeatSuffixChecker {
    pub fn new(min_unit_len: usize) -> Self {
        Self {
            min_unit_len,
            base: 91_138_233,
            modulo: 1_000_000_007,
            prefix_hash: vec![0],
            pow_base: vec![1],
        }
    }

    fn get_hash(&self, l: usize, r: usize) -> i64 {
        let h = (self.prefix_hash[r]
            - (self.prefix_hash[l] * self.pow_base[r - l]) % self.modulo)
            % self.modulo;
        if h < 0 {
            h + self.modulo
        } else {
            h
        }
    }

    pub fn add_char(&mut self, ch: char) -> bool {
        let last_pow = *self.pow_base.last().unwrap();
        self.pow_base.push((last_pow * self.base) % self.modulo);

        let last_hash = *self.prefix_hash.last().unwrap();
        let new_hash = (last_hash * self.base + (ch as i64)) % self.modulo;
        self.prefix_hash.push(new_hash);

        let n = self.prefix_hash.len() - 1;
        if n < 2 * self.min_unit_len || n % self.min_unit_len != 0 {
            return false;
        }

        for unit_len in (self.min_unit_len..=(n / 2)).rev() {
            if self.get_hash(n - 2 * unit_len, n - unit_len) == self.get_hash(n - unit_len, n) {
                return true;
            }
        }
        false
    }
}

// ---------------------------------------------------------------------------
// 2. Environment Probe
// ---------------------------------------------------------------------------

pub fn collect_env_info(project_dir: &Path) -> String {
    let today = chrono_like_today();
    let os_name = if cfg!(windows) {
        "Windows"
    } else if cfg!(target_os = "macos") {
        "macOS"
    } else {
        "Linux"
    };

    // Tools check
    let common_tools = ["git", "node", "npm", "python", "docker", "curl"];
    let mut tool_lines = Vec::new();
    for tool in &common_tools {
        let status = match check_tool_version(tool) {
            Some(v) => format!("{}: {}", tool, v),
            None => format!("{}: 未安装", tool),
        };
        tool_lines.push(status);
    }

    // Directory list with limit
    let mut dir_entries = Vec::new();
    let mut total_count: usize = 0;
    if let Ok(entries) = std::fs::read_dir(project_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') && name != ".runbi" {
                continue;
            }
            total_count += 1;
            if dir_entries.len() < 12 {
                let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
                let tag = if is_dir { "[目录]" } else { "[文件]" };
                dir_entries.push(format!("{} {}", tag, name));
            }
        }
    }
    let hidden = total_count.saturating_sub(dir_entries.len());
    let mut dir_summary = dir_entries.join("\n");
    if hidden > 0 {
        dir_summary.push_str(&format!("\n...还有 {} 个目录或文件未显示", hidden));
    }

    format!(
        "=== 今天日期 ===\n{}\n\n=== 系统 ===\n{}\n\n=== 已安装工具 ===\n{}\n\n=== 当前项目空间 {} 下的目录及文件 ===\n{}",
        today,
        os_name,
        tool_lines.join("\n"),
        project_dir.display(),
        if dir_summary.is_empty() { "(空目录)" } else { &dir_summary }
    )
}

fn chrono_like_today() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // Rough days since 1970-01-01
    let days = (secs / 86400) as i64;
    // Approximating date from day count
    let mut y = 1970;
    let mut d = days;
    loop {
        let leap = (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0);
        let days_in_year = if leap { 366 } else { 365 };
        if d >= days_in_year {
            d -= days_in_year;
            y += 1;
        } else {
            break;
        }
    }
    let leap = (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0);
    let month_days = [
        31,
        if leap { 29 } else { 28 },
        31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ];
    let mut m = 0;
    for (i, &md) in month_days.iter().enumerate() {
        if d >= md {
            d -= md;
        } else {
            m = i + 1;
            break;
        }
    }
    format!("{:04}-{:02}-{:02}", y, m, d + 1)
}

fn check_tool_version(tool: &str) -> Option<String> {
    let output = std::process::Command::new(tool)
        .arg("--version")
        .output()
        .ok()?;
    if output.status.success() {
        let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !s.is_empty() {
            let first_line = s.lines().next().unwrap_or(&s).to_string();
            return Some(first_line);
        }
    }
    None
}

// ---------------------------------------------------------------------------
// 3. Safety Check: Read-Only Heuristic
// ---------------------------------------------------------------------------

pub fn is_readonly_command(cmd: &str) -> bool {
    let lower = cmd.trim().to_lowercase();
    // Typical read-only commands
    let safe_prefixes = [
        "git status", "git log", "git diff", "git show", "git branch",
        "ls", "dir", "cat", "type", "pwd", "cd", "echo", "head", "tail",
        "grep", "rg", "find", "where", "which", "get-childitem", "get-content",
        "test-path", "whoami", "uname", "hostname", "date",
    ];

    // Modifying keywords that immediately disqualify
    let dangerous_tokens = [
        "rm ", "del ", "rmdir", "remove-item", "erase", "mkfs", "dd ",
        ">", ">>", "git push", "git commit", "git reset", "git clean",
        "npm install", "npm i ", "yarn add", "pnpm add", "cargo build",
        "kill", "stop-process", "shutdown", "reboot", "format",
    ];

    for danger in &dangerous_tokens {
        if lower.contains(danger) {
            return false;
        }
    }

    for safe in &safe_prefixes {
        if lower.starts_with(safe) {
            return true;
        }
    }

    false
}

// ---------------------------------------------------------------------------
// 4. CLI Execution with Timeout & Truncation
// ---------------------------------------------------------------------------

const MAX_OUTPUT_CHARS: usize = 6000;

pub async fn run_cli_command(command: &str, cwd: &Path, timeout_secs: u64) -> (String, Option<i32>) {
    let (shell, flag) = if cfg!(windows) {
        ("powershell", "-Command")
    } else {
        ("sh", "-c")
    };

    let mut cmd = tokio::process::Command::new(shell);
    cmd.arg(flag)
        .arg(command)
        .current_dir(cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return (format!("启动命令失败: {}", e), None),
    };

    let timeout_dur = Duration::from_secs(timeout_secs.clamp(5, 600));
    let output_res = tokio::time::timeout(timeout_dur, child.wait_with_output()).await;

    match output_res {
        Ok(Ok(output)) => {
            let code = output.status.code();
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);

            let mut combined = format!("Exit code: {}\n{}", code.unwrap_or(-1), stdout.trim());
            if !stderr.trim().is_empty() {
                combined.push_str(&format!("\nSTDERR:\n{}", stderr.trim()));
            }

            let trimmed = combined.trim().to_string();
            let result = if trimmed.len() > MAX_OUTPUT_CHARS {
                let half = MAX_OUTPUT_CHARS / 2;
                format!(
                    "{}\n...（工具返回过长，中间部分已省略）...\n{}",
                    &trimmed[..half],
                    &trimmed[trimmed.len() - half..]
                )
            } else if trimmed.is_empty() {
                "(no output)".to_string()
            } else {
                trimmed
            };

            (result, code)
        }
        Ok(Err(e)) => (format!("执行异常: {}", e), None),
        Err(_) => ("执行超时已自动打断".to_string(), None),
    }
}

// ---------------------------------------------------------------------------
// 5. Memory Hints & Prompts
// ---------------------------------------------------------------------------

pub fn read_memory_hints(project_dir: &Path) -> String {
    let hint_file = project_dir.join(".runbi").join("hints.md");
    std::fs::read_to_string(hint_file).unwrap_or_default()
}

pub fn save_memory_hints(project_dir: &Path, hints: &str) -> std::io::Result<()> {
    let runbi_dir = project_dir.join(".runbi");
    std::fs::create_dir_all(&runbi_dir)?;
    std::fs::write(runbi_dir.join("hints.md"), hints)
}

pub fn build_system_prompt(project_dir: &Path) -> String {
    let env_info = collect_env_info(project_dir);
    let hints = read_memory_hints(project_dir);
    let knowledge = std::fs::read_to_string(project_dir.join(".runbi").join("knowledge.md"))
        .unwrap_or_else(|_| "无".to_string());

    let os_name = if cfg!(windows) { "Windows" } else { "Unix" };
    let shell_name = if cfg!(windows) { "PowerShell" } else { "Shell" };

    format!(
        r#"# 你是谁
你是 Runbi Agent，一个运行在桌面环境中的自主智能体。

# 你在哪
一、你正处在一个 **{}** 环境中，可以通过 run_cli 工具来执行任意 {} 命令，包括读写文件、执行脚本、查看系统状态等。
二、当前工作空间是：{}
三、当前环境信息如下：
{}

# 固化的知识及规则
<knowledge_and_rules>
{}
</knowledge_and_rules>

# 记忆线索
<memory_hints>
{}
</memory_hints>

# 你要做什么
一、帮助用户完成指定的目标任务。结果要保证可靠与可验证，必要时主动调用命令进行验证。
二、必须以工具调用的形式执行操作。纯只读命令会自动放行，涉及修改/执行的操作会提请用户审核。
三、任务完成后，向用户汇报明确的最终结果与产出。
"#,
        os_name,
        shell_name,
        project_dir.display(),
        env_info,
        knowledge,
        if hints.is_empty() { "无" } else { &hints }
    )
}

// ---------------------------------------------------------------------------
// 6. Tauri Commands
// ---------------------------------------------------------------------------

#[tauri::command]
#[allow(dead_code)]
pub fn approve_agent_tool(call_id: String, approved: bool) -> Result<(), String> {
    ensure_approval_map();
    let mut lock = PENDING_APPROVALS.lock().unwrap();
    if let Some(map) = lock.as_mut() {
        if let Some(sender) = map.remove(&call_id) {
            let _ = sender.send(approved);
            return Ok(());
        }
    }
    Err("未找到对应的待审批调用或已超时".to_string())
}

#[tauri::command]
#[allow(dead_code)]
pub fn abort_agent_task() {
    ACTIVE_AGENT_ABORT.store(true, Ordering::SeqCst);
}

#[tauri::command]
#[allow(dead_code)]
pub fn get_agent_env_info(project_dir: Option<String>) -> String {
    let dir = project_dir
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    collect_env_info(&dir)
}

#[derive(Debug, Deserialize)]
pub struct StartAgentTaskParams {
    pub endpoint: String,
    #[serde(alias = "apiKey", alias = "api_key")]
    pub api_key: String,
    pub model: String,
    pub prompt: String,
    #[serde(alias = "projectDir", alias = "project_dir")]
    pub project_dir: Option<String>,
    #[serde(alias = "allowAll", alias = "allow_all")]
    pub allow_all: Option<bool>,
    #[serde(alias = "maxTurns", alias = "max_turns")]
    pub max_turns: Option<usize>,
}

#[tauri::command]
#[allow(dead_code)]
pub async fn start_agent_task(
    _app: tauri::AppHandle,
    params: StartAgentTaskParams,
    channel: Channel<AgentEvent>,
) -> Result<(), String> {
    ensure_approval_map();
    ACTIVE_AGENT_ABORT.store(false, Ordering::SeqCst);

    let project_dir = params
        .project_dir
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    let allow_all = params.allow_all.unwrap_or(false);
    let max_turns = params.max_turns.unwrap_or(15);
    let client = Client::builder()
        .no_proxy()
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let system_prompt = build_system_prompt(&project_dir);
    let mut messages: Vec<Value> = vec![
        json!({ "role": "system", "content": system_prompt }),
        json!({ "role": "user", "content": params.prompt }),
    ];

    let tools = json!([
        {
            "type": "function",
            "function": {
                "name": "run_cli",
                "description": "在工作空间执行命令行命令，读取或修改项目内容、运行脚本或检查状态。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": { "type": "string", "description": "要执行的命令" },
                        "timeout": { "type": "integer", "description": "超时时间（秒，默认 60）" }
                    },
                    "required": ["command"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "leave_memory_hints",
                "description": "留下关键记忆线索保存到 .runbi/hints.md，供未来会话与上下文传承使用。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "hints": { "type": "string", "description": "提炼保存的记忆线索与技能总结" }
                    },
                    "required": ["hints"]
                }
            }
        }
    ]);

    let mut total_tokens = 0;

    for turn in 0..max_turns {
        if ACTIVE_AGENT_ABORT.load(Ordering::SeqCst) {
            let _ = channel.send(AgentEvent::Status {
                message: "任务已由用户手动中止".to_string(),
            });
            let _ = channel.send(AgentEvent::Done {
                success: false,
                total_tokens,
            });
            return Ok(());
        }

        let _ = channel.send(AgentEvent::Status {
            message: format!("正在规划思考（第 {}/{} 轮）…", turn + 1, max_turns),
        });

        let payload = json!({
            "model": params.model,
            "messages": messages,
            "tools": tools,
            "stream": true,
            "temperature": 0.6,
            "thinking": { "type": "enabled" },
            "chat_template_kwargs": { "enable_thinking": true }
        });

        let res = client
            .post(&params.endpoint)
            .header("Authorization", format!("Bearer {}", params.api_key))
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await;

        let response = match res {
            Ok(r) if r.status().is_success() => r,
            Ok(r) => {
                let status = r.status();
                let err_text = r.text().await.unwrap_or_default();
                let _ = channel.send(AgentEvent::Error {
                    message: format!("LLM 请求失败 (HTTP {}): {}", status, err_text),
                });
                return Ok(());
            }
            Err(e) => {
                let _ = channel.send(AgentEvent::Error {
                    message: format!("网络连接异常: {}", e),
                });
                return Ok(());
            }
        };

        let mut stream = response.bytes_stream();
        let mut buffer: Vec<u8> = Vec::new();
        let mut full_content = String::new();
        let mut full_reasoning = String::new();
        let mut tool_calls_map: HashMap<usize, (String, String, String)> = HashMap::new();
        let mut repeat_checker = RepeatSuffixChecker::new(80);

        while let Some(item) = stream.next().await {
            if ACTIVE_AGENT_ABORT.load(Ordering::SeqCst) {
                break;
            }
            let bytes = match item {
                Ok(b) => b,
                Err(e) => {
                    let _ = channel.send(AgentEvent::Error {
                        message: format!("读取响应流失败: {}", e),
                    });
                    break;
                }
            };

            buffer.extend_from_slice(&bytes);

            while let Some(pos) = buffer.iter().position(|&b| b == b'\n') {
                let line_bytes: Vec<u8> = buffer.drain(..=pos).collect();
                let line = String::from_utf8_lossy(&line_bytes).trim().to_string();
                if !line.starts_with("data: ") {
                    continue;
                }
                let payload_str = &line[6..];
                if payload_str == "[DONE]" {
                    break;
                }

                if let Ok(chunk) = serde_json::from_str::<Value>(payload_str) {
                    if let Some(choices) = chunk.get("choices").and_then(|c| c.as_array()) {
                        if let Some(first) = choices.first() {
                            let delta = first.get("delta").unwrap_or(&Value::Null);

                            // Reasoning / Thinking stream
                            let reasoning = delta
                                .get("reasoning_content")
                                .or_else(|| delta.get("reasoning"))
                                .and_then(|r| r.as_str())
                                .unwrap_or("");
                            if !reasoning.is_empty() {
                                full_reasoning.push_str(reasoning);
                                for ch in reasoning.chars() {
                                    if repeat_checker.add_char(ch) {
                                        let _ = channel.send(AgentEvent::Status {
                                            message: "检测到思考内容陷入重复循环，已自动抑制"
                                                .to_string(),
                                        });
                                        break;
                                    }
                                }
                                let _ = channel.send(AgentEvent::ThinkingChunk {
                                    delta: reasoning.to_string(),
                                });
                            }

                            // Content stream
                            let content = delta.get("content").and_then(|c| c.as_str()).unwrap_or("");
                            if !content.is_empty() {
                                full_content.push_str(content);
                                let _ = channel.send(AgentEvent::ContentChunk {
                                    delta: content.to_string(),
                                });
                            }

                            // Tool calls delta accumulation
                            if let Some(tool_calls) =
                                delta.get("tool_calls").and_then(|tc| tc.as_array())
                            {
                                for tc in tool_calls {
                                    let idx = tc.get("index").and_then(|i| i.as_u64()).unwrap_or(0)
                                        as usize;
                                    let entry = tool_calls_map
                                        .entry(idx)
                                        .or_insert_with(|| (String::new(), String::new(), String::new()));
                                    if let Some(id) = tc.get("id").and_then(|s| s.as_str()) {
                                        entry.0.push_str(id);
                                    }
                                    if let Some(f) = tc.get("function") {
                                        if let Some(name) = f.get("name").and_then(|s| s.as_str()) {
                                            entry.1.push_str(name);
                                        }
                                        if let Some(args) = f.get("arguments").and_then(|s| s.as_str()) {
                                            entry.2.push_str(args);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        total_tokens += full_content.len() / 4 + full_reasoning.len() / 4;

        // If no tool calls, task reached textual completion
        if tool_calls_map.is_empty() {
            let _ = channel.send(AgentEvent::Done {
                success: true,
                total_tokens,
            });
            return Ok(());
        }

        // Construct assistant message with tool calls
        let mut assistant_tool_calls = Vec::new();
        let mut sorted_indices: Vec<usize> = tool_calls_map.keys().copied().collect();
        sorted_indices.sort_unstable();

        for &idx in &sorted_indices {
            let (id, name, args) = &tool_calls_map[&idx];
            assistant_tool_calls.push(json!({
                "id": if id.is_empty() { format!("call_{}", idx) } else { id.clone() },
                "type": "function",
                "function": {
                    "name": name,
                    "arguments": args
                }
            }));
        }

        messages.push(json!({
            "role": "assistant",
            "content": full_content,
            "tool_calls": assistant_tool_calls
        }));

        // Execute each tool call
        for &idx in &sorted_indices {
            let (id, name, args_str) = &tool_calls_map[&idx];
            let call_id = if id.is_empty() { format!("call_{}", idx) } else { id.clone() };

            if name == "run_cli" {
                let args_json: Value = serde_json::from_str(args_str).unwrap_or_default();
                let command = args_json
                    .get("command")
                    .and_then(|c| c.as_str())
                    .unwrap_or("")
                    .to_string();
                let timeout = args_json.get("timeout").and_then(|t| t.as_u64()).unwrap_or(60);

                let is_readonly = is_readonly_command(&command);
                let requires_approval = !allow_all && !is_readonly;

                let _ = channel.send(AgentEvent::ToolProposed {
                    call_id: call_id.clone(),
                    name: name.clone(),
                    command: command.clone(),
                    requires_approval,
                });

                if requires_approval {
                    let (tx, rx) = tokio::sync::oneshot::channel();
                    {
                        let mut lock = PENDING_APPROVALS.lock().unwrap();
                        if let Some(map) = lock.as_mut() {
                            map.insert(call_id.clone(), tx);
                        }
                    }

                    // Await approval with a 5-minute timeout
                    let approved = match tokio::time::timeout(Duration::from_secs(300), rx).await {
                        Ok(Ok(true)) => true,
                        _ => false,
                    };

                    if !approved {
                        let msg = "用户拒绝了执行此命令".to_string();
                        let _ = channel.send(AgentEvent::ToolExecuted {
                            call_id: call_id.clone(),
                            name: name.clone(),
                            output: msg.clone(),
                            exit_code: Some(1),
                        });
                        messages.push(json!({
                            "role": "tool",
                            "tool_call_id": call_id,
                            "name": name,
                            "content": msg
                        }));
                        continue;
                    }
                }

                // Execute the command
                let (output, exit_code) = run_cli_command(&command, &project_dir, timeout).await;
                let _ = channel.send(AgentEvent::ToolExecuted {
                    call_id: call_id.clone(),
                    name: name.clone(),
                    output: output.clone(),
                    exit_code,
                });

                messages.push(json!({
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": output
                }));
            } else if name == "leave_memory_hints" {
                let args_json: Value = serde_json::from_str(args_str).unwrap_or_default();
                let hints = args_json
                    .get("hints")
                    .and_then(|h| h.as_str())
                    .unwrap_or("")
                    .to_string();

                let _ = save_memory_hints(&project_dir, &hints);
                let _ = channel.send(AgentEvent::MemoryCompacted {
                    hints: hints.clone(),
                });

                let res_msg = "已将记忆线索持久化保存至 .runbi/hints.md".to_string();
                let _ = channel.send(AgentEvent::ToolExecuted {
                    call_id: call_id.clone(),
                    name: name.clone(),
                    output: res_msg.clone(),
                    exit_code: Some(0),
                });

                messages.push(json!({
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": res_msg
                }));
            }
        }
    }

    let _ = channel.send(AgentEvent::Done {
        success: true,
        total_tokens,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_repeat_suffix_checker_detects_loop() {
        let mut checker = RepeatSuffixChecker::new(5);
        let phrase = "abcdef";
        // Repeating "abcdef" many times
        let mut detected = false;
        for _ in 0..10 {
            for c in phrase.chars() {
                if checker.add_char(c) {
                    detected = true;
                    break;
                }
            }
            if detected {
                break;
            }
        }
        assert!(detected, "RepeatSuffixChecker should detect repeated pattern");
    }

    #[test]
    fn test_repeat_suffix_checker_allows_natural_text() {
        let mut checker = RepeatSuffixChecker::new(5);
        let text = "The quick brown fox jumps over the lazy dog and runs across the wide open green meadow.";
        let mut detected = false;
        for c in text.chars() {
            if checker.add_char(c) {
                detected = true;
                break;
            }
        }
        assert!(!detected, "RepeatSuffixChecker should not flag diverse prose");
    }

    #[test]
    fn test_is_readonly_command_classification() {
        assert!(is_readonly_command("git status"));
        assert!(is_readonly_command("git log -n 5"));
        assert!(is_readonly_command("dir"));
        assert!(is_readonly_command("Get-ChildItem -Path ."));
        assert!(is_readonly_command("cat package.json"));

        assert!(!is_readonly_command("rm -rf src"));
        assert!(!is_readonly_command("del file.txt"));
        assert!(!is_readonly_command("git commit -m 'test'"));
        assert!(!is_readonly_command("echo hello > out.txt"));
        assert!(!is_readonly_command("npm install"));
    }

    #[tokio::test]
    async fn test_run_cli_command_echo() {
        let temp_dir = std::env::temp_dir();
        let (output, code) = run_cli_command("echo 'runbi_agent_test'", &temp_dir, 5).await;
        assert_eq!(code, Some(0));
        assert!(output.contains("runbi_agent_test"));
    }

    #[test]
    fn test_collect_env_info_contains_essential_sections() {
        let temp_dir = std::env::temp_dir();
        let info = collect_env_info(&temp_dir);
        assert!(info.contains("=== 今天日期 ==="));
        assert!(info.contains("=== 系统 ==="));
        assert!(info.contains("=== 已安装工具 ==="));
    }
}
