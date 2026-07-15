// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

use axum::{extract::State, Json};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::config_persist;
use crate::services::model_scanner;
use crate::state::{AppState, ScanProgress};
use crate::util::{project_root, safe_join_under};

pub async fn list_models(
    State(state): State<Arc<RwLock<AppState>>>,
) -> Json<Vec<crate::state::ModelInfo>> {
    let state = state.read().await;
    Json(state.models.clone())
}

/// Resolve models_dir from config to an absolute path under the project tree.
fn resolve_models_dir(config_models_dir: &str) -> std::path::PathBuf {
    let p = std::path::PathBuf::from(config_models_dir.trim());
    if p.as_os_str().is_empty() {
        return project_root().join("models");
    }
    if p.is_relative() {
        project_root().join(p)
    } else {
        p
    }
}

/// Ensure a model filesystem path stays under models_dir (blocks absolute path escapes).
fn confine_model_path(
    models_dir: &std::path::Path,
    model_path: &str,
) -> Result<std::path::PathBuf, String> {
    let path = std::path::PathBuf::from(model_path);
    let abs = if path.is_absolute() {
        path
    } else {
        project_root().join(&path)
    };

    std::fs::create_dir_all(models_dir).map_err(|e| format!("无法创建 models 目录: {e}"))?;
    let base = std::fs::canonicalize(models_dir).map_err(|e| format!("无法解析 models 目录: {e}"))?;

    if abs.exists() {
        let canon = std::fs::canonicalize(&abs).map_err(|e| format!("无法解析模型路径: {e}"))?;
        if !canon.starts_with(&base) {
            return Err("模型路径必须位于 models/ 目录内".to_string());
        }
        return Ok(canon);
    }

    // Not on disk yet / already deleted — still reject escapes via safe_join of relative suffix
    if let Ok(rel) = abs.strip_prefix(&base) {
        return safe_join_under(&base, &rel.to_string_lossy());
    }
    if let Ok(rel) = abs.strip_prefix(project_root()) {
        let joined = project_root().join(rel);
        if joined.starts_with(&base) || joined == base {
            return Ok(joined);
        }
    }
    Err("模型路径必须位于 models/ 目录内".to_string())
}

pub async fn scan_models(
    State(state): State<Arc<RwLock<AppState>>>,
) -> Json<Vec<crate::state::ModelInfo>> {
    let models_dir = {
        let state = state.read().await;
        std::path::PathBuf::from(&state.config.models_dir)
    };

    let project_root = project_root();
    let models_dir = if models_dir.is_relative() {
        project_root.join(&models_dir)
    } else {
        models_dir
    };

    // 检查是否已有扫描在进行中，并原子地标记扫描开始
    {
        let mut state = state.write().await;
        if state.scan_progress.is_some() {
            // 已有扫描在进行中，直接返回当前列表
            return Json(state.models.clone());
        }
        state.scan_progress = Some(ScanProgress {
            phase: "scanning".to_string(),
            current_dir: Some(models_dir.to_string_lossy().to_string()),
            total_dirs: 0,
            processed_dirs: 0,
            models_found: 0,
        });
    }

    let state_clone = state.clone();

    // 启动后台异步扫描任务
    tokio::spawn(async move {
        // 使用 finally 模式确保 scan_progress 总是被清除
        let result = async {
            // 本地目录扫描（使用 spawn_blocking 避免阻塞 async runtime）
            let dir_clone = models_dir.clone();
            let mut scanned = match tokio::task::spawn_blocking(move || {
                model_scanner::scan_models_dir(&dir_clone)
            })
            .await
            {
                Ok(result) => result,
                Err(e) => {
                    tracing::error!("扫描线程 panic: {}", e);
                    Vec::new()
                }
            };

            // Ollama 模型扫描（异步 HTTP）
            let ollama_models = model_scanner::scan_ollama_models().await;
            scanned.extend(ollama_models);
            scanned.sort_by(|a, b| a.name.cmp(&b.name));

            let count = scanned.len() as i32;

            // 更新状态
            let mut state = state_clone.write().await;
            state.models = scanned;
            tracing::info!("后台扫描完成，发现 {} 个模型", count);
            Ok::<(), ()>(())
        }
        .await;

        if result.is_err() {
            tracing::error!("扫描任务异常终止");
        }

        // 确保 scan_progress 总是被清除
        let mut state = state_clone.write().await;
        state.scan_progress = None;
    });

    // 立即返回当前模型列表
    let state = state.read().await;
    Json(state.models.clone())
}

pub async fn get_scan_progress(
    State(state): State<Arc<RwLock<AppState>>>,
) -> Json<serde_json::Value> {
    let state = state.read().await;
    let scanning = state.scan_progress.is_some();
    Json(serde_json::json!({
        "scanning": scanning,
        "progress": state.scan_progress,
        "model_count": state.models.len(),
    }))
}

