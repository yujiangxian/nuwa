// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use tokio::sync::{OwnedSemaphorePermit, RwLock, Semaphore};

use crate::config_persist;
use crate::constants::{default_ref_audio, default_ref_text};
use crate::services::inference;
use crate::state::AppState;

/// Global inference concurrency limiter (default 2). Override with `NUWA_INFERENCE_CONCURRENCY`.
fn inference_limiter() -> &'static Arc<Semaphore> {
    static SEM: OnceLock<Arc<Semaphore>> = OnceLock::new();
    SEM.get_or_init(|| {
        let n = std::env::var("NUWA_INFERENCE_CONCURRENCY")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(2)
            .max(1);
        Arc::new(Semaphore::new(n))
    })
}

async fn try_acquire_inference_slot(
) -> Result<OwnedSemaphorePermit, (StatusCode, Json<serde_json::Value>)> {
    inference_limiter().clone().try_acquire_owned().map_err(|_| {
        (
            StatusCode::TOO_MANY_REQUESTS,
            Json(serde_json::json!({
                "error": "推理任务繁忙，请稍后重试"
            })),
        )
    })
}

/// RAII guard: inserts a model into `active_inference_models` on acquire,
/// and removes it on drop — even if the handler panics.
struct ModelGuard {
    state: Arc<RwLock<AppState>>,
    model_id: Option<String>,
}

impl ModelGuard {
    async fn acquire(state: Arc<RwLock<AppState>>, model_id: String) -> Self {
        {
            let mut s = state.write().await;
            s.active_inference_models.insert(model_id.clone());
        }
        Self {
            state,
            model_id: Some(model_id),
        }
    }
}

impl Drop for ModelGuard {
    fn drop(&mut self) {
        if let Some(ref id) = self.model_id.take() {
            let state = self.state.clone();
            let id = id.clone();
            tokio::spawn(async move {
                let mut s = state.write().await;
                s.active_inference_models.remove(&id);
            });
        }
    }
}

/// Look up scanned `ModelInfo.path` for a model id (prefer over hardcoded nested dirs).
async fn installed_model_path(state: &Arc<RwLock<AppState>>, model_id: &str) -> Option<String> {
    let s = state.read().await;
    s.models
        .iter()
        .find(|m| m.id == model_id)
        .map(|m| m.path.clone())
        .filter(|p| !p.trim().is_empty())
}

// ========== ASR ==========

#[derive(serde::Deserialize)]
pub struct AsrRequest {
    pub audio_path: String,
    /// 可选，不填则使用 current_model_id
    pub model_id: Option<String>,
}

#[derive(serde::Serialize)]
pub struct AsrResponse {
    pub success: bool,
    pub text: String,
    pub error: Option<String>,
    /// 本次实际使用的 model_id（含 fallback 后的最终值）
    pub model: String,
    /// handler 侧测量的墙钟耗时（毫秒）
    pub elapsed_ms: u64,
}

