use axum::{
    routing::{get, post},
    Router,
};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::handlers;
use crate::state::AppState;

pub fn create_router() -> Router<Arc<RwLock<AppState>>> {
    Router::new()
        // 健康检查
        .route("/health", get(handlers::health))
        // 对话
        .route("/api/chat", post(handlers::chat::chat))
        .route("/api/chat/stream", post(handlers::chat_stream::chat_stream))
        // 配置管理
        .route("/api/config", get(handlers::config::get_config))
        .route("/api/config", post(handlers::config::update_config))
        .route("/api/config/set-model", post(handlers::config::set_model))
        // 模型管理
        .route("/api/models", get(handlers::models::list_models))
        .route("/api/models/scan", post(handlers::models::scan_models))
        .route("/api/models/scan-progress", get(handlers::models::get_scan_progress))
        .route("/api/models/{id}", axum::routing::delete(handlers::models::delete_model))
        .route("/api/models/{id}/meta", get(handlers::models::get_model_meta))
        .route("/api/models/{id}/meta", post(handlers::models::update_model_meta))
        .route("/api/models/{id}/files", get(handlers::models::get_model_files))
        // 系统信息
        .route("/api/system/disk", get(handlers::system::get_disk_info))
        .route("/api/system/gpu", get(handlers::system::get_gpu_info))
        .route("/api/system/cleanup", post(handlers::system::cleanup))
        // 参考音频
        .route("/api/voices", get(handlers::voices::list_voices))
        .route("/api/voices", post(handlers::voices::add_voice))
        .route("/api/voices/upload", post(handlers::voices::upload_voice))
        .route("/api/voices/{id}/audio", get(handlers::voices::serve_voice_audio))
        .route("/api/voices/{id}", axum::routing::delete(handlers::voices::delete_voice))
        // 推理服务
        .route("/api/inference/asr", post(handlers::inference::transcribe))
        .route("/api/inference/asr/upload", post(handlers::inference::transcribe_upload))
        .route("/api/inference/tts", post(handlers::inference::synthesize))
        .route("/api/inference/tts/script", post(handlers::inference::synthesize_script))
        // 音频文件服务
        .route("/api/audio/{id}", get(handlers::audio::serve_audio))
        // 下载管理
        .route("/api/downloads/presets", get(handlers::download::list_presets))
        .route("/api/downloads/presets/refresh", post(handlers::download::refresh_presets))
        .route("/api/downloads/repo-files", get(handlers::download::list_repo_files))
        .route("/api/downloads/batch", post(handlers::download::start_batch_download))
        .route("/api/downloads", post(handlers::download::start_download))
        .route("/api/downloads", get(handlers::download::list_downloads))
        .route("/api/downloads/{id}", get(handlers::download::get_download_status))
        .route("/api/downloads/{id}/cancel", post(handlers::download::cancel_download))
        .route("/api/downloads/{id}/retry", post(handlers::download::retry_download))
        .route("/api/downloads/{id}", axum::routing::delete(handlers::download::delete_download))
        // Agent 调度器
        .route("/api/agents", get(handlers::agents::list_agents))
        .route("/api/agents/run", post(handlers::agents::run_pipeline))
        .route("/api/agents/run-stream", post(handlers::agents::run_pipeline_stream))
        .route("/api/agents/tasks/{id}", get(handlers::agents::get_task))
        .route("/api/agents/tasks/{id}/events", get(handlers::agents::task_events))
        // SSE 进度推送
        .route("/api/sse/progress", get(handlers::sse::progress_stream))
}