pub async fn delete_model(
    State(state): State<Arc<RwLock<AppState>>>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, Json<serde_json::Value>> {
    let mut state = state.write().await;

    // 找到模型
    let model = state.models.iter().find(|m| m.id == id).cloned();
    let model = match model {
        Some(m) => m,
        None => {
            return Err(Json(serde_json::json!({
                "error": "模型不存在"
            })));
        }
    };

    // Ollama 模型不能通过删除文件删除
    if model.source == "ollama" {
        return Err(Json(serde_json::json!({
            "error": "Ollama 模型请使用 ollama rm 命令删除"
        })));
    }

    // 检查模型是否正在被推理任务使用
    if state.active_inference_models.contains(&id) {
        return Err(Json(serde_json::json!({
            "error": "模型正在被推理任务使用，请先停止相关任务"
        })));
    }

    // 解析模型路径并限制在 models_dir 内
    let models_dir = resolve_models_dir(&state.config.models_dir);
    let path = match confine_model_path(&models_dir, &model.path) {
        Ok(p) => p,
        Err(e) => {
            return Err(Json(serde_json::json!({ "error": e })));
        }
    };

    // 删除目录
    if path.exists() {
        if let Err(e) = tokio::fs::remove_dir_all(&path).await {
            return Err(Json(serde_json::json!({
                "error": format!("删除失败: {}", e)
            })));
        }
    }

    // 如果删除的是当前默认模型，重置配置
    let mut config_changed = false;

    // 从旧字段移除
    if state.config.current_asr_model.as_ref() == Some(&id) {
        state.config.current_asr_model = None;
        config_changed = true;
    }
    if state.config.current_tts_model.as_ref() == Some(&id) {
        state.config.current_tts_model = None;
        config_changed = true;
    }
    if state.config.current_llm_model.as_ref() == Some(&id) {
        state.config.current_llm_model = None;
        config_changed = true;
    }

    // 从 current_models HashMap 移除
    let types_to_remove: Vec<String> = state
        .config
        .current_models
        .iter()
        .filter(|(_, v)| *v == &id)
        .map(|(k, _)| k.clone())
        .collect();
    for t in types_to_remove {
        state.config.current_models.remove(&t);
        config_changed = true;
    }

    if config_changed {
        if let Err(e) = config_persist::save_config(&state.config) {
            return Err(Json(serde_json::json!({
                "error": format!("模型已删除但配置更新失败: {}", e)
            })));
        }
    }

    // 从列表中移除
    state.models.retain(|m| m.id != id);

    Ok(Json(serde_json::json!({
        "message": "模型已删除",
        "id": id
    })))
}

pub async fn get_model_files(
    State(state): State<Arc<RwLock<AppState>>>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, Json<serde_json::Value>> {
    let state = state.read().await;

    let model = state.models.iter().find(|m| m.id == id).cloned();
    let model = match model {
        Some(m) => m,
        None => {
            return Err(Json(serde_json::json!({
                "error": "模型不存在"
            })));
        }
    };

    // Ollama 模型没有本地文件
    if model.source == "ollama" {
        return Ok(Json(serde_json::json!({
            "id": model.id,
            "name": model.name,
            "path": model.path,
            "files": [],
        })));
    }

    let path = std::path::PathBuf::from(&model.path);
    let path = if path.is_relative() {
        project_root().join(&path)
    } else {
        path
    };

    let mut files = Vec::new();

    if path.exists() {
        let mut entries = match tokio::fs::read_dir(&path).await {
            Ok(e) => e,
            Err(e) => {
                return Err(Json(serde_json::json!({
                    "error": format!("读取目录失败: {}", e)
                })));
            }
        };

        while let Ok(Some(entry)) = entries.next_entry().await {
            let meta = entry.metadata().await.ok();
            let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let modified = meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs());

            files.push(serde_json::json!({
                "name": entry.file_name().to_string_lossy().to_string(),
                "path": entry.path().to_string_lossy().to_string(),
                "size": size,
                "size_text": format_file_size(size),
                "is_dir": meta.as_ref().map(|m| m.is_dir()).unwrap_or(false),
                "modified": modified,
            }));
        }

        // 按文件名排序
        files.sort_by(|a, b| {
            let a_name = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let b_name = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
            a_name.cmp(b_name)
        });
    }

    Ok(Json(serde_json::json!({
        "id": model.id,
        "name": model.name,
        "path": model.path,
        "files": files,
    })))
}

// ---------- 模型元数据（备注、标签、最近使用） ----------

#[derive(Debug, serde::Deserialize)]
pub struct UpdateMetaRequest {
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

pub async fn get_model_meta(
    axum::extract::Path(id): axum::extract::Path<String>,
    State(state): State<Arc<RwLock<AppState>>>,
) -> Result<Json<crate::state::ModelMeta>, Json<serde_json::Value>> {
    let state = state.read().await;
    let meta = state
        .config
        .model_meta
        .get(&id)
        .cloned()
        .unwrap_or_default();
    Ok(Json(meta))
}

pub async fn update_model_meta(
    axum::extract::Path(id): axum::extract::Path<String>,
    State(state): State<Arc<RwLock<AppState>>>,
    Json(req): Json<UpdateMetaRequest>,
) -> Result<Json<crate::state::ModelMeta>, Json<serde_json::Value>> {
    let mut state = state.write().await;
    let entry = state.config.model_meta.entry(id).or_default();
    if let Some(notes) = req.notes {
        entry.notes = notes;
    }
    if let Some(tags) = req.tags {
        entry.tags = tags;
    }
    let meta = entry.clone();
    if let Err(e) = config_persist::save_config(&state.config) {
        return Err(Json(serde_json::json!({
            "error": format!("保存备注失败: {}", e)
        })));
    }
    Ok(Json(meta))
}

fn format_file_size(bytes: u64) -> String {
    if bytes >= 1024 * 1024 * 1024 {
        format!("{:.1} GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
    } else if bytes >= 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    } else if bytes >= 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{} B", bytes)
    }
}
