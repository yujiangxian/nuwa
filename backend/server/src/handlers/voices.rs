// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

use axum::{
    extract::{Multipart, Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::path::{Path as StdPath, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::services::voice_library;
use crate::state::{AppState, VoiceInfo};
use crate::util::{project_root, safe_resolve};

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

/// Confine a voice file path to voices_dir (rejects absolute escapes and `..`).
fn confine_voice_file(voices_dir: &StdPath, path: &str) -> Result<PathBuf, String> {
    std::fs::create_dir_all(voices_dir).map_err(|e| format!("无法创建音色目录: {e}"))?;
    let base = std::fs::canonicalize(voices_dir).map_err(|e| format!("无法解析音色目录: {e}"))?;

    let p = StdPath::new(path);
    let candidate = if p.is_absolute() {
        p.to_path_buf()
    } else {
        project_root().join(p)
    };

    if candidate.exists() {
        let canon =
            std::fs::canonicalize(&candidate).map_err(|e| format!("无法解析音色路径: {e}"))?;
        if !canon.starts_with(&base) {
            return Err("音色路径必须位于 voices 目录内".to_string());
        }
        return Ok(canon);
    }

    // File may not exist yet — require it resolves under voices_dir via filename only
    let name = p
        .file_name()
        .ok_or_else(|| "音色路径无效".to_string())?
        .to_string_lossy();
    safe_resolve(&base, &name).or_else(|_| {
        // Or relative path under voices_dir (e.g. subdir/file.wav stored as project-relative)
        if let Ok(rel) = candidate.strip_prefix(&base) {
            let mut out = base.clone();
            for c in rel.components() {
                match c {
                    std::path::Component::Normal(s) => out.push(s),
                    std::path::Component::CurDir => {}
                    _ => return Err("音色路径包含非法组件".to_string()),
                }
            }
            if out.starts_with(&base) {
                return Ok(out);
            }
        }
        Err("音色路径必须位于 voices 目录内".to_string())
    })
}

/// GET /api/voices — 返回含 duration_seconds 的列表（不变）。
pub async fn list_voices(State(state): State<Arc<RwLock<AppState>>>) -> Json<Vec<VoiceInfo>> {
    let state = state.read().await;
    Json(state.voices.clone())
}

/// POST /api/voices — 旧 JSON 登记接口（保留以兼容）。
/// 校验 path 必须落在 voices_dir 内，并持久化到音色库。
pub async fn add_voice(
    State(state): State<Arc<RwLock<AppState>>>,
    Json(mut voice): Json<VoiceInfo>,
) -> Result<Json<VoiceInfo>, (StatusCode, Json<serde_json::Value>)> {
    let voices_dir_abs = {
        let state = state.read().await;
        resolve_voices_dir_abs(&state.config.voices_dir)
    };

    let confined = confine_voice_file(&voices_dir_abs, &voice.path).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": e })),
        )
    })?;

    // Store project-relative path when possible for portability
    if let Ok(rel) = confined.strip_prefix(project_root()) {
        voice.path = rel.to_string_lossy().replace('\\', "/");
    } else {
        voice.path = confined.to_string_lossy().to_string();
    }

    let mut state = state.write().await;
    state.voices.push(voice.clone());
    if let Err(e) = voice_library::save_library(&voices_dir_abs, &state.voices) {
        tracing::warn!("写入音色库失败: {}", e);
    }
    Ok(Json(voice))
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
    let mut audio_bytes: Option<Vec<u8>> = None;
    let mut audio_filename: Option<String> = None;
    let mut name: Option<String> = None;
    let mut transcript: Option<String> = None;

    while let Ok(Some(field)) = multipart.next_field().await {
        let field_name = field.name().unwrap_or("").to_string();
        match field_name.as_str() {
            "audio" => {
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

    let audio_bytes = match audio_bytes {
        Some(b) => b,
        None => return Err(err_resp(StatusCode::BAD_REQUEST, "需要音频文件")),
    };
    let filename = audio_filename.unwrap_or_default();

    if !voice_library::is_supported_extension(&filename) {
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

    let (sample_rate, duration_seconds) = voice_library::probe_audio(&audio_bytes, &filename);

    let (config_voices_dir, voice_id) = {
        let state = state.read().await;
        let id = voice_library::allocate_id(&state.voices);
        (state.config.voices_dir.clone(), id)
    };

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
    let (voice_path, voices_dir) = {
        let state = state.read().await;
        let path = state
            .voices
            .iter()
            .find(|v| v.id == id)
            .map(|v| v.path.clone());
        (path, resolve_voices_dir_abs(&state.config.voices_dir))
    };
    let voice_path = match voice_path {
        Some(p) => p,
        None => return (StatusCode::NOT_FOUND, "Voice not found").into_response(),
    };

    let abs_path = match confine_voice_file(&voices_dir, &voice_path) {
        Ok(p) => p,
        Err(_) => return (StatusCode::NOT_FOUND, "Voice path rejected").into_response(),
    };
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

    let entry = state.voices.iter().find(|v| v.id == id).cloned();
    let entry = match entry {
        Some(e) => e,
        None => return Json(serde_json::json!({ "success": true })),
    };

    let voices_dir_abs = resolve_voices_dir_abs(&state.config.voices_dir);
    if let Ok(abs_path) = confine_voice_file(&voices_dir_abs, &entry.path) {
        if let Err(e) = std::fs::remove_file(&abs_path) {
            if e.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!("删除音色文件失败: {}", e);
            }
        }
    } else {
        tracing::warn!(path = %entry.path, "拒绝删除 voices 目录外的音色文件");
    }

    state.voices.retain(|v| v.id != id);
    if let Err(e) = voice_library::save_library(&voices_dir_abs, &state.voices) {
        tracing::warn!("写入音色库失败: {}", e);
    }

    Json(serde_json::json!({ "success": true }))
}