pub async fn transcribe(
    State(state): State<Arc<RwLock<AppState>>>,
    Json(req): Json<AsrRequest>,
) -> axum::response::Response {
    let _permit = match try_acquire_inference_slot().await {
        Ok(p) => p,
        Err(resp) => return resp.into_response(),
    };
    // 测量墙钟耗时
    let started = std::time::Instant::now();

    // 确定模型 ID：优先 current_asr_model，最后 fallback 到第一个可用 ASR 模型
    let model_id = match req.model_id {
        Some(id) => id,
        None => {
            let state = state.read().await;
            state.config.current_asr_model.clone().unwrap_or_else(|| {
                // 自动 fallback 到第一个可用 ASR 模型
                state
                    .models
                    .iter()
                    .find(|m| m.model_type == "asr" && inference::resolve_asr_model(&m.id).is_ok())
                    .map(|m| m.id.clone())
                    .unwrap_or_default()
            })
        }
    };

    if model_id.is_empty() {
        return Json(AsrResponse {
            success: false,
            text: String::new(),
            error: Some("未选择模型，请先在我的模型中选择一个 ASR 模型".to_string()),
            model: String::new(),
            elapsed_ms: started.elapsed().as_millis() as u64,
        })
        .into_response();
    }

    // 检查模型是否支持 ASR
    if !inference::is_model_supported(&model_id) {
        return Json(AsrResponse {
            success: false,
            text: String::new(),
            error: Some(format!("模型 {} 不支持 ASR 推理", model_id)),
            model: model_id.clone(),
            elapsed_ms: started.elapsed().as_millis() as u64,
        })
        .into_response();
    }

    let audio_path = match crate::util::safe_resolve(
        &crate::util::project_root().join("assets"),
        &req.audio_path,
    ) {
        Ok(p) => p,
        Err(_) => {
            return Json(AsrResponse {
                success: false,
                text: String::new(),
                error: Some("音频路径不合法".to_string()),
                model: model_id.clone(),
                elapsed_ms: started.elapsed().as_millis() as u64,
            })
            .into_response();
        }
    };

    let _guard = ModelGuard::acquire(state.clone(), model_id.clone()).await;
    let installed = installed_model_path(&state, &model_id).await;

    let result = match inference::transcribe_at(
        &audio_path,
        &model_id,
        installed.as_deref(),
    )
    .await
    {
        Ok(text) => {
            // 记录最近使用时间
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            {
                let mut state = state.write().await;
                state
                    .config
                    .model_meta
                    .entry(model_id.clone())
                    .or_default()
                    .last_used = Some(now);
                if let Err(e) = config_persist::save_config(&state.config) {
                    tracing::warn!("更新模型最后使用时间失败: {}", e);
                }
            }
            Json(AsrResponse {
                success: true,
                text,
                error: None,
                model: model_id.clone(),
                elapsed_ms: started.elapsed().as_millis() as u64,
            })
        }
        Err(e) => {
            {
                let _state = state.write().await;
            }
            Json(AsrResponse {
                success: false,
                text: String::new(),
                error: Some(e),
                model: model_id.clone(),
                elapsed_ms: started.elapsed().as_millis() as u64,
            })
        }
    };

    result.into_response()
}

// ========== TTS ==========

#[derive(serde::Deserialize)]
pub struct TtsRequest {
    pub text: String,
    /// 可选，不填则使用 current_model_id
    pub model_id: Option<String>,
    pub ref_audio: String,
    pub ref_text: String,
}

#[derive(serde::Serialize)]
pub struct TtsResponse {
    pub success: bool,
    pub output_path: Option<String>,
    pub duration_sec: Option<f64>,
    pub error: Option<String>,
}

