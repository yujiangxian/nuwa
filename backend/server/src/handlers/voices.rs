// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

use axum::{
    extract::{Multipart, Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::services::voice_library;
use crate::state::{AppState, VoiceInfo};

/// 解析项目根目录（基于 exe 路径推断，与 `handlers/audio.rs`/`main.rs` 一致）。
fn project_root() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|exe| {
            exe.parent()
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
                .map(|p| p.to_path_buf())
        })
        .unwrap_or_else(|| {
            std::env::current_dir()
                .ok()
                .and_then(|cd| {
                    cd.parent()
                        .and_then(|p| p.parent())
                        .map(|p| p.to_path_buf())
                })
                .unwrap_or_else(|| PathBuf::from("."))
        })
}

/// 取 config.voices_dir 的相对形式（空则回退默认 `assets/datasets/voices`）。
fn voices_dir_relative(config_voices_dir: &str) -> String {
    let v = config_voices_dir.trim();
    if v.is_empty() {
        "assets/datasets/voices".to_string()
    } else {
        v.to_string()
    }
}

/// 将 voices_dir（可能相对）解析为绝对路径。
fn resolve_voices_dir_abs(config_voices_dir: &str) -> PathBuf {
    let rel = voices_dir_relative(config_voices_dir);
    let p = PathBuf::from(&rel);
    if p.is_relative() {
        project_root().join(p)
    } else {
        p
    }
}

/// 将 VoiceInfo.path（可能相对项目根）解析为绝对路径，用于读/删磁盘文件。
fn resolve_voice_path_abs(path: &str) -> PathBuf {
    let p = PathBuf::from(path);
    if p.is_relative() {
        project_root().join(p)
    } else {
        p
    }
}

/// GET /api/voices — 返回含 duration_seconds 的列表（不变）。
pub async fn list_voices(State(state): State<Arc<RwLock<AppState>>>) -> Json<Vec<VoiceInfo>> {
    let state = state.read().await;
    Json(state.voices.clone())
}

/// POST /api/voices — 旧 JSON 登记接口（保留以兼容）。
pub async fn add_voice(
    State(state): State<Arc<RwLock<AppState>>>,
    Json(voice): Json<VoiceInfo>,
) -> Json<VoiceInfo> {
    let mut state = state.write().await;
    state.voices.push(voice.clone());
    Json(voice)
}

/// 构造统一的错误响应。
fn err_resp(code: StatusCode, msg: impl Into<String>) -> (StatusCode, Json<serde_json::Value>) {
    (code, Json(serde_json::json!({ "error": msg.into() })))
}

