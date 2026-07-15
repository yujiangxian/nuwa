// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

use axum::{
    body::{Body, Bytes},
    extract::State,
    http::{header, StatusCode},
    response::Response,
    Json,
};
use futures::{Stream, StreamExt};
use serde::Serialize;
use std::pin::Pin;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::constants::ollama_chat_url;
use crate::handlers::chat::{
    build_ollama_body, clamp_params, ollama_model_name, params_to_options, resolve_model,
    ChatRequest,
};
use crate::state::AppState;

// 保持公开 API 稳定：纯函数 build_ollama_messages 现归属 chat.rs，
// 经此重导出，既有库路径 `chat_stream::build_ollama_messages` 仍可用（集成测试依赖）。
pub use crate::handlers::chat::build_ollama_messages;

/// 单个下行数据块（Stream_Chunk），序列化为一行 NDJSON。
/// delta / done / error 三者互斥地承载本块语义（借助 skip_serializing_if）。
#[derive(Debug, Serialize, PartialEq)]
pub struct StreamChunk {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delta: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub done: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl StreamChunk {
    pub fn delta(text: impl Into<String>) -> Self {
        StreamChunk {
            delta: Some(text.into()),
            done: false,
            error: None,
        }
    }

    pub fn done() -> Self {
        StreamChunk {
            delta: None,
            done: true,
            error: None,
        }
    }

    pub fn error(msg: impl Into<String>) -> Self {
        StreamChunk {
            delta: None,
            done: false,
            error: Some(msg.into()),
        }
    }
}

/// Ollama 单行 NDJSON 解析结果。
#[derive(Debug, PartialEq)]
pub struct OllamaLine {
    pub delta: String,
    pub done: bool,
}

/// 把已累积缓冲按 '\n' 分帧为「完整行」与「剩余未完成片段」。
/// 不分配新字符串（按 &str 切分）。最后一个 '\n' 之后的内容作为 rest 返回；
/// 若 buffer 以 '\n' 结尾则 rest 为空串。
pub fn split_lines(buffer: &str) -> (Vec<&str>, &str) {
    match buffer.rfind('\n') {
        Some(idx) => {
            let complete = &buffer[..idx]; // 不含最后的 '\n'
            let rest = &buffer[idx + 1..];
            let lines: Vec<&str> = complete.split('\n').collect();
            (lines, rest)
        }
        None => (Vec::new(), buffer),
    }
}

/// 解析 Ollama 单行 NDJSON，提取增量文本（message.content）与结束标志（done）。
/// 容错：非 JSON / 缺字段时 delta 为 ""、done 为 false。
pub fn parse_ollama_line(line: &str) -> OllamaLine {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return OllamaLine {
            delta: String::new(),
            done: false,
        };
    }
    match serde_json::from_str::<serde_json::Value>(trimmed) {
        Ok(v) => {
            let delta = v
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .to_string();
            let done = v.get("done").and_then(|d| d.as_bool()).unwrap_or(false);
            OllamaLine { delta, done }
        }
        Err(_) => OllamaLine {
            delta: String::new(),
            done: false,
        },
    }
}

/// 把一个 StreamChunk 序列化为「一行 JSON + '\n'」的 NDJSON 文本。
fn encode_chunk(chunk: &StreamChunk) -> String {
    let mut s = serde_json::to_string(chunk).unwrap_or_else(|_| "{}".to_string());
    s.push('\n');
    s
}

type OllamaByteStream = Pin<Box<dyn Stream<Item = Result<Bytes, reqwest::Error>> + Send>>;

/// 流式 handler 内部状态机。
enum StreamState {
    /// 仅下发一个 error chunk 后结束（连接失败 / 非成功状态码）。
    SingleError(String),
    /// 正在转发 Ollama 字节流。
    Streaming {
        stream: OllamaByteStream,
        leftover: Vec<u8>,
    },
    /// 流终止。
    End,
}

