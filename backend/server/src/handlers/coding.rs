// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

//! 本机 Claude Code / Cursor Agent HTTP handlers.

use axum::{
    body::Body,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use futures::StreamExt;
use serde::Deserialize;
use serde_json::json;

use crate::services::coding_cli::{
    self, CodingProvider, CodingStreamRequest,
};

fn err_json(status: StatusCode, msg: impl Into<String>) -> Response {
    (status, Json(json!({ "error": msg.into() }))).into_response()
}

fn sse_from_stream(
    stream: tokio_stream::wrappers::ReceiverStream<Result<Vec<u8>, std::io::Error>>,
) -> Response {
    let body = Body::from_stream(stream.map(|item| item));
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(body)
        .unwrap_or_else(|e| {
            err_json(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("构建流响应失败: {e}"),
            )
        })
}

pub async fn claude_status() -> Response {
    let s = coding_cli::status(CodingProvider::ClaudeCode).await;
    (StatusCode::OK, Json(s)).into_response()
}

pub async fn cursor_status() -> Response {
    let s = coding_cli::status(CodingProvider::CursorAgent).await;
    (StatusCode::OK, Json(s)).into_response()
}

#[derive(Debug, Deserialize)]
pub struct ApiKeyBody {
    pub api_key: String,
}

pub async fn cursor_set_key(Json(body): Json<ApiKeyBody>) -> Response {
    match coding_cli::save_cursor_api_key(&body.api_key) {
        Ok(()) => (StatusCode::OK, Json(json!({ "ok": true }))).into_response(),
        Err(e) => err_json(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

pub async fn claude_set_key(Json(body): Json<ApiKeyBody>) -> Response {
    match coding_cli::save_anthropic_api_key(&body.api_key) {
        Ok(()) => (StatusCode::OK, Json(json!({ "ok": true }))).into_response(),
        Err(e) => err_json(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

pub async fn claude_stream(Json(req): Json<CodingStreamRequest>) -> Response {
    match coding_cli::stream_sse(CodingProvider::ClaudeCode, req).await {
        Ok(stream) => sse_from_stream(stream),
        Err(e) => err_json(StatusCode::BAD_GATEWAY, e),
    }
}

pub async fn cursor_stream(Json(req): Json<CodingStreamRequest>) -> Response {
    match coding_cli::stream_sse(CodingProvider::CursorAgent, req).await {
        Ok(stream) => sse_from_stream(stream),
        Err(e) => err_json(StatusCode::BAD_GATEWAY, e),
    }
}
