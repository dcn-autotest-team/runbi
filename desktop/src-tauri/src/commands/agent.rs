//! Native Rust Autonomous Agent Engine (EVA-inspired)
//!
//! Provides autonomous tool-use agent capabilities:
//! - Environment probing (OS, dev tools, project directory tree)
//! - Multi-turn tool execution loop with streaming thinking & reasoning support
//! - Safe CLI execution (read-only auto-approval vs human-in-the-loop gate)
//! - Memory hint persistence and context compaction (leave_memory_hints)
//! - Polynomial rolling hash repetition checker (suppresses thinking loops)
//! - Re-plans a turn that ended with only thinking and no reply, instead of declaring success

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
    ContentReset { reason: Option<String> },
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
    PersonaUpdated { reflection: String },
    Status { message: String },
    Done { success: bool, total_tokens: usize },
    Error { message: String },
}

// Global state for pending tool approvals: call_id -> oneshot sender
type ApprovalSender = tokio::sync::oneshot::Sender<bool>;
static PENDING_APPROVALS: Mutex<Option<HashMap<String, ApprovalSender>>> = Mutex::new(None);
static ACTIVE_AGENT_ABORT: AtomicBool = AtomicBool::new(false);
static AGENT_RUNNING: AtomicBool = AtomicBool::new(false);

struct AgentRunGuard;
impl Drop for AgentRunGuard {
    fn drop(&mut self) {
        if let Ok(mut pending) = PENDING_APPROVALS.lock() {
            if let Some(map) = pending.as_mut() { map.clear(); }
        }
        AGENT_RUNNING.store(false, Ordering::SeqCst);
    }
}

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
    max_unit_len: usize,
    base: i64,
    modulo: i64,
    prefix_hash: Vec<i64>,
    pow_base: Vec<i64>,
    current_line: String,
    last_line: String,
    consecutive_same_lines: usize,
}