/// 构造响应体的 NDJSON 字节流。每个网络分块产出一段（可能含多行）NDJSON 文本。
fn build_response_body(initial: StreamState) -> Body {
    let s = futures::stream::unfold(initial, |state| async move {
        match state {
            StreamState::SingleError(msg) => {
                let out = encode_chunk(&StreamChunk::error(msg));
                Some((
                    Ok::<Bytes, std::io::Error>(Bytes::from(out)),
                    StreamState::End,
                ))
            }
            StreamState::Streaming {
                mut stream,
                mut leftover,
            } => loop {
                match stream.next().await {
                    Some(Ok(bytes)) => {
                        leftover.extend_from_slice(&bytes);
                        // 仅在 '\n'（单字节 0x0A，UTF-8 安全）处分帧，未完成片段留在 leftover。
                        let last_nl = leftover.iter().rposition(|&b| b == b'\n');
                        let Some(pos) = last_nl else {
                            // 尚无完整行，继续读取。
                            continue;
                        };
                        let complete: Vec<u8> = leftover[..=pos].to_vec();
                        let rest: Vec<u8> = leftover[pos + 1..].to_vec();
                        leftover = rest;

                        let text = String::from_utf8_lossy(&complete);
                        let (lines, _trailing) = split_lines(&text);

                        let mut out = String::new();
                        let mut done = false;
                        for line in lines {
                            if line.trim().is_empty() {
                                continue;
                            }
                            let parsed = parse_ollama_line(line);
                            if !parsed.delta.is_empty() {
                                out.push_str(&encode_chunk(&StreamChunk::delta(parsed.delta)));
                            }
                            if parsed.done {
                                out.push_str(&encode_chunk(&StreamChunk::done()));
                                done = true;
                                break;
                            }
                        }

                        if done {
                            return Some((Ok(Bytes::from(out)), StreamState::End));
                        }
                        if out.is_empty() {
                            // 本次分块只产生空行/无增量，继续读取下一块。
                            return Some((
                                Ok(Bytes::new()),
                                StreamState::Streaming { stream, leftover },
                            ));
                        }
                        return Some((
                            Ok(Bytes::from(out)),
                            StreamState::Streaming { stream, leftover },
                        ));
                    }
                    Some(Err(e)) => {
                        // 流读取出错：以 error chunk 表达（此时已开始响应，无法改状态码）。
                        let out =
                            encode_chunk(&StreamChunk::error(format!("读取 Ollama 流出错: {}", e)));
                        return Some((Ok(Bytes::from(out)), StreamState::End));
                    }
                    None => {
                        // 流自然结束且未显式 done：补发一个 done chunk。
                        let out = encode_chunk(&StreamChunk::done());
                        return Some((Ok(Bytes::from(out)), StreamState::End));
                    }
                }
            },
            StreamState::End => None,
        }
    });

    Body::from_stream(s)
}

/// 用给定初始状态构造完整的 NDJSON 流式响应（200 + application/x-ndjson）。
fn ndjson_response(initial: StreamState) -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/x-ndjson")
        .body(build_response_body(initial))
        .expect("构造流式响应失败")
}