/// POST /api/voices/upload — multipart: audio(file), name(text), transcript(text)。
/// 成功 200 返回创建的 VoiceInfo；校验失败返回 4xx + `{ "error": String }`。
pub async fn upload_voice(
    State(state): State<Arc<RwLock<AppState>>>,
    mut multipart: Multipart,
) -> Result<Json<VoiceInfo>, (StatusCode, Json<serde_json::Value>)> {
    // 1. 收集 multipart 字段。
    let mut audio_bytes: Option<Vec<u8>> = None;
    let mut audio_filename: Option<String> = None;
    let mut name: Option<String> = None;
    let mut transcript: Option<String> = None;

    while let Ok(Some(field)) = multipart.next_field().await {
        let field_name = field.name().unwrap_or("").to_string();
        match field_name.as_str() {
            "audio" => {
                // 原始文件名用于提取扩展名。
                audio_filename = field.file_name().map(|s| s.to_string());
                match field.bytes().await {
                    Ok(bytes) => audio_bytes = Some(bytes.to_vec()),
                    Err(e) => {
                        return Err(err_resp(
                            StatusCode::BAD_REQUEST,
                            format!("读取音频文件失败: {e}"),
                        ));
                    }
                }
            }
            "name" => {
                if let Ok(text) = field.text().await {
                    name = Some(text);
                }
            }
            "transcript" => {
                if let Ok(text) = field.text().await {
                    transcript = Some(text);
                }
            }
            _ => {}
        }
    }

    // 2. 校验。
    let audio_bytes = match audio_bytes {
        Some(b) => b,
        None => return Err(err_resp(StatusCode::BAD_REQUEST, "需要音频文件")),
    };
    let filename = audio_filename.unwrap_or_default();

    if !voice_library::is_supported_extension(&filename) {
        // 提取扩展名用于提示。
        let ext = filename
            .rfind('.')
            .map(|i| &filename[i..])
            .unwrap_or("")
            .to_string();
        return Err(err_resp(
            StatusCode::BAD_REQUEST,
            format!("不支持的音频格式: {ext}"),
        ));
    }

    if audio_bytes.len() > voice_library::MAX_UPLOAD_SIZE {
        return Err(err_resp(
            StatusCode::PAYLOAD_TOO_LARGE,
            "文件过大，最大 20MB",
        ));
    }

    let name = match name {
        Some(n) if !n.trim().is_empty() => n,
        _ => return Err(err_resp(StatusCode::BAD_REQUEST, "需要音色名称")),
    };
    let transcript = transcript.unwrap_or_default();

    // 3. 探测采样率与时长。
    let (sample_rate, duration_seconds) = voice_library::probe_audio(&audio_bytes, &filename);

    // 4. 分配 id 并写文件。
    let (config_voices_dir, voice_id) = {
        let state = state.read().await;
        let id = voice_library::allocate_id(&state.voices);
        (state.config.voices_dir.clone(), id)
    };

    // 目标文件名：<id> + 原扩展名（小写）。
    let ext = filename
        .rfind('.')
        .map(|i| filename[i..].to_lowercase())
        .unwrap_or_default();
    let stored_filename = format!("{voice_id}{ext}");

    let voices_dir_abs = resolve_voices_dir_abs(&config_voices_dir);
    if let Err(e) = std::fs::create_dir_all(&voices_dir_abs) {
        return Err(err_resp(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("创建音色目录失败: {e}"),
        ));
    }
    let target_path = voices_dir_abs.join(&stored_filename);
    if let Err(e) = std::fs::write(&target_path, &audio_bytes) {
        return Err(err_resp(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("保存音频失败: {e}"),
        ));
    }

    // 5. 构造 VoiceInfo（path 为相对项目根形式，引擎可读）。
    let rel_dir = voices_dir_relative(&config_voices_dir)
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string();
    let voice_path = format!("{rel_dir}/{stored_filename}");

    let voice = VoiceInfo {
        id: voice_id,
        name,
        path: voice_path,
        transcript: Some(transcript),
        sample_rate,
        duration_seconds,
    };

    // 6. 登记并落盘（落盘失败仅 warn，不阻断成功）。
    {
        let mut state = state.write().await;
        state.voices.push(voice.clone());
        if let Err(e) = voice_library::save_library(&voices_dir_abs, &state.voices) {
            tracing::warn!("写入音色库失败: {}", e);
        }
    }

    Ok(Json(voice))
}

/// GET /api/voices/{id}/audio — 按 id 返回音频字节 + 正确 Content-Type。
/// 未找到返回 404（无音频体）；读取失败 500。
pub async fn serve_voice_audio(
    State(state): State<Arc<RwLock<AppState>>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    // 按 id 查条目。
    let voice_path = {
        let state = state.read().await;
        state
            .voices
            .iter()
            .find(|v| v.id == id)
            .map(|v| v.path.clone())
    };
    let voice_path = match voice_path {
        Some(p) => p,
        None => return (StatusCode::NOT_FOUND, "Voice not found").into_response(),
    };

    let abs_path = resolve_voice_path_abs(&voice_path);
    let mime = voice_library::mime_for_extension(&voice_path);

    match tokio::fs::read(&abs_path).await {
        Ok(data) => {
            let mut response = axum::response::Response::new(data.into());
            response.headers_mut().insert(
                axum::http::header::CONTENT_TYPE,
                axum::http::HeaderValue::from_static(mime),
            );
            response
        }
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Failed to read audio").into_response(),
    }
}

/// DELETE /api/voices/{id} — 移除条目 + 删除磁盘文件 + 落盘。
/// id 不存在仍返回 `{ "success": true }`（幂等）。
pub async fn delete_voice(
    State(state): State<Arc<RwLock<AppState>>>,
    Path(id): Path<String>,
) -> Json<serde_json::Value> {
    let mut state = state.write().await;

    // 查条目：不存在 → 幂等返回，库不变。
    let entry = state.voices.iter().find(|v| v.id == id).cloned();
    let entry = match entry {
        Some(e) => e,
        None => return Json(serde_json::json!({ "success": true })),
    };

    // 删除磁盘文件（忽略文件不存在错误）。
    let abs_path = resolve_voice_path_abs(&entry.path);
    if let Err(e) = std::fs::remove_file(&abs_path) {
        if e.kind() != std::io::ErrorKind::NotFound {
            tracing::warn!("删除音色文件失败: {}", e);
        }
    }

    // 从内存移除并落盘。
    state.voices.retain(|v| v.id != id);
    let voices_dir_abs = resolve_voices_dir_abs(&state.config.voices_dir);
    if let Err(e) = voice_library::save_library(&voices_dir_abs, &state.voices) {
        tracing::warn!("写入音色库失败: {}", e);
    }

    Json(serde_json::json!({ "success": true }))
}
