// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

//! 集成测试：流式对话接口 `POST /api/chat/stream`（Stream_Endpoint）。
//!
//! 通过临时端口启动真实 axum 服务（被测服务），并按需启动一个临时 **mock Ollama**
//! 服务，借助环境变量 `OLLAMA_CHAT_URL` 把流式后端指向不同目标，从而**确定性地**
//! 覆盖以下验收标准（无需真实 Ollama）：
//!   - AC 1.1：合法请求 → 200 + `Content-Type: application/x-ndjson`，正常下发 delta/done 块
//!   - AC 1.6：Ollama 不可达（死端口）→ 流内单个 error chunk，含友好文案
//!   - AC 1.7：Ollama 非成功状态码（mock 返回 500）→ error chunk 并结束流
//!   - AC 1.8 / 7.1：既有 `POST /api/chat` 契约保持（错误返回 `{error}`，或成功 `{role,content,model,done}`）
//!
//! 注意：`chat_stream` 通过 `OLLAMA_CHAT_URL` 选择上游地址，而该 env 为进程级全局变量。
//! 为避免并行测试间相互污染，所有依赖该 env 的流式场景集中在**单个**测试函数内顺序执行。

use std::sync::Arc;

use axum::{body::Body, http::StatusCode, response::Response, routing::post, Router};
use tokio::sync::RwLock;

use nuwa_server::handlers::chat_stream::{
    build_ollama_messages, parse_ollama_line, split_lines, StreamChunk,
};
use nuwa_server::routes;
use nuwa_server::state::AppState;