pub async fn synthesize(
    State(state): State<Arc<RwLock<AppState>>>,
    Json(req): Json<TtsRequest>,
) -> axum::response::Response {
    let _permit = match try_acquire_inference_slot().await {
        Ok(p) => p,
        Err(resp) => return resp.into_response(),
    };
    // 确定模型 ID 和输出目录
    let (model_id, output_dir) = {
        let state = state.read().await;
        let model_id = req.model_id.clone().unwrap_or_else(|| {
            state.config.current_tts_model.clone().unwrap_or_else(|| {
                state
                    .models
                    .iter()
                    .find(|m| m.model_type == "tts" && inference::resolve_tts_model(&m.id).is_ok())
                    .map(|m| m.id.clone())
                    .unwrap_or_default()
            })
        });
        let od = state.config.output_dir.clone();
        let od = if od.is_empty() {
            crate::util::project_root().join("output")
        } else {
            let p = std::path::PathBuf::from(&od);
            if p.is_relative() {
                crate::util::project_root().join(p)
            } else {
                p
            }
        };
        (model_id, od)
    };

    if model_id.is_empty() {
        return Json(TtsResponse {
            success: false,
            output_path: None,
            duration_sec: None,
            error: Some("未选择模型，请先在我的模型中选择一个 TTS 模型".to_string()),
        }).into_response();
    }

    // 检查模型是否支持 TTS
    if !inference::is_model_supported(&model_id) {
        return Json(TtsResponse {
            success: false,
            output_path: None,
            duration_sec: None,
            error: Some(format!("模型 {} 不支持 TTS 推理", model_id)),
        }).into_response();
    }

    // Validate text length before processing
    const MAX_TTS_TEXT_LEN: usize = 5000;
    if req.text.len() > MAX_TTS_TEXT_LEN {
        return Json(TtsResponse {
            success: false,
            output_path: None,
            duration_sec: None,
            error: Some(format!("文本过长 (>{MAX_TTS_TEXT_LEN} 字符)")),
        }).into_response();
    }

    let ref_audio = if req.ref_audio.is_empty() {
        PathBuf::from(default_ref_audio())
    } else {
        match crate::util::safe_resolve(&crate::util::project_root().join("assets"), &req.ref_audio)
        {
            Ok(p) => p,
            Err(_) => {
                return Json(TtsResponse {
                    success: false,
                    output_path: None,
                    duration_sec: None,
                    error: Some("参考音频路径不合法".to_string()),
                }).into_response();
            }
        }
    };
    let ref_text = if req.ref_text.is_empty() {
        default_ref_text()
    } else {
        req.ref_text.clone()
    };

    // 生成输出路径
    let _ = tokio::fs::create_dir_all(&output_dir).await;
    let output_filename = format!("tts_{}.wav", uuid::Uuid::new_v4());
    let output_path = output_dir.join(&output_filename);

    // RAII guard removes model on drop (even on panic)
    let _guard = ModelGuard::acquire(state.clone(), model_id.clone()).await;
    let installed = installed_model_path(&state, &model_id).await;

    let result = match inference::synthesize_at(
        &req.text,
        &model_id,
        &ref_audio,
        &ref_text,
        &output_path,
        installed.as_deref(),
    )
    .await
    {
        Ok(()) => {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            {
                let mut state = state.write().await;
                state
                    .config
                    .model_meta
                    .entry(model_id.clone())
                    .or_default()
                    .last_used = Some(now);
                if let Err(e) = config_persist::save_config(&state.config) {
                    tracing::warn!("更新模型最后使用时间失败: {}", e);
                }
            }
            let dur = inference::wav_duration_secs(&output_path);
            Json(TtsResponse {
                success: true,
                output_path: Some(output_filename),
                duration_sec: dur,
                error: None,
            })
        }
        Err(e) => {
            {
                let _state = state.write().await;
            }
            Json(TtsResponse {
                success: false,
                output_path: None,
                duration_sec: None,
                error: Some(e),
            })
        }
    };

    result.into_response()
}

// ========== TTS 多段合成（脚本模式）==========

#[derive(serde::Deserialize)]
pub struct TtsScriptRequest {
    pub segments: serde_json::Value,
    pub model_id: Option<String>,
    pub ref_audio: Option<String>,
    pub ref_text: Option<String>,
}

#[derive(serde::Serialize)]
pub struct TtsScriptResponse {
    pub success: bool,
    pub output_path: Option<String>,
    pub duration_sec: Option<f64>,
    pub error: Option<String>,
}

