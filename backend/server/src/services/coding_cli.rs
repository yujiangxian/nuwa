// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

//! 本机 coding Agent CLI 代理 — Claude Code (`claude -p`) / Cursor (`agent -p`)。
//! 将 CLI 的 stream-json / text 输出转成 OpenAI 兼容 SSE，供前端网关复用。

use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio_stream::wrappers::ReceiverStream;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodingProvider {
    ClaudeCode,
    CursorAgent,
}

impl CodingProvider {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ClaudeCode => "claude-code",
            Self::CursorAgent => "cursor-sdk",
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct CodingChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct CodingStreamRequest {
    #[serde(default)]
    pub messages: Vec<CodingChatMessage>,
    #[serde(default)]
    pub system: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    /// 工作目录；缺省为 Nuwa 项目根。
    #[serde(default)]
    pub cwd: Option<String>,
    /// Claude: default | acceptEdits | bypassPermissions …
    #[serde(default)]
    pub permission_mode: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CodingStatus {
    pub provider: String,
    pub available: bool,
    pub binary: Option<String>,
    pub version: Option<String>,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key_configured: Option<bool>,
}

fn which_candidates(names: &[&str]) -> Option<PathBuf> {
    for name in names {
        if let Ok(p) = which_bin(name) {
            return Some(p);
        }
    }
    None
}

/// Minimal which: PATH + PATHEXT on Windows.
fn which_bin(name: &str) -> Result<PathBuf, String> {
    if let Ok(override_path) = std::env::var(format!(
        "NUWA_{}_PATH",
        if name.starts_with("claude") {
            "CLAUDE"
        } else if name.contains("cursor") || name == "agent" {
            "CURSOR_AGENT"
        } else {
            "CODING_BIN"
        }
    )) {
        let p = PathBuf::from(override_path.trim());
        if p.is_file() {
            return Ok(p);
        }
    }

    let path = std::env::var_os("PATH").ok_or_else(|| "PATH 未设置".to_string())?;
    let exts: Vec<String> = if cfg!(windows) {
        std::env::var_os("PATHEXT")
            .map(|e| {
                e.to_string_lossy()
                    .split(';')
                    .map(|s| s.to_string())
                    .collect()
            })
            .unwrap_or_else(|| vec!["".into(), ".EXE".into(), ".CMD".into(), ".BAT".into()])
    } else {
        vec!["".into()]
    };

    for dir in std::env::split_paths(&path) {
        for ext in &exts {
            let candidate = dir.join(format!("{name}{ext}"));
            if candidate.is_file() {
                // Skip Grok's unrelated `agent.exe` when resolving Cursor.
                if name == "agent" {
                    let s = candidate.to_string_lossy().to_ascii_lowercase();
                    // Grok Build 也提供 agent.exe，不能误用。
                    if s.contains(".grok") {
                        continue;
                    }
                }
                return Ok(candidate);
            }
        }
    }
    Err(format!("未找到可执行文件: {name}"))
}

/// Claude 启动计划：优先 `node …/cli.js`（避开 Windows .cmd shim 问题）。
struct ClaudeLaunch {
    program: PathBuf,
    prefix_args: Vec<String>,
    /// 用于 status 展示
    display: String,
}

fn resolve_claude_launch() -> Result<ClaudeLaunch, String> {
    if let Ok(p) = std::env::var("NUWA_CLAUDE_PATH") {
        let pb = PathBuf::from(p.trim());
        if pb.is_file() {
            return Ok(ClaudeLaunch {
                display: pb.display().to_string(),
                program: pb,
                prefix_args: vec![],
            });
        }
    }

    // npm 全局：…/npm/node_modules/@anthropic-ai/claude-code/cli.js
    if let Ok(appdata) = std::env::var("APPDATA") {
        let cli = PathBuf::from(&appdata)
            .join("npm")
            .join("node_modules")
            .join("@anthropic-ai")
            .join("claude-code")
            .join("cli.js");
        if cli.is_file() {
            let node = which_candidates(&["node", "node.exe"]).ok_or_else(|| {
                "找到 Claude cli.js 但未找到 node，请安装 Node.js".to_string()
            })?;
            return Ok(ClaudeLaunch {
                display: cli.display().to_string(),
                program: node,
                prefix_args: vec![cli.display().to_string()],
            });
        }
    }

    let bin = which_candidates(&["claude", "claude.cmd"]).ok_or_else(|| {
        "未找到 Claude Code CLI（claude）。请安装 @anthropic-ai/claude-code 并确保在 PATH 中。"
            .to_string()
    })?;
    Ok(ClaudeLaunch {
        display: bin.display().to_string(),
        program: bin,
        prefix_args: vec![],
    })
}

/// Cursor 启动：优先 `versions/*/node.exe index.js`，避开 `.cmd` → PowerShell 二次包装导致的参数丢失。
struct CursorLaunch {
    program: PathBuf,
    prefix_args: Vec<String>,
    display: String,
}

fn resolve_cursor_launch() -> Result<CursorLaunch, String> {
    if let Ok(p) = std::env::var("NUWA_CURSOR_AGENT_PATH") {
        let pb = PathBuf::from(p.trim());
        if pb.is_file() {
            return Ok(CursorLaunch {
                display: pb.display().to_string(),
                program: pb,
                prefix_args: vec![],
            });
        }
    }

    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let root = PathBuf::from(&local).join("cursor-agent");
        let versions_dir = root.join("versions");
        if versions_dir.is_dir() {
            let mut versions: Vec<_> = std::fs::read_dir(&versions_dir)
                .into_iter()
                .flatten()
                .filter_map(|e| e.ok())
                .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                .map(|e| e.path())
                .collect();
            // 目录名形如 2026.07.09-a3815c0，字典序大致即时间序
            versions.sort();
            if let Some(ver) = versions.pop() {
                let node = ver.join(if cfg!(windows) { "node.exe" } else { "node" });
                let index = ver.join("index.js");
                if node.is_file() && index.is_file() {
                    return Ok(CursorLaunch {
                        display: format!(
                            "{} ({})",
                            root.join("cursor-agent.cmd").display(),
                            ver.file_name().and_then(|s| s.to_str()).unwrap_or("?")
                        ),
                        program: node,
                        prefix_args: vec![index.display().to_string()],
                    });
                }
            }
        }
        for name in ["cursor-agent.cmd", "cursor-agent.exe", "agent.cmd", "agent.exe"] {
            let candidate = root.join(name);
            if candidate.is_file() {
                return Ok(CursorLaunch {
                    display: candidate.display().to_string(),
                    program: candidate,
                    prefix_args: vec![],
                });
            }
        }
    }

    let bin = which_candidates(&["cursor-agent", "agent"]).ok_or_else(|| {
        "未找到 Cursor Agent CLI（cursor-agent）。请执行: irm 'https://cursor.com/install?win32=true' | iex，并把 %LOCALAPPDATA%\\cursor-agent 加入 PATH"
            .to_string()
    })?;
    Ok(CursorLaunch {
        display: bin.display().to_string(),
        program: bin,
        prefix_args: vec![],
    })
}

fn resolve_cwd(req_cwd: Option<&str>) -> PathBuf {
    if let Some(c) = req_cwd.map(str::trim).filter(|s| !s.is_empty()) {
        return PathBuf::from(c);
    }
    if let Ok(c) = std::env::var("NUWA_CODING_CWD") {
        let t = c.trim();
        if !t.is_empty() {
            return PathBuf::from(t);
        }
    }
    crate::util::project_root()
}

fn build_prompt(req: &CodingStreamRequest) -> String {
    let mut parts = Vec::new();
    if let Some(sys) = req.system.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        parts.push(format!("System:\n{sys}"));
    }
    for m in &req.messages {
        let role = m.role.trim();
        let content = m.content.trim();
        if content.is_empty() {
            continue;
        }
        let label = match role {
            "assistant" => "Assistant",
            "system" => "System",
            _ => "User",
        };
        parts.push(format!("{label}:\n{content}"));
    }
    if parts.is_empty() {
        "你好".into()
    } else {
        parts.join("\n\n")
    }
}

