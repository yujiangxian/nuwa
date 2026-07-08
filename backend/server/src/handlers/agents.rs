/// Agent 调度器 HTTP 端点。
use axum::{
    extract::{Path, State},
    Json,
};
use axum::response::sse::{Event, KeepAlive, Sse};
use futures::Stream;
use std::convert::Infallible;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt as _;

use crate::services::agent_scheduler::{self, scheduler, RunRequest};
use crate::state::AppState;

/// GET /api/agents — 列出所有可用能力和流水线
pub async fn list_agents() -> Json<serde_json::Value> {
    let registry = scheduler().registry();
    Json(serde_json::to_value(registry).unwrap_or_default())
}

/// POST /api/agents/run — 执行一个流水线
pub async fn run_pipeline(
    State(state): State<Arc<RwLock<AppState>>>,
    Json(req): Json<RunRequest>,
) -> Json<serde_json::Value> {
    // 获取项目根目录用于 output/ 路径
    let project_root = std::env::current_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    drop(state); // 释放锁

    match scheduler().submit(req, &project_root).await {
        Ok(task_id) => Json(serde_json::json!({
            "success": true,
            "task_id": task_id,
        })),
        Err(e) => Json(serde_json::json!({
            "success": false,
            "error": e,
        })),
    }
}

/// POST /api/agents/run-stream — 执行一个流式流水线（LLM deltas 通过 SSE 实时推送）
pub async fn run_pipeline_stream(
    State(state): State<Arc<RwLock<AppState>>>,
    Json(req): Json<RunRequest>,
) -> Json<serde_json::Value> {
    let project_root = std::env::current_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    drop(state);

    match scheduler().submit_stream(req, &project_root).await {
        Ok(task_id) => Json(serde_json::json!({
            "success": true,
            "task_id": task_id,
        })),
        Err(e) => Json(serde_json::json!({
            "success": false,
            "error": e,
        })),
    }
}

/// GET /api/agents/tasks/:id — 查询任务状态
pub async fn get_task(Path(task_id): Path<String>) -> Json<serde_json::Value> {
    let sched = scheduler();
    let tasks = sched.tasks.read().await;
    match tasks.get(&task_id) {
        Some(task) => Json(serde_json::to_value(task).unwrap_or_default()),
        None => Json(serde_json::json!({ "error": "任务不存在" })),
    }
}

/// GET /api/agents/tasks/:id/events — SSE 进度推送
pub async fn task_events(
    Path(task_id): Path<String>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let sched = scheduler();
    let events = sched.events.read().await;
    let rx = events.get(&task_id).and_then(|tx| {
        // subscribe() returns a new receiver that starts from the next event
        Some(tx.subscribe())
    });

    let stream = async_stream::stream! {
        if let Some(rx) = rx {
            let mut bs = BroadcastStream::new(rx);
            while let Some(Ok(event)) = bs.next().await {
                let data = serde_json::to_string(&event).unwrap_or_default();
                let done = event.status == agent_scheduler::TaskStatus::Completed
                    || event.status == agent_scheduler::TaskStatus::Failed;
                yield Ok(Event::default().data(data));
                if done {
                    break;
                }
            }
        } else {
            yield Ok(Event::default().data(r#"{"error":"任务不存在"}"#));
        }
    };

    Sse::new(stream).keep_alive(KeepAlive::default())
}
