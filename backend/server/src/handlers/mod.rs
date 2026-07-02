pub mod agents;
pub mod audio;
pub mod chat;
pub mod chat_stream;
pub mod config;
pub mod download;
pub mod inference;
pub mod models;
pub mod sse;
pub mod system;
pub mod voices;

use axum::Json;
use serde_json::json;

pub async fn health() -> Json<serde_json::Value> {
    Json(json!({ "status": "ok" }))
}
