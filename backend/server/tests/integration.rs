// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

//! Integration tests for nuwa-server REST endpoints.
//!
//! Uses the `oneshot` pattern to send synthetic requests to the Axum router
//! without binding a real TCP port.  This is fast, deterministic, and works
//! for endpoints that do not depend on external services (Ollama, disk IO, etc.).
//!
//! Endpoints that talk to Ollama (POST /api/chat) are tested only for request
//! validation — the actual HTTP round-trip to `localhost:11434` is skipped.
//! Full chat tests require a running Ollama instance.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use std::sync::Arc;
use tokio::sync::RwLock;
use tower::ServiceExt;

use nuwa_server::routes;
use nuwa_server::state::AppState;

// ── helpers ────────────────────────────────────────────────────────────

/// Build a fresh Axum app with a default (empty) AppState.
async fn app() -> axum::Router {
    let state = Arc::new(RwLock::new(AppState::default()));
    routes::create_router().with_state(state)
}

/// Send a request to the router and collect the full response body as bytes.
async fn body_of(response: axum::response::Response) -> Vec<u8> {
    let body = axum::body::to_bytes(response.into_body(), 10 * 1024 * 1024)
        .await
        .unwrap();
    body.to_vec()
}

/// Convenience: send a GET and return (status, body-bytes).
async fn get(uri: &str) -> (StatusCode, Vec<u8>) {
    let resp = app()
        .await
        .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = resp.status();
    let body = body_of(resp).await;
    (status, body)
}

/// Convenience: send a POST with a JSON body and return (status, body-bytes).
async fn post_json(uri: &str, json: serde_json::Value) -> (StatusCode, Vec<u8>) {
    let body_str = serde_json::to_string(&json).unwrap();
    let resp = app()
        .await
        .oneshot(
            Request::builder()
                .uri(uri)
                .method("POST")
                .header("content-type", "application/json")
                .body(Body::from(body_str))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let body = body_of(resp).await;
    (status, body)
}

// ── 1. Health check ────────────────────────────────────────────────────

#[tokio::test]
async fn health_returns_200_with_status_ok() {
    let (status, body) = get("/health").await;
    assert_eq!(status, StatusCode::OK);
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["status"], "ok");
}

#[tokio::test]
async fn health_with_detailed_probes_ollama_and_disk() {
    let (status, body) = get("/health?detailed=1").await;
    assert_eq!(status, StatusCode::OK);
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    // detailed mode always returns a "status" key
    assert!(v["status"].is_string());
    // checks object with at least "ollama" and "output_dir"
    assert!(v["checks"].is_object());
    assert!(v["checks"]["ollama"].is_string());
    assert!(v["checks"]["output_dir"].is_string());
}

// ── 2. Agent list ──────────────────────────────────────────────────────

#[tokio::test]
async fn agents_list_returns_registry() {
    let (status, body) = get("/api/agents").await;
    assert_eq!(status, StatusCode::OK);
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(v.is_object());
    // Registry shape: { agents: [...], pipelines: [...] }
    assert!(v["agents"].is_array(), "missing 'agents' array");
    assert!(v["pipelines"].is_array(), "missing 'pipelines' array");

    // Spot-check: the "text_chat_stream" pipeline must be present.
    let pipelines = v["pipelines"].as_array().unwrap();
    let tcs = pipelines
        .iter()
        .find(|p| p["id"] == "text_chat_stream")
        .expect("text_chat_stream pipeline must exist");
    assert_eq!(tcs["name"], "文本对话（流式）");
}

// ── 3. Config ──────────────────────────────────────────────────────────

#[tokio::test]
async fn config_get_returns_default_config() {
    let (status, body) = get("/api/config").await;
    assert_eq!(status, StatusCode::OK);
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(v.is_object());
    // Every config always has "current_models" (a HashMap, serialised as object).
    assert!(v["current_models"].is_object(), "missing 'current_models'");
}

// ── 4. Models list ─────────────────────────────────────────────────────

#[tokio::test]
async fn models_list_returns_array() {
    let (status, body) = get("/api/models").await;
    assert_eq!(status, StatusCode::OK);
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(v.is_array(), "expected a JSON array of models");
}

// ── 5. Voices list ─────────────────────────────────────────────────────

#[tokio::test]
async fn voices_list_returns_array() {
    let (status, body) = get("/api/voices").await;
    assert_eq!(status, StatusCode::OK);
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(v.is_array(), "expected a JSON array of voices");
}

// ── 6 & 7. Chat endpoint contract / validation ─────────────────────────
//
// The chat handler forwards every request to `localhost:11434/api/chat`
// (hard-coded OLLAMA_URL).  Without Ollama running, it returns a
// connection-refused error wrapped in `{ error: "..." }`.
// We can still verify:
//   (a) The response is always well-formed JSON with either an "error" key or
//       the success shape { role, content, model, done }.
//   (b) A request with an empty JSON body (no "messages" field) produces a
//       deserialization error from the server — NOT a connection error —
//       because the handler never reaches the Ollama call.

#[tokio::test]
async fn chat_with_valid_body_returns_well_formed_response() {
    // With a valid ChatRequest body, the handler will attempt the Ollama
    // call.  Since Ollama is not running, the response is expected to be an
    // error JSON.  The key contract: the response is valid JSON and matches
    // either the success shape or the error shape.
    let body = serde_json::json!({
        "messages": [{"role": "user", "content": "Hello"}]
    });
    let (_status, body_bytes) = post_json("/api/chat", body).await;

    let v: serde_json::Value = serde_json::from_slice(&body_bytes)
        .expect("response must be valid JSON");

    let has_error = v.get("error").is_some();
    let has_success_shape = v.get("role").is_some()
        && v.get("content").is_some()
        && v.get("model").is_some()
        && v.get("done").is_some();

    assert!(
        has_error || has_success_shape,
        "chat response must have either 'error' or success fields (role/content/model/done), got: {}",
        String::from_utf8_lossy(&body_bytes)
    );
}

#[tokio::test]
async fn chat_with_empty_body_deserializes_to_error() {
    // Sending `{}` as the POST body — the "messages" field is missing.
    // The handler uses `Json<ChatRequest>` extraction.  Because `messages`
    // has no `#[serde(default)]`, a missing "messages" key causes a
    // deserialization failure in the extractor.  Axum rejects before the
    // handler body runs, so no Ollama call is made — this test works
    // deterministically without any external dependency.
    let (status, body_bytes) = post_json("/api/chat", serde_json::json!({})).await;

    // Axum 0.8 returns 422 Unprocessable Entity for Json extraction failures
    // (the body may be empty, plain text, or a JSON error — it varies).
    assert!(
        status.is_client_error(),
        "expected 4xx for missing 'messages' field, got {}",
        status
    );

    let body_str = String::from_utf8_lossy(&body_bytes);
    // The body is either empty or contains a client-error message from Axum.
    // In any case it must NOT look like a successful chat response.
    let has_role = body_str.contains("\"role\"");
    assert!(
        !has_role,
        "should not get a success chat response for an empty body, got: {}",
        body_str
    );
}