/// 启动被测服务（真实路由 + 默认 AppState），返回基础 URL（如 `http://127.0.0.1:54321`）。
async fn spawn_server() -> String {
    let state = Arc::new(RwLock::new(AppState::default()));
    let app = routes::create_router().with_state(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{}", addr)
}

/// 启动一个临时 mock Ollama 服务：对 `POST /api/chat` 始终返回固定 `status` 与 `body`。
/// 返回其 `/api/chat` 端点的完整 URL，供 `OLLAMA_CHAT_URL` 指向。
async fn spawn_mock_ollama(status: StatusCode, body: &'static str) -> String {
    let app = Router::new().route(
        "/api/chat",
        post(move || async move {
            Response::builder()
                .status(status)
                .header("content-type", "application/x-ndjson")
                .body(Body::from(body))
                .unwrap()
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{}/api/chat", addr)
}

/// 收集流式响应正文中的非空 JSON 行。
fn nonempty_lines(text: &str) -> Vec<serde_json::Value> {
    text.lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str::<serde_json::Value>(l).expect("每行须为合法 JSON"))
        .collect()
}

/// AC 1.1 / 1.6 / 1.7：所有依赖 `OLLAMA_CHAT_URL` 的流式场景，集中顺序执行以避免 env 竞争。
#[tokio::test]
async fn stream_endpoint_ndjson_paths() {
    let base = spawn_server().await;
    let client = reqwest::Client::new();

    // ---------- AC 1.1：成功路径（mock 返回 200 + 合法 NDJSON 流） ----------
    let ndjson = "{\"message\":{\"content\":\"你好\"},\"done\":false}\n\
                  {\"message\":{\"content\":\"，我是女娲\"},\"done\":false}\n\
                  {\"done\":true}\n";
    let mock = spawn_mock_ollama(StatusCode::OK, ndjson).await;
    std::env::set_var("OLLAMA_CHAT_URL", &mock);

    let resp = client
        .post(format!("{}/api/chat/stream", base))
        .json(&serde_json::json!({
            "messages": [{"role": "user", "content": "你好"}],
            "system": "你是女娲",
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), reqwest::StatusCode::OK, "AC 1.1：应返回 200");
    let ct = resp
        .headers()
        .get("content-type")
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    assert_eq!(
        ct, "application/x-ndjson",
        "AC 1.1：Content-Type 须为 NDJSON"
    );

    let text = resp.text().await.unwrap();
    let chunks = nonempty_lines(&text);
    // 增量拼接应还原完整文本，且最后为 done 块。
    let combined: String = chunks
        .iter()
        .filter_map(|c| c.get("delta").and_then(|d| d.as_str()))
        .collect();
    assert_eq!(
        combined, "你好，我是女娲",
        "AC 1.1：delta 顺序拼接应还原全文"
    );
    assert!(
        chunks
            .last()
            .and_then(|c| c.get("done"))
            .and_then(|d| d.as_bool())
            == Some(true),
        "AC 1.1：末块应为 done:true，实际: {:?}",
        chunks
    );

    // ---------- AC 1.6：Ollama 不可达（死端口）→ 单个 error chunk + 友好文案 ----------
    std::env::set_var("OLLAMA_CHAT_URL", "http://127.0.0.1:1/api/chat");

    let resp = client
        .post(format!("{}/api/chat/stream", base))
        .json(&serde_json::json!({
            "messages": [{"role": "user", "content": "你好"}],
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(
        resp.status(),
        reqwest::StatusCode::OK,
        "AC 1.6：仍为 200（错误以流内块表达）"
    );
    assert_eq!(
        resp.headers()
            .get("content-type")
            .unwrap()
            .to_str()
            .unwrap(),
        "application/x-ndjson"
    );
    let text = resp.text().await.unwrap();
    let chunks = nonempty_lines(&text);
    assert_eq!(
        chunks.len(),
        1,
        "AC 1.6：应只有一个 error chunk，实际: {:?}",
        chunks
    );
    let err = chunks[0]
        .get("error")
        .and_then(|e| e.as_str())
        .expect("AC 1.6：应含 error 字段");
    assert!(
        err.contains("Ollama"),
        "AC 1.6：错误文案应提到 Ollama: {}",
        err
    );
    assert!(
        err.contains("启动") || err.contains("加载"),
        "AC 1.6：错误文案应为友好提示: {}",
        err
    );
    // 互斥：不应含 delta / done
    assert!(chunks[0].get("delta").is_none());
    assert!(chunks[0].get("done").is_none());

    // ---------- AC 1.7：Ollama 非成功状态码（mock 返回 500）→ error chunk 并结束流 ----------
    let mock_err = spawn_mock_ollama(StatusCode::INTERNAL_SERVER_ERROR, "model not found").await;
    std::env::set_var("OLLAMA_CHAT_URL", &mock_err);

    let resp = client
        .post(format!("{}/api/chat/stream", base))
        .json(&serde_json::json!({
            "messages": [{"role": "user", "content": "你好"}],
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(
        resp.status(),
        reqwest::StatusCode::OK,
        "AC 1.7：仍为 200（错误以流内块表达）"
    );
    let text = resp.text().await.unwrap();
    let chunks = nonempty_lines(&text);
    assert_eq!(
        chunks.len(),
        1,
        "AC 1.7：应只有一个 error chunk，实际: {:?}",
        chunks
    );
    let err = chunks[0]
        .get("error")
        .and_then(|e| e.as_str())
        .expect("AC 1.7：应含 error 字段");
    assert!(
        err.contains("500") || err.to_lowercase().contains("error"),
        "AC 1.7：错误文案应体现上游非成功状态: {}",
        err
    );
    assert!(chunks[0].get("delta").is_none());
    assert!(chunks[0].get("done").is_none());

    // 清理 env，避免影响其他测试。
    std::env::remove_var("OLLAMA_CHAT_URL");
}

/// AC 1.8 / 7.1：既有 `POST /api/chat` 契约保持不变。
/// 非流式 `chat` 使用固定 OLLAMA_URL（不受 OLLAMA_CHAT_URL 影响）：
/// 本机 Ollama 未运行 → `{error}`；运行 → `{role,content,model,done}`。两者皆为合法 JSON 对象。
#[tokio::test]
async fn chat_endpoint_contract_preserved() {
    let base = spawn_server().await;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/api/chat", base))
        .json(&serde_json::json!({
            "messages": [{"role": "user", "content": "你好"}],
        }))
        .send()
        .await
        .unwrap();

    let text = resp.text().await.unwrap();
    let v: serde_json::Value = serde_json::from_str(&text).expect("响应应为合法 JSON");
    assert!(v.is_object(), "响应应为 JSON 对象");
    let is_error = v.get("error").is_some();
    let is_success = v.get("role").is_some()
        && v.get("content").is_some()
        && v.get("model").is_some()
        && v.get("done").is_some();
    assert!(
        is_error || is_success,
        "响应须符合既有 chat 契约，实际: {}",
        text
    );
}

/// 纯函数经库公开 API 可用（split_lines / parse_ollama_line / StreamChunk / build_ollama_messages）。
#[test]
fn pure_functions_exposed_via_lib() {
    // split_lines
    let (lines, rest) = split_lines("a\nb\nc");
    assert_eq!(lines, vec!["a", "b"]);
    assert_eq!(rest, "c");

    // parse_ollama_line
    let parsed = parse_ollama_line(r#"{"message":{"content":"hi"},"done":true}"#);
    assert_eq!(parsed.delta, "hi");
    assert!(parsed.done);

    // StreamChunk 序列化
    let line = serde_json::to_string(&StreamChunk::delta("x")).unwrap();
    assert_eq!(line, r#"{"delta":"x"}"#);

    // build_ollama_messages：system 前置时长度 +1
    let built = build_ollama_messages(Some("sys"), &[]);
    assert_eq!(built.len(), 1);
    assert_eq!(built[0]["role"], "system");
}