/// 流式对话 handler：向 Ollama 发起 stream:true 请求，逐块下发 NDJSON。
pub async fn chat_stream(
    State(state): State<Arc<RwLock<AppState>>>,
    Json(req): Json<ChatRequest>,
) -> Response {
    let config = {
        let state = state.read().await;
        state.config.clone()
    };

    let model = resolve_model(config.current_llm_model, &req.model);
    // 规范化为 Ollama 裸模型名（剥离内部 `llm/` 前缀），否则 Ollama 报 model not found。
    let model = ollama_model_name(&model).to_string();

    let ollama_req = build_ollama_body(
        &model,
        req.system.as_deref(),
        &req.messages,
        true,
        params_to_options(&clamp_params(&req)),
    );

    let client = reqwest::Client::new();
    let res = client.post(ollama_chat_url()).json(&ollama_req).send().await;

    match res {
        Ok(resp) => {
            if !resp.status().is_success() {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                return ndjson_response(StreamState::SingleError(format!(
                    "Ollama error ({}): {}",
                    status, text
                )));
            }
            let stream: OllamaByteStream = Box::pin(resp.bytes_stream());
            ndjson_response(StreamState::Streaming {
                stream,
                leftover: Vec::new(),
            })
        }
        Err(e) => ndjson_response(StreamState::SingleError(format!(
            "无法连接 Ollama：{}。请确认 Ollama 已启动且模型已加载。",
            e
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handlers::chat::ChatMessage;
    use proptest::prelude::*;
    fn msg(role: &str, content: &str) -> ChatMessage {
        ChatMessage {
            role: role.to_string(),
            content: content.to_string(),
        }
    }

    /// 用一致的「保留 leftover」语义重构 split_lines 的逆：lines + rest 还原原文。
    fn reconstruct(lines: &[String], rest: &str) -> String {
        if lines.is_empty() {
            rest.to_string()
        } else {
            let mut r = lines.join("\n");
            r.push('\n');
            r.push_str(rest);
            r
        }
    }

    // ---------- 单元测试：核心纯函数 ----------

    #[test]
    fn split_lines_basic() {
        let (lines, rest) = split_lines("a\nb\nc");
        assert_eq!(lines, vec!["a", "b"]);
        assert_eq!(rest, "c");
    }

    #[test]
    fn split_lines_trailing_newline() {
        let (lines, rest) = split_lines("a\nb\n");
        assert_eq!(lines, vec!["a", "b"]);
        assert_eq!(rest, "");
    }

    #[test]
    fn split_lines_no_newline() {
        let (lines, rest) = split_lines("abc");
        assert!(lines.is_empty());
        assert_eq!(rest, "abc");
    }

    #[test]
    fn parse_ollama_line_valid() {
        let line = r#"{"message":{"content":"你好"},"done":false}"#;
        let parsed = parse_ollama_line(line);
        assert_eq!(parsed.delta, "你好");
        assert!(!parsed.done);
    }

    #[test]
    fn parse_ollama_line_done() {
        let parsed = parse_ollama_line(r#"{"message":{"content":""},"done":true}"#);
        assert!(parsed.done);
        assert_eq!(parsed.delta, "");
    }

    #[test]
    fn parse_ollama_line_missing_done_defaults_false() {
        let parsed = parse_ollama_line(r#"{"message":{"content":"x"}}"#);
        assert_eq!(parsed.delta, "x");
        assert!(!parsed.done);
    }

    #[test]
    fn parse_ollama_line_non_json_is_empty() {
        let parsed = parse_ollama_line("这不是 JSON {{{");
        assert_eq!(parsed.delta, "");
        assert!(!parsed.done);
    }

    #[test]
    fn parse_ollama_line_empty_is_empty() {
        let parsed = parse_ollama_line("   ");
        assert_eq!(parsed.delta, "");
        assert!(!parsed.done);
    }

    #[test]
    fn stream_chunk_done_serialization() {
        let line = serde_json::to_string(&StreamChunk::done()).unwrap();
        assert_eq!(line, r#"{"done":true}"#);
    }

    #[test]
    fn stream_chunk_delta_serialization() {
        let line = serde_json::to_string(&StreamChunk::delta("hi")).unwrap();
        assert_eq!(line, r#"{"delta":"hi"}"#);
    }

    #[test]
    fn stream_chunk_error_serialization() {
        let line = serde_json::to_string(&StreamChunk::error("oops")).unwrap();
        assert_eq!(line, r#"{"error":"oops"}"#);
    }

    #[test]
    fn parse_ollama_line_handles_escaped_content() {
        // 含引号、反斜杠、换行的内容需经 JSON 转义后仍能 round-trip。
        let content = "line1\n\"quoted\"\\tail";
        let line = serde_json::json!({"message": {"content": content}, "done": false}).to_string();
        let parsed = parse_ollama_line(&line);
        assert_eq!(parsed.delta, content);
    }

    #[test]
    fn build_ollama_messages_without_system() {
        let msgs = vec![msg("user", "hi"), msg("assistant", "yo")];
        let built = build_ollama_messages(None, &msgs);
        assert_eq!(built.len(), 2);
        assert_eq!(built[0]["role"], "user");
        assert_eq!(built[1]["content"], "yo");
    }

    #[test]
    fn build_ollama_messages_with_system_prefix() {
        let msgs = vec![msg("user", "hi")];
        let built = build_ollama_messages(Some("你是女娲"), &msgs);
        assert_eq!(built.len(), 2);
        assert_eq!(built[0]["role"], "system");
        assert_eq!(built[0]["content"], "你是女娲");
        assert_eq!(built[1]["role"], "user");
    }

    // ---------- 属性测试 ----------

    // Feature: streaming-chat-output, Property 1: NDJSON 分帧 round-trip 与切分无关性（confluence）
    // Validates: Requirements 1.4, 1.5, 2.2
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(200))]

        #[test]
        fn prop_split_lines_confluence(
            text in "[a-c\n]{0,60}",
            chunk_sizes in proptest::collection::vec(1usize..=6, 0..30),
        ) {
            // 一次性分帧
            let (lines_once_raw, rest_once_raw) = split_lines(&text);
            let lines_once: Vec<String> = lines_once_raw.iter().map(|s| s.to_string()).collect();
            let rest_once = rest_once_raw.to_string();

            // 增量喂入（保留 leftover）
            let chars: Vec<char> = text.chars().collect();
            let mut collected: Vec<String> = Vec::new();
            let mut leftover = String::new();
            let mut idx = 0usize;
            let mut sizes = chunk_sizes.into_iter();
            while idx < chars.len() {
                let size = sizes.next().unwrap_or(chars.len() - idx).max(1);
                let end = (idx + size).min(chars.len());
                let piece: String = chars[idx..end].iter().collect();
                idx = end;
                leftover.push_str(&piece);
                let (lines, rest) = split_lines(&leftover);
                for l in &lines {
                    collected.push(l.to_string());
                }
                leftover = rest.to_string();
            }

            // confluence：增量结果 == 一次性结果
            prop_assert_eq!(&collected, &lines_once);
            prop_assert_eq!(&leftover, &rest_once);

            // round-trip：lines + rest 重构原文
            prop_assert_eq!(reconstruct(&lines_once, &rest_once), text);
        }
    }

    // Feature: streaming-chat-output, Property 2: Stream_Chunk 协议序列化/解析 round-trip
    // Validates: Requirements 1.4, 6.1
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(200))]

        #[test]
        fn prop_stream_chunk_delta_mutual_exclusive(s in ".*") {
            let v: serde_json::Value =
                serde_json::from_str(&serde_json::to_string(&StreamChunk::delta(s.clone())).unwrap())
                    .unwrap();
            prop_assert_eq!(v.get("delta").and_then(|d| d.as_str()), Some(s.as_str()));
            prop_assert!(v.get("done").is_none());
            prop_assert!(v.get("error").is_none());
        }

        #[test]
        fn prop_stream_chunk_error_mutual_exclusive(s in ".*") {
            let v: serde_json::Value =
                serde_json::from_str(&serde_json::to_string(&StreamChunk::error(s.clone())).unwrap())
                    .unwrap();
            prop_assert_eq!(v.get("error").and_then(|d| d.as_str()), Some(s.as_str()));
            prop_assert!(v.get("delta").is_none());
            prop_assert!(v.get("done").is_none());
        }

        // parse_ollama_line 对任意 (content, done) 的 Ollama 行 round-trip
        #[test]
        fn prop_parse_ollama_line_roundtrip(content in ".*", done in any::<bool>()) {
            let line = serde_json::json!({
                "message": { "content": content },
                "done": done,
            })
            .to_string();
            let parsed = parse_ollama_line(&line);
            prop_assert_eq!(parsed.delta, content);
            prop_assert_eq!(parsed.done, done);
        }
    }

    // Feature: streaming-chat-output, Property 5: System_Prompt 前置构造不变式
    // Validates: Requirements 1.3
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(200))]

        #[test]
        fn prop_build_ollama_messages_system_prefix(
            system in proptest::option::of(".*"),
            model in ".*",
            raw in proptest::collection::vec((".*", ".*"), 0..10),
        ) {
            let msgs: Vec<ChatMessage> = raw.iter().map(|(r, c)| msg(r, c)).collect();

            // 改用新签名（stream=true、无 options）；断言流式行为不变且不含 options 键。
            let body = build_ollama_body(&model, system.as_deref(), &msgs, true, None);

            // 外层不变式
            prop_assert_eq!(body["stream"].as_bool(), Some(true));
            prop_assert_eq!(body["model"].as_str(), Some(model.as_str()));
            prop_assert!(body.get("options").is_none());

            let built = body["messages"].as_array().unwrap();
            let offset = if system.is_some() { 1 } else { 0 };
            prop_assert_eq!(built.len(), msgs.len() + offset);

            if let Some(sys) = &system {
                prop_assert_eq!(built[0]["role"].as_str(), Some("system"));
                prop_assert_eq!(built[0]["content"].as_str(), Some(sys.as_str()));
            }

            // 其余顺序不变
            for (i, m) in msgs.iter().enumerate() {
                prop_assert_eq!(built[i + offset]["role"].as_str(), Some(m.role.as_str()));
                prop_assert_eq!(built[i + offset]["content"].as_str(), Some(m.content.as_str()));
            }
        }
    }
}