pub async fn synthesize_script(
    State(state): State<Arc<RwLock<AppState>>>,
    Json(req): Json<TtsScriptRequest>,
) -> axum::response::Response {
    let _permit = match try_acquire_inference_slot().await {
        Ok(p) => p,
        Err(resp) => return resp.into_response(),
    };
    let (model_id, output_dir) = {
        let state = state.read().await;
        let mid = req.model_id.clone().unwrap_or_else(|| {
            state.config.current_tts_model.clone().unwrap_or_else(|| {
                state
                    .models
                    .iter()
                    .find(|m| m.model_type == "tts" && inference::resolve_tts_model(&m.id).is_ok())
                    .map(|m| m.id.clone())
                    .unwrap_or_default()
            })
        });
        let od = state.config.output_dir.clone();
        let od = if od.is_empty() {
            crate::util::project_root().join("output")
        } else {
            let p = std::path::PathBuf::from(&od);
            if p.is_relative() {
                crate::util::project_root().join(p)
            } else {
                p
            }
        };
        (mid, od)
    };

    if model_id.is_empty() {
        return Json(TtsScriptResponse {
            success: false,
            output_path: None,
            duration_sec: None,
            error: Some("未选择 TTS 模型".to_string()),
        }).into_response();
    }

    if !inference::is_model_supported(&model_id) {
        return Json(TtsScriptResponse {
            success: false,
            output_path: None,
            duration_sec: None,
            error: Some(format!("模型 {} 不支持 TTS 推理", model_id)),
        }).into_response();
    }

    let default_audio = default_ref_audio();
    let ref_audio_path = match req.ref_audio.as_deref().unwrap_or(default_audio.as_str()) {
        "" => PathBuf::from(default_ref_audio()),
        p => match crate::util::safe_resolve(&crate::util::project_root().join("assets"), p) {
            Ok(path) => path,
            Err(_) => {
                return Json(TtsScriptResponse {
                    success: false,
                    output_path: None,
                    duration_sec: None,
                    error: Some("参考音频路径不合法".to_string()),
                })
                .into_response();
            }
        },
    };
    let ref_audio = ref_audio_path;
    let default_text = default_ref_text();
    let ref_text = req.ref_text.as_deref().unwrap_or(default_text.as_str());

    let segments_json = serde_json::to_string(&req.segments).unwrap_or_else(|_| "[]".to_string());

    let output_filename = format!("tts_script_{}.wav", uuid::Uuid::new_v4());
    let output_path = output_dir.join(&output_filename);

    let _guard = ModelGuard::acquire(state.clone(), model_id.clone()).await;
    let installed = installed_model_path(&state, &model_id).await;

    let result = match inference::synthesize_script_at(
        &segments_json,
        &model_id,
        &ref_audio,
        ref_text,
        &output_path,
        installed.as_deref(),
    )
    .await
    {
        Ok(()) => {
            let _now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            {
                let _state = state.write().await;
            }
            Json(TtsScriptResponse {
                success: true,
                output_path: Some(output_filename),
                duration_sec: None,
                error: None,
            })
        }
        Err(e) => {
            {
                let _state = state.write().await;
            }
            Json(TtsScriptResponse {
                success: false,
                output_path: None,
                duration_sec: None,
                error: Some(e),
            })
        }
    };

    result.into_response()
}

// ========== ASR 文件上传 ==========

#[derive(serde::Serialize)]
pub struct AsrUploadResponse {
    pub success: bool,
    pub text: String,
    pub error: Option<String>,
    /// 本次实际使用的 model_id（含 fallback 后的最终值）
    pub model: String,
    /// handler 侧测量的墙钟耗时（毫秒）
    pub elapsed_ms: u64,
}