/// 从 CLI stream-json 行中尽量提取助手文本增量。
pub fn extract_text_delta(line: &str) -> Option<String> {
    let v: Value = serde_json::from_str(line.trim()).ok()?;
    let ty = v.get("type").and_then(|t| t.as_str()).unwrap_or("");

    // Claude / Cursor: assistant message content
    if ty == "assistant" {
        if let Some(arr) = v.pointer("/message/content").and_then(|c| c.as_array()) {
            let mut out = String::new();
            for block in arr {
                if let Some(t) = block.get("text").and_then(|t| t.as_str()) {
                    out.push_str(t);
                }
            }
            if !out.is_empty() {
                return Some(out);
            }
        }
    }

    // Claude partial: content_block_delta
    if ty == "content_block_delta" {
        if let Some(t) = v.pointer("/delta/text").and_then(|t| t.as_str()) {
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }

    // Generic delta fields
    if let Some(t) = v.get("delta").and_then(|d| d.as_str()) {
        if !t.is_empty() {
            return Some(t.to_string());
        }
    }

    None
}

fn sse_delta_chunk(text: &str) -> String {
    let payload = json!({
        "choices": [{ "delta": { "content": text } }]
    });
    format!("data: {payload}\n\n")
}

fn cursor_api_key_path() -> PathBuf {
    crate::util::project_root().join("data").join("cursor_api_key.txt")
}

fn anthropic_api_key_path() -> PathBuf {
    crate::util::project_root().join("data").join("anthropic_api_key.txt")
}

fn load_key_file(path: &Path) -> Option<String> {
    std::fs::read_to_string(path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn save_key_file(path: &Path, key: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let trimmed = key.trim();
    if trimmed.is_empty() {
        let _ = std::fs::remove_file(path);
        return Ok(());
    }
    std::fs::write(path, trimmed).map_err(|e| e.to_string())
}

pub fn load_cursor_api_key() -> Option<String> {
    if let Ok(k) = std::env::var("CURSOR_API_KEY") {
        let t = k.trim().to_string();
        if !t.is_empty() {
            return Some(t);
        }
    }
    load_key_file(&cursor_api_key_path())
}

pub fn save_cursor_api_key(key: &str) -> Result<(), String> {
    save_key_file(&cursor_api_key_path(), key)
}

/// 优先环境变量，其次 `data/anthropic_api_key.txt`。
pub fn load_anthropic_api_key() -> Option<String> {
    if let Ok(k) = std::env::var("ANTHROPIC_API_KEY") {
        let t = k.trim().to_string();
        if !t.is_empty() {
            return Some(t);
        }
    }
    load_key_file(&anthropic_api_key_path())
}

pub fn save_anthropic_api_key(key: &str) -> Result<(), String> {
    save_key_file(&anthropic_api_key_path(), key)
}

async fn probe_version(bin: &Path) -> Option<String> {
    let out = Command::new(bin)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .ok()?;
    let mut s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        s = String::from_utf8_lossy(&out.stderr).trim().to_string();
    }
    if s.is_empty() {
        None
    } else {
        Some(s.lines().next().unwrap_or(&s).to_string())
    }
}

pub async fn status(provider: CodingProvider) -> CodingStatus {
    match provider {
        CodingProvider::ClaudeCode => match resolve_claude_launch() {
            Ok(launch) => {
                let version = {
                    let mut c = Command::new(&launch.program);
                    for a in &launch.prefix_args {
                        c.arg(a);
                    }
                    c.arg("--version")
                        .stdin(Stdio::null())
                        .stdout(Stdio::piped())
                        .stderr(Stdio::piped());
                    match c.output().await {
                        Ok(out) => {
                            let mut s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                            if s.is_empty() {
                                s = String::from_utf8_lossy(&out.stderr).trim().to_string();
                            }
                            if s.is_empty() {
                                None
                            } else {
                                Some(s.lines().next().unwrap_or(&s).to_string())
                            }
                        }
                        Err(_) => None,
                    }
                };
                let key_ok = load_anthropic_api_key().is_some();
                CodingStatus {
                    provider: provider.as_str().into(),
                    available: true,
                    binary: Some(launch.display),
                    version,
                    message: if key_ok {
                        "已检测到 Claude Code CLI；将使用 ANTHROPIC_API_KEY".into()
                    } else {
                        "已检测到 Claude Code CLI（未配置 API Key 时走本机登录态）".into()
                    },
                    api_key_configured: Some(key_ok),
                }
            }
            Err(e) => CodingStatus {
                provider: provider.as_str().into(),
                available: false,
                binary: None,
                version: None,
                message: e,
                api_key_configured: Some(false),
            },
        },
        CodingProvider::CursorAgent => {
            // Dashboard「API Key」= 订阅账号鉴权，用量走套餐池（不是另开按量 API 账单）。
            // 也可在终端 `agent login` 用浏览器登录同一套餐，无需粘贴 Key。
            let key_ok = load_cursor_api_key().is_some();
            match resolve_cursor_launch() {
                Ok(launch) => {
                    let version = {
                        let mut c = Command::new(&launch.program);
                        for a in &launch.prefix_args {
                            c.arg(a);
                        }
                        c.arg("--version")
                            .stdin(Stdio::null())
                            .stdout(Stdio::piped())
                            .stderr(Stdio::piped());
                        match c.output().await {
                            Ok(out) => {
                                let mut s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                                if s.is_empty() {
                                    s = String::from_utf8_lossy(&out.stderr).trim().to_string();
                                }
                                if s.is_empty() {
                                    None
                                } else {
                                    Some(s.lines().next().unwrap_or(&s).to_string())
                                }
                            }
                            Err(_) => None,
                        }
                    };
                    let message = if key_ok {
                        "已检测到 Cursor Agent CLI；将用订阅账号鉴权（Dashboard Key / 环境变量）".into()
                    } else {
                        "已检测到 Cursor Agent CLI（本机 login / 订阅额度）".into()
                    };
                    CodingStatus {
                        provider: provider.as_str().into(),
                        available: true,
                        binary: Some(launch.display),
                        version,
                        message,
                        api_key_configured: Some(key_ok),
                    }
                }
                Err(e) => CodingStatus {
                    provider: provider.as_str().into(),
                    available: false,
                    binary: None,
                    version: None,
                    message: e,
                    api_key_configured: Some(key_ok),
                },
            }
        }
    }
}

/// Spawn CLI and return an SSE byte stream (OpenAI chat.completion.chunk style).
pub async fn stream_sse(
    provider: CodingProvider,
    req: CodingStreamRequest,
) -> Result<ReceiverStream<Result<Vec<u8>, std::io::Error>>, String> {
    let cwd = resolve_cwd(req.cwd.as_deref());
    if !cwd.is_dir() {
        return Err(format!("工作目录不存在: {}", cwd.display()));
    }
    let prompt = build_prompt(&req);
    let model = req
        .model
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    // Claude: 默认 text（稳定、可按字节流式）；NUWA_CLAUDE_OUTPUT=stream-json 可切换。
    // Cursor: stream-json + partial。
    let use_stream_json = match provider {
        CodingProvider::ClaudeCode => {
            std::env::var("NUWA_CLAUDE_OUTPUT")
                .map(|v| v.eq_ignore_ascii_case("stream-json"))
                .unwrap_or(false)
        }
        CodingProvider::CursorAgent => true,
    };

    let (program, args, display_bin) = match provider {
        CodingProvider::ClaudeCode => {
            let launch = resolve_claude_launch()?;
            let mut args = launch.prefix_args;
            args.push("-p".into());
            args.push(prompt);
            if use_stream_json {
                args.push("--output-format".into());
                args.push("stream-json".into());
                args.push("--verbose".into());
                args.push("--include-partial-messages".into());
            } else {
                args.push("--output-format".into());
                args.push("text".into());
            }
            let mode = req
                .permission_mode
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("acceptEdits");
            args.push("--permission-mode".into());
            args.push(mode.into());
            if let Some(m) = model {
                args.push("--model".into());
                args.push(m);
            }
            (launch.program, args, launch.display)
        }
        CodingProvider::CursorAgent => {
            let launch = resolve_cursor_launch()?;
            // Cursor：`-p/--print` 是布尔开关，prompt 为位置参数（不要写成 `-p <prompt>`）。
            // 不强制 Key：优先本机 `agent login`；有 Dashboard Key 则注入（仍扣套餐额度）。
            let mut args = launch.prefix_args;
            args.extend([
                "-p".into(),
                "--force".into(),
                "--trust".into(),
                "--output-format".into(),
                "stream-json".into(),
                "--stream-partial-output".into(),
            ]);
            if let Some(m) = model {
                args.push("--model".into());
                args.push(m);
            }
            args.push(prompt);
            (launch.program, args, launch.display)
        }
    };

    let mut cmd = {
        let ext = program
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if cfg!(windows) && (ext == "cmd" || ext == "bat") {
            let mut c = Command::new("cmd.exe");
            c.arg("/D").arg("/C").arg(program.as_os_str());
            for a in &args {
                c.arg(a);
            }
            c
        } else {
            let mut c = Command::new(&program);
            c.args(&args);
            c
        }
    };
    cmd.current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .env("CI", "1");

    if provider == CodingProvider::CursorAgent {
        if let Some(key) = load_cursor_api_key() {
            cmd.env("CURSOR_API_KEY", key);
        }
    }
    if provider == CodingProvider::ClaudeCode {
        if let Some(key) = load_anthropic_api_key() {
            // 显式注入，优先于 CLI 订阅 OAuth / keychain
            cmd.env("ANTHROPIC_API_KEY", key);
        }
    }

    let mut child = cmd.spawn().map_err(|e| {
        format!(
            "启动 {} 失败: {e}（binary={}）",
            provider.as_str(),
            display_bin
        )
    })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法捕获 CLI stdout".to_string())?;
    let stderr = child.stderr.take();

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Vec<u8>, std::io::Error>>(32);

    tokio::spawn(async move {
        use tokio::io::AsyncReadExt;

        let mut emitted_any = false;
        let mut last_assistant = String::new();

        if use_stream_json {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if line.trim().is_empty() {
                    continue;
                }
                if let Some(delta) = extract_text_delta(&line) {
                    let to_send = if line.contains("\"type\":\"assistant\"")
                        || line.contains("\"type\": \"assistant\"")
                    {
                        if delta.starts_with(&last_assistant) {
                            let suffix = delta[last_assistant.len()..].to_string();
                            last_assistant = delta;
                            suffix
                        } else {
                            last_assistant = delta.clone();
                            delta
                        }
                    } else {
                        delta
                    };
                    if !to_send.is_empty() {
                        emitted_any = true;
                        let chunk = sse_delta_chunk(&to_send);
                        if tx.send(Ok(chunk.into_bytes())).await.is_err() {
                            let _ = child.kill().await;
                            return;
                        }
                    }
                }
            }
        } else {
            // text 模式：按字节块转发，避免等整行缓冲。
            let mut reader = BufReader::new(stdout);
            let mut buf = [0u8; 512];
            loop {
                match reader.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]);
                        if !text.is_empty() {
                            emitted_any = true;
                            let chunk = sse_delta_chunk(&text);
                            if tx.send(Ok(chunk.into_bytes())).await.is_err() {
                                let _ = child.kill().await;
                                return;
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
        }

        let status = child.wait().await;
        let mut err_tail = String::new();
        if let Some(err) = stderr {
            let mut er = BufReader::new(err).lines();
            while let Ok(Some(line)) = er.next_line().await {
                if err_tail.len() < 2000 {
                    err_tail.push_str(&line);
                    err_tail.push('\n');
                }
            }
        }

        match status {
            Ok(s) if s.success() || emitted_any => {
                let _ = tx.send(Ok(b"data: [DONE]\n\n".to_vec())).await;
            }
            Ok(s) => {
                let msg = if err_tail.trim().is_empty() {
                    format!("CLI 退出码 {}", s.code().unwrap_or(-1))
                } else {
                    err_tail.trim().chars().take(500).collect::<String>()
                };
                let payload = json!({ "error": { "message": msg } });
                let _ = tx
                    .send(Ok(format!("data: {payload}\n\n").into_bytes()))
                    .await;
                let _ = tx.send(Ok(b"data: [DONE]\n\n".to_vec())).await;
            }
            Err(e) => {
                let payload = json!({ "error": { "message": e.to_string() } });
                let _ = tx
                    .send(Ok(format!("data: {payload}\n\n").into_bytes()))
                    .await;
                let _ = tx.send(Ok(b"data: [DONE]\n\n".to_vec())).await;
            }
        }
    });

    Ok(ReceiverStream::new(rx))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_claude_partial_delta() {
        let line = r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"你好"}}"#;
        assert_eq!(extract_text_delta(line).as_deref(), Some("你好"));
    }

    #[test]
    fn extract_assistant_blocks() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}"#;
        assert_eq!(extract_text_delta(line).as_deref(), Some("Hello"));
    }

    #[test]
    fn build_prompt_joins_roles() {
        let req = CodingStreamRequest {
            messages: vec![
                CodingChatMessage {
                    role: "user".into(),
                    content: "hi".into(),
                },
                CodingChatMessage {
                    role: "assistant".into(),
                    content: "yo".into(),
                },
            ],
            system: Some("sys".into()),
            model: None,
            cwd: None,
            permission_mode: None,
        };
        let p = build_prompt(&req);
        assert!(p.contains("System:"));
        assert!(p.contains("User:"));
        assert!(p.contains("Assistant:"));
    }
}
