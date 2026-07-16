// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

pub mod agents;
pub mod audio;
pub mod chat;
pub mod chat_stream;
pub mod coding;
pub mod config;
pub mod download;
pub mod inference;
pub mod models;
pub mod sse;
pub mod system;
pub mod voices;
pub mod xai;

use axum::Json;
use serde_json::json;

/// Health check endpoint.
///
/// When `?detailed=1` is passed, also probes Ollama connectivity and returns
/// per-dependency status suitable for Kubernetes liveness/readiness probes.
pub async fn health(
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Json<serde_json::Value> {
    let detailed = params.get("detailed").map(|v| v == "1").unwrap_or(false);
    if !detailed {
        return Json(json!({ "status": "ok" }));
    }

    let mut checks = serde_json::Map::new();

    // Ollama connectivity
    let ollama_ok = matches!(
        reqwest::Client::new()
            .head(crate::constants::ollama_tags_url())
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await,
        Ok(resp) if resp.status().is_success()
    );
    checks.insert(
        "ollama".into(),
        json!(if ollama_ok { "ok" } else { "unreachable" }),
    );

    // Disk space check (output directory)
    let output_dir = crate::util::project_root().join("output");
    let disk_ok = match tokio::fs::metadata(&output_dir).await {
        Ok(_) => true,
        Err(_) => {
            // Try to create it
            tokio::fs::create_dir_all(&output_dir).await.is_ok()
        }
    };
    checks.insert(
        "output_dir".into(),
        json!(if disk_ok { "ok" } else { "error" }),
    );

    let all_healthy = ollama_ok && disk_ok;
    Json(json!({
        "status": if all_healthy { "healthy" } else { "degraded" },
        "checks": checks,
    }))
}