impl RepeatSuffixChecker {
    pub fn new(min_unit_len: usize) -> Self {
        Self {
            min_unit_len: min_unit_len.max(4),
            max_unit_len: 200,
            base: 91_138_233,
            modulo: 1_000_000_007,
            prefix_hash: vec![0],
            pow_base: vec![1],
            current_line: String::new(),
            last_line: String::new(),
            consecutive_same_lines: 0,
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
        // Line-level repetition check: catches repeated lines like "任务状态: 任务已完成\n"
        if ch == '\n' || ch == '\r' {
            let line = self.current_line.trim().to_string();
            self.current_line.clear();
            if line.chars().count() >= 4 {
                if line == self.last_line {
                    self.consecutive_same_lines += 1;
                    if self.consecutive_same_lines >= 3 {
                        return true;
                    }
                } else {
                    self.last_line = line;
                    self.consecutive_same_lines = 1;
                }
            }
        } else {
            self.current_line.push(ch);
        }

        let last_pow = *self.pow_base.last().unwrap();
        self.pow_base.push((last_pow * self.base) % self.modulo);

        let last_hash = *self.prefix_hash.last().unwrap();
        let new_hash = (last_hash * self.base + (ch as i64)) % self.modulo;
        self.prefix_hash.push(new_hash);

        let n = self.prefix_hash.len() - 1;
        let max_l = (n / 2).min(self.max_unit_len);
        let min_l = self.min_unit_len;

        if n >= 2 * min_l {
            for unit_len in (min_l..=max_l).rev() {
                if self.get_hash(n - 2 * unit_len, n - unit_len) == self.get_hash(n - unit_len, n) {
                    if unit_len < 16 {
                        if n >= 3 * unit_len
                            && self.get_hash(n - 3 * unit_len, n - 2 * unit_len)
                                == self.get_hash(n - 2 * unit_len, n - unit_len)
                        {
                            return true;
                        }
                    } else {
                        return true;
                    }
                }
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
    let mut command = std::process::Command::new(tool);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.arg("--version")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null()).spawn().ok()?;
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {}
            Err(_) => {
                // try_wait failed: the handle is unusable. Kill best-effort
                // so the spawned process never leaks unwaited.
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
        if std::time::Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    let output = child.wait_with_output().ok()?;
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
    // Dangerous shell metacharacters: chaining (;), background (&), substitution ($ `), subshells (( ) { }), redirects (> <), newlines
    if lower.contains([';', '&', '$', '`', '\n', '\r', '(', ')', '{', '}', '>', '<']) || lower.contains("||") {
        return false;
    }

    // Modifying keywords that immediately disqualify
    let dangerous_tokens = [
        "rm ", "del ", "rmdir", "remove-item", "erase", "mkfs", "dd ",
        "git push", "git commit", "git reset", "git clean", "git checkout",
        "git restore", "git rebase", "git merge",
        "npm install", "npm i ", "yarn add", "pnpm add", "cargo build", "cargo run",
        "kill", "stop-process", "shutdown", "reboot", "format",
        "set-content", "add-content", "out-file", "new-item", "copy-item",
        "move-item", "rename-item", "start-process", "invoke-expression", "iex ",
    ];

    for danger in &dangerous_tokens {
        if lower.contains(danger) {
            return false;
        }
    }

    let safe_prefixes = [
        "git status", "git log", "git diff", "git show",
        "ls", "dir", "cat", "type", "pwd", "cd", "echo", "head", "tail",
        "grep", "rg", "where", "which", "get-childitem", "get-content",
        "test-path", "whoami", "uname", "hostname",
        "findstr", "wc", "sort", "more",
        "select-object", "select-string", "measure-object", "out-string",
        "format-table", "format-list", "ft", "fl",
    ];

    let is_segment_safe = |seg: &str| -> bool {
        let s = seg.trim();
        if s.is_empty() { return false; }
        for safe in &safe_prefixes {
            if (s == *safe || s.strip_prefix(safe).is_some_and(|rest| rest.starts_with(' ')))
                && !s.contains("--output") && !s.contains("--exec")
                && !s.contains("--ext-diff") && !s.contains("--textconv")
                && !s.contains("--pre") && !s.contains("-outfile") {
                return true;
            }
        }
        false
    };

    if lower.contains('|') {
        let segments: Vec<&str> = lower.split('|').collect();
        return !segments.is_empty() && segments.iter().all(|seg| is_segment_safe(seg));
    }

    is_segment_safe(&lower)
}

pub fn execute_read_file(
    project_dir: &Path,
    path_str: &str,
    start_line: Option<usize>,
    end_line: Option<usize>,
) -> (String, Option<i32>) {
    let raw_path = PathBuf::from(path_str);
    let full_path = if raw_path.is_absolute() {
        raw_path
    } else {
        project_dir.join(raw_path)
    };

    if !full_path.exists() {
        return (format!("错误: 文件不存在: {}", path_str), Some(1));
    }
    if full_path.is_dir() {
        return (format!("错误: 指定路径是目录，不是文件: {}", path_str), Some(1));
    }

    match std::fs::read(&full_path) {
        Ok(bytes) => {
            let text = String::from_utf8_lossy(&bytes);
            let lines: Vec<&str> = text.lines().collect();
            let total_lines = lines.len();

            if total_lines == 0 {
                return ("(空文件)".to_string(), Some(0));
            }

            let s_line = start_line.unwrap_or(1).max(1);
            let e_line = end_line.unwrap_or(total_lines).min(total_lines);

            if s_line > total_lines {
                return (
                    format!("文件共有 {} 行，请求的起始行 {} 超出范围", total_lines, s_line),
                    Some(0),
                );
            }

            let start_idx = s_line - 1;
            let end_idx = e_line.max(s_line);

            let selected = &lines[start_idx..end_idx];
            let mut output = String::new();
            for (idx, line) in selected.iter().enumerate() {
                let line_num = s_line + idx;
                output.push_str(&format!("{:4}: {}\n", line_num, line));
            }
            if e_line < total_lines {
                output.push_str(&format!("... [共 {} 行，已截取显示第 {}..{} 行]\n", total_lines, s_line, e_line));
            }
            (truncate_output(&output), Some(0))
        }
        Err(e) => (format!("读取文件失败: {}", e), Some(1)),
    }
}

// ---------------------------------------------------------------------------
// 4. CLI Execution with Timeout & Truncation
// ---------------------------------------------------------------------------

const MAX_OUTPUT_CHARS: usize = 6000;

fn truncate_output(text: &str) -> String {
    if text.chars().count() <= MAX_OUTPUT_CHARS { return text.to_string(); }
    let half = MAX_OUTPUT_CHARS / 2;
    let head: String = text.chars().take(half).collect();
    let tail: String = text.chars().rev().take(half).collect::<Vec<_>>().into_iter().rev().collect();
    format!("{}\n...（工具返回过长，中间部分已省略）...\n{}", head, tail)
}

async fn read_bounded_output(mut reader: impl tokio::io::AsyncRead + Unpin) -> std::io::Result<Vec<u8>> {
    use tokio::io::AsyncReadExt;
    let mut result = Vec::new();
    let mut buffer = [0u8; 8192];
    let mut truncated = false;
    loop {
        let count = reader.read(&mut buffer).await?;
        if count == 0 { break; }
        let keep = count.min((1024usize * 1024).saturating_sub(result.len()));
        result.extend_from_slice(&buffer[..keep]);
        truncated |= keep < count;
    }
    if truncated { result.extend_from_slice("\n（输出超过 1 MiB，后续内容已省略）".as_bytes()); }
    Ok(result)
}

pub async fn run_cli_command(command: &str, cwd: &Path, timeout_secs: u64) -> (String, Option<i32>) {
    let (shell, flag) = if cfg!(windows) {
        ("powershell", "-Command")
    } else {
        ("sh", "-c")
    };

    let mut cmd = tokio::process::Command::new(shell);
    #[cfg(windows)]
    cmd.args(["-NoLogo", "-NoProfile", "-NonInteractive"]);
    cmd.arg(flag)
        .arg(command)
        .current_dir(cwd)
        .kill_on_drop(true)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return (format!("启动命令失败: {}", e), None),
    };

    let timeout_dur = Duration::from_secs(timeout_secs.clamp(5, 600));
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let output_res = tokio::time::timeout(timeout_dur, async {
        tokio::try_join!(child.wait(), read_bounded_output(stdout), read_bounded_output(stderr))
    }).await;

    match output_res {
        Ok(Ok((status, stdout, stderr))) => {
            let code = status.code();
            let stdout = String::from_utf8_lossy(&stdout);
            let stderr = String::from_utf8_lossy(&stderr);

            let mut combined = format!(
                "Exit code: {}\nWorking directory: {}\n{}",
                code.unwrap_or(-1),
                cwd.display(),
                stdout.trim()
            );
            if !stderr.trim().is_empty() {
                combined.push_str(&format!("\nSTDERR:\n{}", stderr.trim()));
            }

            let trimmed = combined.trim().to_string();
            let result = if trimmed.is_empty() {
                "(no output)".to_string()
            } else {
                truncate_output(&trimmed)
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

pub fn global_persona_path() -> Option<PathBuf> {
    if let Ok(appdata) = std::env::var("APPDATA") {
        Some(PathBuf::from(appdata).join("com.runbi.desktop").join("user_persona.md"))
    } else if let Ok(home) = std::env::var("HOME") {
        Some(PathBuf::from(home).join(".runbi").join("user_persona.md"))
    } else {
        None
    }
}

pub fn read_global_persona() -> String {
    global_persona_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .unwrap_or_default()
}

pub fn save_global_persona(persona: &str) -> std::io::Result<()> {
    if let Some(p) = global_persona_path() {
        if let Some(parent) = p.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        std::fs::write(p, persona)?;
    }
    Ok(())
}

pub fn build_system_prompt(project_dir: &Path) -> String {
    let env_info = collect_env_info(project_dir);
    let hints = read_memory_hints(project_dir);
    let persona = read_global_persona();
    let knowledge = std::fs::read_to_string(project_dir.join(".runbi").join("knowledge.md"))
        .unwrap_or_else(|_| "无".to_string());

    let os_name = if cfg!(windows) { "Windows" } else { "Unix" };
    let shell_name = if cfg!(windows) { "PowerShell" } else { "Shell" };

    format!(
        r#"# 你是谁
你是 Runbi Agent，一个运行在桌面环境中的自主智能体。

# 你在哪
一、你正处在一个 **{}** 环境中，可以通过 read_file 原生读取文件，通过 run_cli 工具来执行任意 {} 命令，包括修改文件、执行脚本、查看系统状态等。优先使用 read_file 查看文件内容，免审批且快速。
二、当前工作空间是：{}
三、当前环境信息如下：
{}

# 用户全局画像与核心偏好（跨项目持久化记忆）
<user_persona>
{}
</user_persona>

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
二、必须以工具调用的形式执行操作。优先调用 read_file 读取文件（纯只读免审批且带行号切片）；纯只读命令会自动放行，涉及修改/执行的操作会提请用户审核。
三、任务完成后，向用户汇报明确的最终结果与产出。
四、run_cli 以无窗口方式后台执行，输出只会回传给你、用户看不见。当任务需要用户在自己屏幕上看到持续效果（动画／图形／交互窗口）时，直接用 Start-Process 拉起一个可见窗口来承载它，不要因为“用户看不到输出”而反复纠结。
五、不要重复执行同一条命令，也不要反复试探同一个信息。命令的输出不会因为你再问一次而改变；连续两次探测都没有获得新信息时，说明方向有误，应立即换一种手段，或直接向用户汇报当前结论。

# 自主反思与主动画像演化准则
一、深度理解用户：你面对的是一位追求极致工程实效、注重代码极简与实测自测的资深技术专家（详见 <user_persona>）。沟通必须直截了当、直击根因、重事实与数据，拒绝空洞套话。
二、主动画像演化（evolve_user_persona）：在与用户的交互、任务推进或纠错反馈中，观察并提炼用户展现出的新偏好、工程约束、特殊习惯或业务特征。一旦有重要新认知，主动调用 `evolve_user_persona` 工具，将反思融入更新后的全局画像中，实现记忆的自我演进。
三、项目经验沉淀（leave_memory_hints）：在当前项目中发现关键架构、特殊命令、环境踩坑等经验时，主动调用 `leave_memory_hints` 将记忆沉淀到当前项目的 `.runbi/hints.md`。
"#,
        os_name,
        shell_name,
        project_dir.display(),
        env_info,
        if persona.is_empty() { "暂无全局画像" } else { &persona },
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
pub async fn get_agent_env_info(project_dir: Option<String>) -> Result<String, String> {
    let dir = project_dir
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    tauri::async_runtime::spawn_blocking(move || collect_env_info(&dir)).await.map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(dead_code)]
pub async fn select_project_directory(default_path: Option<String>) -> Result<Option<String>, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let init_dir = default_path.unwrap_or_default().replace('\'', "''");
            let script = format!(
                r#"[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = '选择工作目录'; $f.ShowNewFolderButton = $true; if ('{0}' -ne '' -and (Test-Path -LiteralPath '{0}')) {{ $f.SelectedPath = '{0}' }}; $owner = New-Object System.Windows.Forms.Form; $owner.TopMost = $true; if ($f.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {{ [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Output $f.SelectedPath }}"#,
                init_dir
            );
            let mut command = std::process::Command::new("powershell");
            use std::os::windows::process::CommandExt;
            use base64::Engine;
            command.creation_flags(0x0800_0000);
            let encoded: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
            let encoded = base64::engine::general_purpose::STANDARD.encode(encoded);
            let output = command
                .args(["-NoLogo", "-NoProfile", "-STA", "-EncodedCommand", &encoded])
                .output()
                .map_err(|e| e.to_string())?;
            if !output.status.success() {
                return Err(format!("无法打开目录选择器: {}", String::from_utf8_lossy(&output.stderr).trim()));
            }
            let path = String::from_utf8_lossy(&output.stdout).trim_start_matches('\u{feff}').trim().to_string();
            if path.is_empty() {
                Ok(None)
            } else if !Path::new(&path).is_dir() {
                Err("选择的工作目录不存在".into())
            } else {
                Ok(Some(path))
            }
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = default_path;
        Err("当前平台暂不支持目录选择器，请手动输入工作目录".into())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentHistoryItem {
    pub role: String,
    pub content: String,
}

fn bounded_history(history: Vec<AgentHistoryItem>) -> Result<Vec<Value>, String> {
    if history.len() % 2 != 0 || history.chunks_exact(2).any(|pair| pair[0].role != "user" || pair[1].role != "assistant") {
        return Err("会话历史格式无效，请开启新会话后重试".into());
    }
    // ponytail: bounded recent context, not semantic summarization; extend with a summary when longer memory is needed.
    let mut pairs = Vec::new();
    let mut chars = 0;
    for pair in history.chunks_exact(2).rev().take(16) {
        let contents: Vec<String> = pair.iter().map(|item| {
            let mut text: String = item.content.chars().take(8000).collect();
            if item.content.chars().count() > 8000 { text.push_str("\n[较早内容已截断]"); }
            text
        }).collect();
        let size = contents.iter().map(|text| text.chars().count()).sum::<usize>();
        if chars + size > 48000 { break; }
        chars += size;
        pairs.push(vec![json!({"role": "user", "content": contents[0]}), json!({"role": "assistant", "content": contents[1]})]);
    }
    Ok(pairs.into_iter().rev().flatten().collect())
}

pub fn compact_earlier_tool_messages(messages: &[Value], preserve_last_n_tools: usize) -> Vec<Value> {
    let tool_indices: Vec<usize> = messages
        .iter()
        .enumerate()
        .filter(|(_, m)| m.get("role").and_then(|r| r.as_str()) == Some("tool"))
        .map(|(i, _)| i)
        .collect();

    let total_tools = tool_indices.len();
    if total_tools <= preserve_last_n_tools {
        return messages.to_vec();
    }

    let cut_point = total_tools - preserve_last_n_tools;
    let old_tool_indices: std::collections::HashSet<usize> = tool_indices[..cut_point].iter().copied().collect();

    messages
        .iter()
        .enumerate()
        .map(|(idx, msg)| {
            if old_tool_indices.contains(&idx) {
                if let Some(content) = msg.get("content").and_then(|c| c.as_str()) {
                    if content.chars().count() > 300 {
                        let lines: Vec<&str> = content.lines().collect();
                        let first_lines = lines.iter().take(4).copied().collect::<Vec<_>>().join("\n");
                        let compacted = format!(
                            "{}\n... [较早工具输出已折叠，共 {} 行，保留前 4 行摘要] ...",
                            first_lines,
                            lines.len()
                        );
                        let mut new_msg = msg.clone();
                        new_msg["content"] = json!(compacted);
                        return new_msg;
                    }
                }
            }
            msg.clone()
        })
        .collect()
}

#[derive(Debug, Deserialize)]
pub struct StartAgentTaskParams {
    pub endpoint: String,
    #[serde(alias = "apiKey", alias = "api_key")]
    pub api_key: String,
    pub model: String,
    pub prompt: String,
    pub history: Option<Vec<AgentHistoryItem>>,
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
    app: tauri::AppHandle,
    params: StartAgentTaskParams,
    channel: Channel<AgentEvent>,
) -> Result<(), String> {
    if AGENT_RUNNING.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        return Err("已有智能体任务正在运行，请先停止该任务".into());
    }
    let _guard = AgentRunGuard;
    ensure_approval_map();
    ACTIVE_AGENT_ABORT.store(false, Ordering::SeqCst);
    crate::commands::file_log(&app, "agent task started");
    let result = tokio::select! {
        biased;
        _ = async {
            while !ACTIVE_AGENT_ABORT.load(Ordering::SeqCst) {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        } => {
            let _ = channel.send(AgentEvent::Done { success: false, total_tokens: 0 });
            Ok(())
        },
        result = run_agent_task(params, &channel) => result,
    };
    crate::commands::file_log(&app, if result.is_ok() { "agent task ended" } else { "agent task failed" });
    result
}

/// A degenerated thinking turn is interrupted and re-planned this many times before the task is
/// declared failed. One strike would throw away an otherwise solvable task; unbounded re-planning
/// would keep burning tokens on a model that cannot escape the loop.
const MAX_SUPPRESSED_TURNS: usize = 2;

/// True once thinking loops have been suppressed `MAX_SUPPRESSED_TURNS` times in a row, i.e. the
/// model cannot escape the loop even after being told to stop deliberating and act.
fn thinking_loop_exhausted(suppressed_turns: usize) -> bool {
    suppressed_turns >= MAX_SUPPRESSED_TURNS
}

/// True when a stream ended normally but produced neither a reply nor tool calls: the model spent
/// its whole output inside the thinking channel and the turn must be re-planned instead of being
/// declared a success that ships a thinking panel with no answer.
fn is_thought_only_turn(received_completion: bool, has_tool_calls: bool, content: &str) -> bool {
    received_completion && !has_tool_calls && content.trim().is_empty()
}

/// Repeated probes tolerated before the reply tells the model to abandon its current approach
/// entirely instead of merely skipping the duplicate command.
const MAX_REPEATED_COMMANDS: usize = 2;

/// Commands are compared after collapsing whitespace and unifying `&&` with `;`, so a model that
/// re-issues "a && b" as "a; b" is still recognised as repeating itself rather than silently burning
/// a turn on work that cannot produce new information. `||` and `|` are deliberately left alone:
/// they change what actually runs.
fn normalize_command(command: &str) -> String {
    let mut normalized = String::with_capacity(command.len());
    let mut chars = command.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '&' => {
                if matches!(chars.peek(), Some('&')) { chars.next(); normalized.push(';'); }
                else { normalized.push('&'); }
            }
            ';' => normalized.push(';'),
            c if c.is_whitespace() => {}
            c => normalized.push(c),
        }
    }
    normalized
}

/// Tracks what this task has already run. A model stuck in a "probe the filesystem again" loop keeps
/// spending turns on identical commands; answering those with "already executed" breaks the loop
/// without failing the task.
#[derive(Default)]
struct CommandLedger {
    seen: std::collections::HashSet<String>,
    repeats: usize,
}

impl CommandLedger {
    /// Forgets every probe recorded so far. Called whenever a command could have changed state, so
    /// that re-reading afterwards runs for real instead of being skipped as a duplicate.
    fn reset(&mut self) {
        self.seen.clear();
        self.repeats = 0;
    }

    /// Registers `command` and reports whether it had already been executed in this task.
    fn is_repeat(&mut self, command: &str) -> bool {
        let key = normalize_command(command);
        if key.is_empty() || self.seen.insert(key) { return false; }
        self.repeats += 1;
        true
    }

    /// Tool result handed back for a skipped duplicate command.
    fn repeat_hint(&self) -> String {
        if self.repeats >= MAX_REPEATED_COMMANDS {
            format!(
                "该命令已经执行过，输出不会改变，本次已跳过重复执行（累计重复 {} 次）。你正在反复探测同一件事：不要再尝试同类命令，请立刻换成完全不同的手段，或直接基于已有输出向用户给出结论。",
                self.repeats
            )
        } else {
            "该命令已经执行过，输出不会改变，本次已跳过重复执行。请改用不同的命令，或基于已有输出继续推进。".to_string()
        }
    }
}

fn evaluate_finish_reason(raw: Option<&Value>) -> Result<bool, String> {
    if let Some(reason) = raw.and_then(|v| v.as_str()) {
        let reason = reason.trim();
        if !reason.is_empty() && reason != "null" {
            if reason != "stop" && reason != "tool_calls" {
                return Err(format!("模型未完成响应（{}），请缩小任务后重试", reason));
            }
            return Ok(true);
        }
    }
    Ok(false)
}

async fn run_agent_task(params: StartAgentTaskParams, channel: &Channel<AgentEvent>) -> Result<(), String> {

    let project_dir = params
        .project_dir
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    let allow_all = params.allow_all.unwrap_or(false);
    let max_turns = params.max_turns.unwrap_or(15).clamp(1, 50);
    if !project_dir.is_dir() { return Err("工作目录不存在或不是文件夹".into()); }
    if params.prompt.trim().is_empty() { return Err("请输入任务目标".into()); }
    let client = Client::builder()
        .no_proxy()
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let prompt_dir = project_dir.clone();
    let system_prompt = tauri::async_runtime::spawn_blocking(move || build_system_prompt(&prompt_dir))
        .await.map_err(|e| format!("环境初始化失败: {}", e))?;
    let mut messages: Vec<Value> = vec![
        json!({ "role": "system", "content": system_prompt }),
    ];

    messages.extend(bounded_history(params.history.unwrap_or_default())?);

    messages.push(json!({ "role": "user", "content": params.prompt }));

    let tools = json!([
        {
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "原生读取工作空间下的文件内容。支持起始/结束行号切片，零进程启动开销且纯只读免审批。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "相对工作空间的相对路径或绝对路径" },
                        "start_line": { "type": "integer", "description": "起始行号（可选，1-indexed，包含此行）" },
                        "end_line": { "type": "integer", "description": "结束行号（可选，1-indexed，包含此行）" }
                    },
                    "required": ["path"]
                }
            }
        },
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
        },
        {
            "type": "function",
            "function": {
                "name": "evolve_user_persona",
                "description": "基于本次交互观察和反思，主动更新并演化全局用户画像（用户偏好、习惯、工作模式、沟通风格等），使后续所有会话更懂用户。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "reflection": { "type": "string", "description": "本次反思的具体洞察：用户展现出了什么偏好、习惯或提出了什么原则约束" },
                        "persona": { "type": "string", "description": "更新后的完整用户画像（Markdown 格式，保留原有核心并融入新反思）" }
                    },
                    "required": ["reflection", "persona"]
                }
            }
        }
    ]);

    let mut total_tokens = 0;
    let mut suppressed_turns = 0usize;
    let mut ledger = CommandLedger::default();

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

        let remaining_turns = max_turns - turn;
        let must_finalize = remaining_turns == 1;

        let mut request_messages = compact_earlier_tool_messages(&messages, 2);
        if must_finalize {
            request_messages.push(json!({
                "role": "user",
                "content": "这是本次任务的最后一个回合，工具已不可用。请立即停止一切探测，仅基于以上已经获得的信息，用简洁的中文给出最终结论与产出；不要重复已执行过的命令，也不要编造未经验证的内容。"
            }));
        } else if remaining_turns <= 3 {
            request_messages.push(json!({
                "role": "user",
                "content": format!(
                    "提示：本次任务最多 {} 轮，现在只剩 {} 轮。请优先收敛：不要重复执行已经执行过的命令；如果已有信息足以回答，请直接给出结论。",
                    max_turns, remaining_turns
                )
            }));
        }

        let mut payload = json!({
            "model": params.model,
            "messages": request_messages,
            "tools": tools,
            "stream": true,
            "temperature": 0.6,
            "frequency_penalty": 0.3,
            "presence_penalty": 0.1,
            "thinking": { "type": "enabled" },
            "chat_template_kwargs": { "enable_thinking": true }
        });
        if must_finalize {
            payload["tool_choice"] = json!("none");
        }

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
                return Err(format!("LLM 请求失败 (HTTP {}): {}", status, truncate_output(&err_text)));
            }
            Err(e) => {
                return Err(format!("网络连接异常: {}", e));
            }
        };

        let mut stream = response.bytes_stream();
        let mut buffer: Vec<u8> = Vec::new();
        let mut full_content = String::new();
        let mut full_reasoning = String::new();
        let mut tool_calls_map: HashMap<usize, (String, String, String)> = HashMap::new();
        let mut reasoning_checker = RepeatSuffixChecker::new(6);
        let mut content_checker = RepeatSuffixChecker::new(6);
        let mut reasoning_suppressed = false;
        let mut content_suppressed = false;
        let mut received_completion = false;
        let mut response_bytes = 0usize;

        'response: while let Some(item) = stream.next().await {
            if ACTIVE_AGENT_ABORT.load(Ordering::SeqCst) {
                let _ = channel.send(AgentEvent::Done { success: false, total_tokens });
                return Ok(());
            }
            let bytes = match item {
                Ok(b) => b,
                Err(e) => {
                    return Err(format!("读取响应流失败: {}", e));
                }
            };

            buffer.extend_from_slice(&bytes);
            response_bytes += bytes.len();
            if response_bytes > 2 * 1024 * 1024 {
                return Err("模型响应过长，已停止以避免内存持续增长".into());
            }

            while let Some(pos) = buffer.iter().position(|&b| b == b'\n') {
                let line_bytes: Vec<u8> = buffer.drain(..=pos).collect();
                let line = String::from_utf8_lossy(&line_bytes).trim().to_string();
                if !line.starts_with("data:") {
                    continue;
                }
                let payload_str = line[5..].trim();
                if payload_str == "[DONE]" {
                    received_completion = true;
                    break 'response;
                }

                if let Ok(chunk) = serde_json::from_str::<Value>(payload_str) {
                    if let Some(choices) = chunk.get("choices").and_then(|c| c.as_array()) {
                        if let Some(first) = choices.first() {
                            if evaluate_finish_reason(first.get("finish_reason"))? {
                                received_completion = true;
                            }
                            let delta = first.get("delta").unwrap_or(&Value::Null);

                            // Reasoning / Thinking stream
                            let reasoning = delta
                                .get("reasoning_content")
                                .or_else(|| delta.get("reasoning"))
                                .and_then(|r| r.as_str())
                                .unwrap_or("");
                            if !reasoning.is_empty() {
                                full_reasoning.push_str(reasoning);
                                if !reasoning_suppressed {
                                    // `any` short-circuits, so the checker stops being fed the
                                    // moment the loop is spotted instead of re-firing on every char.
                                    reasoning_suppressed =
                                        reasoning.chars().any(|ch| reasoning_checker.add_char(ch));
                                    if reasoning_suppressed {
                                        let _ = channel.send(AgentEvent::Status {
                                            message: "检测到思考内容陷入重复循环，已中断本轮思考并重新规划…"
                                                .to_string(),
                                        });
                                        break 'response;
                                    }
                                    let _ = channel.send(AgentEvent::ThinkingChunk {
                                        delta: reasoning.to_string(),
                                    });
                                }
                            }

                            // Content stream
                            let content = delta.get("content").and_then(|c| c.as_str()).unwrap_or("");
                            if !content.is_empty() {
                                full_content.push_str(content);
                                if !content_suppressed {
                                    content_suppressed =
                                        content.chars().any(|ch| content_checker.add_char(ch));
                                    if content_suppressed {
                                        let _ = channel.send(AgentEvent::Status {
                                            message: "检测到模型输出陷入重复循环，已拦截并重新规划…"
                                                .to_string(),
                                        });
                                        let _ = channel.send(AgentEvent::ContentReset {
                                            reason: Some("loop_detected".to_string()),
                                        });
                                        break 'response;
                                    }
                                    let _ = channel.send(AgentEvent::ContentChunk {
                                        delta: content.to_string(),
                                    });
                                }
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

        if reasoning_suppressed || content_suppressed {
            suppressed_turns += 1;
            if thinking_loop_exhausted(suppressed_turns) {
                return Err("检测到输出重复循环，已停止，请重新描述任务".into());
            }
            let retry_prompt = if content_suppressed {
                "你上一轮的回复陷入了机械重复循环（反复输出相同的语句或状态）。请立刻停止重复，不要输出任何状态标头或模板文字：直接调用 run_cli 执行一条最简可行的命令，或直接给出最终结论。"
            } else {
                "你上一轮的思考陷入了重复循环，已被中断。请立刻停止反复推敲与自我怀疑：直接给出下一步——调用 run_cli 执行一条最简可行的命令，或直接给出最终结论。"
            };
            messages.push(json!({
                "role": "user",
                "content": retry_prompt
            }));
            continue;
        }
        suppressed_turns = 0;

        if !received_completion && full_content.is_empty() && tool_calls_map.is_empty() {
            return Err("模型响应意外中断，请重试".into());
        }

        if is_thought_only_turn(received_completion, !tool_calls_map.is_empty(), &full_content) {
            suppressed_turns += 1;
            if thinking_loop_exhausted(suppressed_turns) {
                return Err("模型只输出了思考过程，没有给出最终回答，重试后仍然如此。请重试或更换模型".into());
            }
            let _ = channel.send(AgentEvent::Status {
                message: "模型只输出了思考过程，没有给出回答，正在要求其直接给出结论…".to_string(),
            });
            messages.push(json!({
                "role": "user",
                "content": "你上一轮只输出了思考过程就结束了回合，没有给出任何正式回答。请立刻停止推敲，直接输出最终结论，不要再输出新的思考过程。"
            }));
            continue;
        }

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
                "id": if id.is_empty() { format!("call_{}_{}", turn, idx) } else { id.clone() },
                "type": "function",
                "function": {
                    "name": name,
                    "arguments": args
                }
            }));
        }

        let mut assistant_message = json!({
            "role": "assistant",
            "content": full_content,
            "tool_calls": assistant_tool_calls
        });
        if !full_reasoning.is_empty() {
            assistant_message["reasoning_content"] = json!(full_reasoning);
        }
        messages.push(assistant_message);

        // Execute each tool call
        for &idx in &sorted_indices {
            let (id, name, args_str) = &tool_calls_map[&idx];
            let call_id = if id.is_empty() { format!("call_{}_{}", turn, idx) } else { id.clone() };

            if name == "run_cli" {
                let args_json: Value = serde_json::from_str(args_str).map_err(|e| format!("工具参数无效: {}", e))?;
                let command = args_json
                    .get("command")
                    .and_then(|c| c.as_str())
                    .unwrap_or("")
                    .to_string();
                if command.trim().is_empty() { return Err("模型返回了空命令，请重试".into()); }
                let timeout = args_json.get("timeout").and_then(|t| t.as_u64()).unwrap_or(60);

                let is_readonly = is_readonly_command(&command);
                if !is_readonly {
                    // A command that can change state invalidates every earlier probe: re-reading a
                    // file or a repo after writing to it is verification, not a loop.
                    ledger.reset();
                }

                if ledger.is_repeat(&command) {
                    let hint = ledger.repeat_hint();
                    let _ = channel.send(AgentEvent::ToolProposed {
                        call_id: call_id.clone(),
                        name: name.clone(),
                        command: command.clone(),
                        requires_approval: false,
                    });
                    let _ = channel.send(AgentEvent::ToolExecuted {
                        call_id: call_id.clone(),
                        name: name.clone(),
                        output: hint.clone(),
                        exit_code: Some(1),
                    });
                    messages.push(json!({
                        "role": "tool",
                        "tool_call_id": call_id,
                        "name": name,
                        "content": hint
                    }));
                    continue;
                }

                let requires_approval = !allow_all && !is_readonly;
                let approval = if requires_approval {
                    let (tx, rx) = tokio::sync::oneshot::channel();
                    PENDING_APPROVALS.lock().unwrap().as_mut().unwrap().insert(call_id.clone(), tx);
                    Some(rx)
                } else { None };
                let _ = channel.send(AgentEvent::ToolProposed {
                    call_id: call_id.clone(),
                    name: name.clone(),
                    command: command.clone(),
                    requires_approval,
                });

                if let Some(rx) = approval {
                    // Await approval with a 5-minute timeout
                    let approved = match tokio::time::timeout(Duration::from_secs(300), rx).await {
                        Ok(Ok(true)) => true,
                        _ => false,
                    };
                    PENDING_APPROVALS.lock().unwrap().as_mut().unwrap().remove(&call_id);

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
            } else if name == "read_file" {
                let args_json: Value = serde_json::from_str(args_str).unwrap_or(json!({}));
                let path = args_json.get("path").and_then(|p| p.as_str()).unwrap_or("").to_string();
                let start_line = args_json.get("start_line").and_then(|v| v.as_u64()).map(|v| v as usize);
                let end_line = args_json.get("end_line").and_then(|v| v.as_u64()).map(|v| v as usize);

                let summary = match (start_line, end_line) {
                    (Some(s), Some(e)) => format!("read_file: {} (lines {}..{})", path, s, e),
                    (Some(s), None) => format!("read_file: {} (lines {}..)", path, s),
                    (None, Some(e)) => format!("read_file: {} (lines 1..{})", path, e),
                    (None, None) => format!("read_file: {}", path),
                };

                if ledger.is_repeat(&summary) {
                    let hint = ledger.repeat_hint();
                    let _ = channel.send(AgentEvent::ToolProposed {
                        call_id: call_id.clone(),
                        name: name.clone(),
                        command: summary.clone(),
                        requires_approval: false,
                    });
                    let _ = channel.send(AgentEvent::ToolExecuted {
                        call_id: call_id.clone(),
                        name: name.clone(),
                        output: hint.clone(),
                        exit_code: Some(1),
                    });
                    messages.push(json!({
                        "role": "tool",
                        "tool_call_id": call_id,
                        "name": name,
                        "content": hint
                    }));
                    continue;
                }

                let _ = channel.send(AgentEvent::ToolProposed {
                    call_id: call_id.clone(),
                    name: name.clone(),
                    command: summary.clone(),
                    requires_approval: false,
                });

                let (output, exit_code) = execute_read_file(&project_dir, &path, start_line, end_line);

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
                let args_json: Value = serde_json::from_str(args_str).map_err(|e| format!("记忆参数无效: {}", e))?;
                let hints = args_json
                    .get("hints")
                    .and_then(|h| h.as_str())
                    .unwrap_or("")
                    .to_string();

                save_memory_hints(&project_dir, &hints).map_err(|e| format!("保存记忆失败: {}", e))?;
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
            } else if name == "evolve_user_persona" {
                let args_json: Value = serde_json::from_str(args_str).map_err(|e| format!("画像参数无效: {}", e))?;
                let reflection = args_json
                    .get("reflection")
                    .and_then(|r| r.as_str())
                    .unwrap_or("更新用户偏好画像")
                    .to_string();
                let persona = args_json
                    .get("persona")
                    .and_then(|p| p.as_str())
                    .unwrap_or("")
                    .to_string();

                save_global_persona(&persona).map_err(|e| format!("保存用户画像失败: {}", e))?;
                let _ = channel.send(AgentEvent::PersonaUpdated {
                    reflection: reflection.clone(),
                });

                let res_msg = format!("已成功沉淀自主反思，并持久化演化全局用户画像: {}", reflection);
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
            } else {
                return Err(format!("模型请求了不支持的工具: {}", name));
            }
        }
    }

    let _ = channel.send(AgentEvent::Status {
        message: "已达到任务轮数上限，正在汇总已有结果…".to_string(),
    });
    match finalize_without_tools(
        &client,
        &params.endpoint,
        &params.api_key,
        &params.model,
        &messages,
        channel,
    )
    .await
    {
        Ok(extra_tokens) => {
            total_tokens += extra_tokens;
            let _ = channel.send(AgentEvent::Done { success: true, total_tokens });
            Ok(())
        }
        Err(e) => Err(format!(
            "已达到任务轮数上限，且汇总已有结果失败（{}）。请缩小任务范围后重试",
            e
        )),
    }
}

