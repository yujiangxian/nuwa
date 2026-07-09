// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

use axum::{extract::State, Json};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::config_persist;
use crate::state::{AppConfig, AppState};

pub async fn get_config(State(state): State<Arc<RwLock<AppState>>>) -> Json<AppConfig> {
    let state = state.read().await;
    Json(state.config.clone())
}

pub async fn update_config(
    State(state): State<Arc<RwLock<AppState>>>,
    Json(new_config): Json<AppConfig>,
) -> Result<Json<AppConfig>, Json<serde_json::Value>> {
    let mut state = state.write().await;
    let old_config = state.config.clone();
    state.config = new_config.clone();

    // 持久化到文件
    if let Err(e) = config_persist::save_config(&state.config) {
        // 回滚内存状态
        state.config = old_config;
        return Err(Json(serde_json::json!({
            "error": format!("保存配置失败: {}", e)
        })));
    }

    Ok(Json(new_config))
}

#[derive(serde::Deserialize)]
pub struct SetModelRequest {
    pub model_type: String,
    pub model_id: String,
}

/// 增量设置当前模型（避免并发覆盖）
pub async fn set_model(
    State(state): State<Arc<RwLock<AppState>>>,
    Json(req): Json<SetModelRequest>,
) -> Result<Json<AppConfig>, Json<serde_json::Value>> {
    let mut state = state.write().await;
    let old_config = state.config.clone();

    // Validate model_type against known set
    const VALID_MODEL_TYPES: &[&str] = &["llm", "asr", "tts"];

    if !VALID_MODEL_TYPES.contains(&req.model_type.as_str()) {
        return Err(Json(serde_json::json!({
            "error": format!("不支持的模型类型: {}，有效值: {:?}", req.model_type, VALID_MODEL_TYPES)
        })));
    }

    // 更新 current_models HashMap
    state
        .config
        .current_models
        .insert(req.model_type.clone(), req.model_id.clone());

    // 同步到旧字段（向后兼容）
    match req.model_type.as_str() {
        "llm" => state.config.current_llm_model = Some(req.model_id.clone()),
        "asr" => state.config.current_asr_model = Some(req.model_id.clone()),
        "tts" => state.config.current_tts_model = Some(req.model_id.clone()),
        _ => {}
    }

    // 持久化
    if let Err(e) = config_persist::save_config(&state.config) {
        // 回滚内存状态
        state.config = old_config;
        return Err(Json(serde_json::json!({
            "error": format!("保存配置失败: {}", e)
        })));
    }

    Ok(Json(state.config.clone()))
}