pub async fn transcribe_upload(
    State(state): State<Arc<RwLock<AppState>>>,
    mut multipart: axum::extract::Multipart,
) -> axum::response::Response {
    let _permit = match try_acquire_inference_slot().await {
        Ok(p) => p,
        Err(resp) => return resp.into_response(),
    };
    // 测量墙钟耗时
    let started = std::time::Instant::now();

    // 解析 multipart 表单，提取音频文件和可选的 model_id
    let mut audio_data: Option<Vec<u8>> = None;
    let mut model_id_opt: Option<String> = None;

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "audio" => match field.bytes().await {
                Ok(bytes) => audio_data = Some(bytes.to_vec()),
                Err(e) => {
                    return Json(AsrUploadResponse {
                        success: false,
                        text: String::new(),
                        error: Some(format!("读取音频文件失败: {}", e)),
                        model: String::new(),
                        elapsed_ms: started.elapsed().as_millis() as u64,
                    }).into_response();
                }
            },
            "model_id" => match field.text().await {
                Ok(text) => model_id_opt = Some(text),
                Err(e) => {
                    return Json(AsrUploadResponse {
                        success: false,
                        text: String::new(),
                        error: Some(format!("读取模型ID失败: {}", e)),
                        model: String::new(),
                        elapsed_ms: started.elapsed().as_millis() as u64,
                    }).into_response();
                }
            },
            _ => {}
        }
    }

    let audio_data = match audio_data {
        Some(d) => d,
        None => {
            return Json(AsrUploadResponse {
                success: false,
                text: String::new(),
                error: Some("未找到音频文件字段（请使用 'audio' 字段上传）".to_string()),
                model: String::new(),
                elapsed_ms: started.elapsed().as_millis() as u64,
            }).into_response();
        }
    };

    // 确定模型 ID
    let model_id = match model_id_opt {
        Some(id) => id,
        None => {
            let state = state.read().await;
            state.config.current_asr_model.clone().unwrap_or_else(|| {
                state
                    .models
                    .iter()
                    .find(|m| m.model_type == "asr" && inference::resolve_asr_model(&m.id).is_ok())
                    .map(|m| m.id.clone())
                    .unwrap_or_default()
            })
        }
    };

    if model_id.is_empty() {
        return Json(AsrUploadResponse {
            success: false,
            text: String::new(),
            error: Some("未选择模型，请先在我的模型中选择一个 ASR 模型".to_string()),
            model: String::new(),
            elapsed_ms: started.elapsed().as_millis() as u64,
        }).into_response();
    }

    // 检查模型是否支持 ASR
    if !inference::is_model_supported(&model_id) {
        return Json(AsrUploadResponse {
            success: false,
            text: String::new(),
            error: Some(format!("模型 {} 不支持 ASR 推理", model_id)),
            model: model_id.clone(),
            elapsed_ms: started.elapsed().as_millis() as u64,
        }).into_response();
    }

    // 保存到临时文件
    let temp_filename = format!("nuwa_asr_upload_{}.wav", uuid::Uuid::new_v4());
    let temp_path = std::env::temp_dir().join(&temp_filename);
    if let Err(e) = tokio::fs::write(&temp_path, &audio_data).await {
        return Json(AsrUploadResponse {
            success: false,
            text: String::new(),
            error: Some(format!("保存临时音频文件失败: {}", e)),
            model: model_id.clone(),
            elapsed_ms: started.elapsed().as_millis() as u64,
        }).into_response();
    }

    let _guard = ModelGuard::acquire(state.clone(), model_id.clone()).await;
    let installed = installed_model_path(&state, &model_id).await;

    // 调用 ASR 推理
    let result = match inference::transcribe_at(&temp_path, &model_id, installed.as_deref()).await
    {
        Ok(text) => {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            {
                let mut state = state.write().await;
                state
                    .config
                    .model_meta
                    .entry(model_id.clone())
                    .or_default()
                    .last_used = Some(now);
                if let Err(e) = config_persist::save_config(&state.config) {
                    tracing::warn!("更新模型最后使用时间失败: {}", e);
                }
            }
            Json(AsrUploadResponse {
                success: true,
                text,
                error: None,
                model: model_id.clone(),
                elapsed_ms: started.elapsed().as_millis() as u64,
            })
        }
        Err(e) => {
            {
                let _state = state.write().await;
            }
            Json(AsrUploadResponse {
                success: false,
                text: String::new(),
                error: Some(e),
                model: model_id.clone(),
                elapsed_ms: started.elapsed().as_millis() as u64,
            })
        }
    };

    // 清理临时文件
    let _ = tokio::fs::remove_file(&temp_path).await;

    result.into_response()
}