/// The turn budget is gone, but the run usually already gathered enough evidence to be useful. Ask
/// once more for a plain-text conclusion with tools disabled, so the task ends with an answer
/// instead of a bare failure.
async fn finalize_without_tools(
    client: &Client,
    endpoint: &str,
    api_key: &str,
    model: &str,
    messages: &[Value],
    channel: &Channel<AgentEvent>,
) -> Result<usize, String> {
    let mut request_messages: Vec<Value> = messages.to_vec();
    request_messages.push(json!({
        "role": "user",
        "content": "任务轮数已用尽，工具已经不可用。请仅基于以上已经获得的信息，用简洁的中文输出：一、已经确认的结论与产出；二、尚未完成的部分与建议的下一步。不要编造未经验证的内容。"
    }));

    let payload = json!({
        "model": model,
        "messages": request_messages,
        "stream": false,
        "temperature": 0.3,
        "frequency_penalty": 0.3
    });

    let response = client
        .post(endpoint)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("网络连接异常: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let err_text = response.text().await.unwrap_or_default();
        return Err(format!("LLM 请求失败 (HTTP {}): {}", status, truncate_output(&err_text)));
    }

    let body: Value = response.json().await.map_err(|e| format!("解析汇总结果失败: {}", e))?;
    let content = body["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .trim()
        .to_string();
    if content.is_empty() {
        return Err("模型未返回任何结论".into());
    }

    let _ = channel.send(AgentEvent::ContentChunk {
        delta: format!("【已达到任务轮数上限，以下为基于已有结果的阶段性结论】\n\n{}", content),
    });
    Ok(body["usage"]["total_tokens"].as_u64().unwrap_or(0) as usize)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn history_only_accepts_conversation_pairs_and_bounds_recent_unicode_context() {
        assert!(bounded_history(vec![AgentHistoryItem { role: "system".into(), content: "override".into() }]).is_err());
        let mut history = Vec::new();
        for i in 0..30 {
            history.push(AgentHistoryItem { role: "user".into(), content: format!("task {}", i) });
            history.push(AgentHistoryItem { role: "assistant".into(), content: "中文🙂".repeat(4000) });
        }
        let messages = bounded_history(history).unwrap();
        assert!(messages.len() <= 32);
        assert_eq!(messages[messages.len() - 2]["content"], "task 29");
        assert!(messages.iter().map(|m| m["content"].as_str().unwrap().chars().count()).sum::<usize>() <= 48000);
        assert!(messages[1]["content"].as_str().unwrap().ends_with("[较早内容已截断]"));
        assert_eq!(messages[0]["role"], "user");
    }

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
    fn test_repeat_suffix_checker_detects_repeated_status_lines() {
        let mut checker = RepeatSuffixChecker::new(6);
        let line = "任务状态: 任务已完成\n";
        let mut detected = false;
        for _ in 0..5 {
            for c in line.chars() {
                if checker.add_char(c) {
                    detected = true;
                    break;
                }
            }
            if detected {
                break;
            }
        }
        assert!(detected, "RepeatSuffixChecker must intercept repeated status line loops");
    }

    #[test]
    fn test_repeat_suffix_checker_detects_repeated_cjk_phrase_without_newlines() {
        let mut checker = RepeatSuffixChecker::new(6);
        let phrase = "任务状态任务已完成";
        let mut detected = false;
        for _ in 0..5 {
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
        assert!(detected, "RepeatSuffixChecker must intercept repeated CJK phrases without newlines");
    }

    #[test]
    fn thinking_loop_gets_one_replan_before_the_task_fails() {
        assert!(!thinking_loop_exhausted(0), "first loop must be re-planned, not fatal");
        assert!(
            !thinking_loop_exhausted(MAX_SUPPRESSED_TURNS - 1),
            "a single suppression must not fail the task"
        );
        assert!(
            thinking_loop_exhausted(MAX_SUPPRESSED_TURNS),
            "repeated suppression must finally fail the task"
        );
    }

    #[test]
    fn repeated_probe_commands_are_recognised_across_spacing() {
        let mut ledger = CommandLedger::default();
        assert!(!ledger.is_repeat("git -C . rev-parse --is-inside-git-repository"));
        assert!(ledger.is_repeat("git -C . rev-parse --is-inside-git-repository"));
        assert!(ledger.is_repeat("  git   -C .   rev-parse  --is-inside-git-repository "));
        assert!(!ledger.is_repeat("git -C . branch --show-current"));
    }

    #[test]
    fn chained_commands_count_as_repeats_regardless_of_separator() {
        let mut ledger = CommandLedger::default();
        assert!(!ledger.is_repeat("git status && git diff"));
        assert!(ledger.is_repeat("git status; git diff"));
        assert!(ledger.is_repeat("git status ;  git diff"));
        assert!(!ledger.is_repeat("git status || git diff"));
    }

    #[test]
    fn blank_commands_are_not_treated_as_repeats() {
        let mut ledger = CommandLedger::default();
        assert!(!ledger.is_repeat("   "));
        assert!(!ledger.is_repeat(""));
    }

    #[test]
    fn a_state_changing_command_reopens_the_ledger() {
        let mut ledger = CommandLedger::default();
        assert!(!ledger.is_repeat("git status"));
        assert!(ledger.is_repeat("git status"));
        // After a mutation, re-reading is legitimate verification of the new state.
        ledger.reset();
        assert!(!ledger.is_repeat("git status"));
        assert!(!ledger.repeat_hint().contains("反复探测同一件事"));
    }

    #[test]
    fn repeated_probes_escalate_to_a_stop_probing_hint() {
        let mut ledger = CommandLedger::default();
        assert!(!ledger.is_repeat("Get-ChildItem -Recurse -Force"));
        assert!(ledger.is_repeat("Get-ChildItem -Recurse -Force"));
        let soft = ledger.repeat_hint();
        assert!(soft.contains("跳过重复执行"));
        assert!(!soft.contains("反复探测同一件事"));

        assert!(ledger.is_repeat("Get-ChildItem -Recurse -Force"));
        let hard = ledger.repeat_hint();
        assert!(hard.contains("反复探测同一件事"));
        assert_ne!(soft, hard);
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
        for command in ["echo ok; Start-Process app", "cat $(touch x)", "git branch -D main", "find . -delete", "git diff --output=x", "directory.exe", "ls\nstart app"] {
            assert!(!is_readonly_command(command), "{} must require approval", command);
        }
    }

    #[test]
    fn truncation_preserves_unicode_boundaries() {
        let text = format!("a{}🙂", "中文🙂".repeat(3000));
        let output = truncate_output(&text);
        assert!(output.starts_with('a'));
        assert!(output.ends_with('🙂'));
        assert!(output.contains("中间部分已省略"));
        assert!(output.chars().count() < MAX_OUTPUT_CHARS + 50);
        assert_eq!(truncate_output("中文🙂"), "中文🙂");
    }

    #[tokio::test]
    async fn test_run_cli_command_echo() {
        let temp_dir = std::env::temp_dir();
        let (output, code) = run_cli_command("echo 'runbi_agent_test'", &temp_dir, 5).await;
        assert_eq!(code, Some(0));
        assert!(output.contains("runbi_agent_test"));
    }

    #[tokio::test]
    async fn output_capture_is_bounded() {
        let input = vec![b'x'; 2 * 1024 * 1024];
        let output = read_bounded_output(input.as_slice()).await.unwrap();
        assert!(output.len() < 1024 * 1024 + 100);
        assert!(String::from_utf8_lossy(&output).contains("后续内容已省略"));
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn timed_out_command_does_not_keep_running() {
        let marker = std::env::temp_dir().join(format!("runbi-agent-timeout-{}.txt", std::process::id()));
        let path = marker.to_string_lossy().replace('\'', "''");
        let command = format!("Start-Sleep -Seconds 6; Set-Content -LiteralPath '{}' -Value unexpected", path);
        let (output, code) = run_cli_command(&command, &std::env::temp_dir(), 5).await;
        assert!(output.contains("超时"));
        assert_eq!(code, None);
        tokio::time::sleep(Duration::from_secs(2)).await;
        let exists = marker.exists();
        if exists { let _ = std::fs::remove_file(marker); }
        assert!(!exists, "timed out PowerShell must be terminated");
    }

    #[test]
    fn test_collect_env_info_contains_essential_sections() {
        let temp_dir = std::env::temp_dir();
        let info = collect_env_info(&temp_dir);
        assert!(info.contains("=== 今天日期 ==="));
        assert!(info.contains("=== 系统 ==="));
        assert!(info.contains("=== 已安装工具 ==="));
    }

    #[test]
    fn test_evaluate_finish_reason_allows_empty_and_null() {
        assert_eq!(evaluate_finish_reason(None), Ok(false));
        assert_eq!(evaluate_finish_reason(Some(&Value::Null)), Ok(false));
        assert_eq!(evaluate_finish_reason(Some(&json!(""))), Ok(false));
        assert_eq!(evaluate_finish_reason(Some(&json!("   "))), Ok(false));
        assert_eq!(evaluate_finish_reason(Some(&json!("null"))), Ok(false));
        assert_eq!(evaluate_finish_reason(Some(&json!("stop"))), Ok(true));
        assert_eq!(evaluate_finish_reason(Some(&json!("tool_calls"))), Ok(true));
        assert!(evaluate_finish_reason(Some(&json!("length"))).is_err());
    }

    #[test]
    fn test_thought_only_turn_is_never_a_success() {
        // 截图回归：模型把全部输出花在思考里，流正常结束后不能被当作任务成功。
        assert!(is_thought_only_turn(true, false, ""));
        assert!(is_thought_only_turn(true, false, "  \n "));
        assert!(!is_thought_only_turn(false, false, ""), "流中断走“意外中断”错误，不走重规划");
        assert!(!is_thought_only_turn(true, true, ""), "有工具调用则继续执行工具");
        assert!(!is_thought_only_turn(true, false, "结论：……"), "有正文即正常完成");
    }

    #[test]
    fn test_global_persona_roundtrip_and_injection() {
        let temp_dir = std::env::temp_dir();
        let prompt = build_system_prompt(&temp_dir);
        assert!(prompt.contains("<user_persona>"));
        assert!(prompt.contains("自主反思与主动画像演化准则"));
        assert!(prompt.contains("evolve_user_persona"));
    }

    #[test]
    fn test_execute_read_file_slices_and_errors() {
        let temp_dir = std::env::temp_dir();
        let test_file = temp_dir.join(format!("runbi-read-test-{}.txt", std::process::id()));
        let content = "line 1\nline 2\nline 3\nline 4\nline 5\n";
        std::fs::write(&test_file, content).unwrap();

        let filename = test_file.file_name().unwrap().to_str().unwrap();

        // Full read
        let (out, code) = execute_read_file(&temp_dir, filename, None, None);
        assert_eq!(code, Some(0));
        assert!(out.contains("   1: line 1"));
        assert!(out.contains("   5: line 5"));

        // Slice read: lines 2..4
        let (out_slice, code_slice) = execute_read_file(&temp_dir, filename, Some(2), Some(4));
        assert_eq!(code_slice, Some(0));
        assert!(!out_slice.contains("   1: line 1"));
        assert!(out_slice.contains("   2: line 2"));
        assert!(out_slice.contains("   4: line 4"));
        assert!(!out_slice.contains("   5: line 5"));
        assert!(out_slice.contains("已截取显示第 2..4 行"));

        // Non-existent file
        let (out_missing, code_missing) = execute_read_file(&temp_dir, "non-existent-12345.xyz", None, None);
        assert_eq!(code_missing, Some(1));
        assert!(out_missing.contains("不存在"));

        let _ = std::fs::remove_file(test_file);
    }

    #[test]
    fn test_is_readonly_pipeline_support() {
        assert!(is_readonly_command("git log -n 5 | head -n 3"));
        assert!(is_readonly_command("dir | findstr rs"));
        assert!(is_readonly_command("Get-ChildItem -Path . | Select-Object -First 10"));
        assert!(is_readonly_command("cat Cargo.toml | grep version"));

        // Dangerous or modifying piped commands must still be rejected
        assert!(!is_readonly_command("cat file.txt | rm -rf"));
        assert!(!is_readonly_command("git log | Out-File evil.txt"));
        assert!(!is_readonly_command("dir | Set-Content evil.txt"));
        assert!(!is_readonly_command("cat file.txt || rm -rf"));
        assert!(!is_readonly_command("git log | "));
    }

    #[test]
    fn test_compact_earlier_tool_messages() {
        let msgs = vec![
            json!({"role": "system", "content": "sys"}),
            json!({"role": "user", "content": "do task"}),
            json!({"role": "assistant", "content": "calling tool 1"}),
            json!({"role": "tool", "content": "line 1\nline 2\nline 3\nline 4\nline 5\n".repeat(20)}), // tool 1 (long)
            json!({"role": "assistant", "content": "calling tool 2"}),
            json!({"role": "tool", "content": "recent tool output 2"}), // tool 2
            json!({"role": "assistant", "content": "calling tool 3"}),
            json!({"role": "tool", "content": "recent tool output 3"}), // tool 3
        ];

        // Preserve last 2 tools (tool 2 and 3 kept full, tool 1 compacted)
        let compacted = compact_earlier_tool_messages(&msgs, 2);
        assert_eq!(compacted.len(), msgs.len());
        let tool1_content = compacted[3]["content"].as_str().unwrap();
        assert!(tool1_content.contains("较早工具输出已折叠"));
        assert_eq!(compacted[5]["content"], "recent tool output 2");
        assert_eq!(compacted[7]["content"], "recent tool output 3");
    }
}
