use axum::{extract::State, Json};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::config_persist;
use crate::constants::{DEFAULT_REF_AUDIO, DEFAULT_REF_TEXT};
use crate::services::inference;
use crate::state::AppState;

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
) -> Json<AsrResponse> {
    // 测量墙钟耗时
    let started = std::time::Instant::now();

    // 确定模型 ID：优先 current_asr_model，其次 current_model_id（兼容旧配置），最后 fallback
    let model_id = match req.model_id {
        Some(id) => id,
        None => {
            let state = state.read().await;
            state.config.current_asr_model.clone()
                .or_else(|| state.config.current_model_id.clone())
                .unwrap_or_else(|| {
                    // 自动 fallback 到第一个可用 ASR 模型
                    state.models.iter()
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
        });
    }

    // 检查模型是否支持 ASR
    if !inference::is_model_supported(&model_id) {
        return Json(AsrResponse {
            success: false,
            text: String::new(),
            error: Some(format!("模型 {} 不支持 ASR 推理", model_id)),
            model: model_id.clone(),
            elapsed_ms: started.elapsed().as_millis() as u64,
        });
    }

    let audio_path = PathBuf::from(&req.audio_path);

    // 标记模型使用中
    {
        let mut state = state.write().await;
        state.active_inference_models.insert(model_id.clone());
    }

    let result = match inference::transcribe(&audio_path, &model_id).await {
        Ok(text) => {
            // 记录最近使用时间
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            {
                let mut state = state.write().await;
                state.config.model_meta.entry(model_id.clone()).or_default().last_used = Some(now);
                if let Err(e) = config_persist::save_config(&state.config) {
                    tracing::warn!("更新模型最后使用时间失败: {}", e);
                }
                state.active_inference_models.remove(&model_id);
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
                let mut state = state.write().await;
                state.active_inference_models.remove(&model_id);
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

    result
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
    pub error: Option<String>,
}

pub async fn synthesize(
    State(state): State<Arc<RwLock<AppState>>>,
    Json(req): Json<TtsRequest>,
) -> Json<TtsResponse> {
    // 确定模型 ID：优先 current_tts_model，其次 current_model_id（兼容旧配置），最后 fallback
    let model_id = match req.model_id {
        Some(id) => id,
        None => {
            let state = state.read().await;
            state.config.current_tts_model.clone()
                .or_else(|| state.config.current_model_id.clone())
                .unwrap_or_else(|| {
                    // 自动 fallback 到第一个可用 TTS 模型
                    state.models.iter()
                        .find(|m| m.model_type == "tts" && inference::resolve_tts_model(&m.id).is_ok())
                        .map(|m| m.id.clone())
                        .unwrap_or_default()
                })
        }
    };

    if model_id.is_empty() {
        return Json(TtsResponse {
            success: false,
            output_path: None,
            error: Some("未选择模型，请先在我的模型中选择一个 TTS 模型".to_string()),
        });
    }

    // 检查模型是否支持 TTS
    if !inference::is_model_supported(&model_id) {
        return Json(TtsResponse {
            success: false,
            output_path: None,
            error: Some(format!("模型 {} 不支持 TTS 推理", model_id)),
        });
    }

    let ref_audio = if req.ref_audio.is_empty() {
        PathBuf::from(DEFAULT_REF_AUDIO)
    } else {
        PathBuf::from(&req.ref_audio)
    };
    let ref_text = if req.ref_text.is_empty() {
        DEFAULT_REF_TEXT.to_string()
    } else {
        req.ref_text.clone()
    };

    // 生成输出路径（保存到 output/ 目录，便于前端通过 /api/audio 访问）
    let output_dir = std::path::PathBuf::from("output");
    let _ = tokio::fs::create_dir_all(&output_dir).await;
    let output_filename = format!("tts_{}.wav", uuid::Uuid::new_v4());
    let output_path = output_dir.join(&output_filename);

    // 标记模型使用中
    {
        let mut state = state.write().await;
        state.active_inference_models.insert(model_id.clone());
    }

    let result = match inference::synthesize(&req.text, &model_id, &ref_audio, &ref_text, &output_path).await {
        Ok(()) => {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            {
                let mut state = state.write().await;
                state.config.model_meta.entry(model_id.clone()).or_default().last_used = Some(now);
                if let Err(e) = config_persist::save_config(&state.config) {
                    tracing::warn!("更新模型最后使用时间失败: {}", e);
                }
                state.active_inference_models.remove(&model_id);
            }
            Json(TtsResponse {
                success: true,
                output_path: Some(output_filename),
                error: None,
            })
        }
        Err(e) => {
            {
                let mut state = state.write().await;
                state.active_inference_models.remove(&model_id);
            }
            Json(TtsResponse {
                success: false,
                output_path: None,
                error: Some(e),
            })
        }
    };

    result
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
) -> Json<TtsScriptResponse> {
    let model_id = match req.model_id {
        Some(id) => id,
        None => {
            let state = state.read().await;
            state.config.current_tts_model.clone()
                .or_else(|| state.config.current_model_id.clone())
                .unwrap_or_else(|| {
                    state.models.iter()
                        .find(|m| m.model_type == "tts" && inference::resolve_tts_model(&m.id).is_ok())
                        .map(|m| m.id.clone())
                        .unwrap_or_default()
                })
        }
    };

    if model_id.is_empty() {
        return Json(TtsScriptResponse {
            success: false, output_path: None, duration_sec: None,
            error: Some("未选择 TTS 模型".to_string()),
        });
    }

    if !inference::is_model_supported(&model_id) {
        return Json(TtsScriptResponse {
            success: false, output_path: None, duration_sec: None,
            error: Some(format!("模型 {} 不支持 TTS 推理", model_id)),
        });
    }

    let ref_audio = req.ref_audio.as_deref()
        .unwrap_or(DEFAULT_REF_AUDIO);
    let ref_text = req.ref_text.as_deref()
        .unwrap_or(DEFAULT_REF_TEXT);

    let segments_json = serde_json::to_string(&req.segments)
        .unwrap_or_else(|_| "[]".to_string());

    let output_filename = format!("tts_script_{}.wav", uuid::Uuid::new_v4());
    let output_path = std::path::PathBuf::from("output").join(&output_filename);

    {
        let mut state = state.write().await;
        state.active_inference_models.insert(model_id.clone());
    }

    let result = match inference::synthesize_script(
        &segments_json, &model_id,
        &std::path::PathBuf::from(ref_audio), ref_text,
        &output_path,
    ).await {
        Ok(()) => {
            let _now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            {
                let mut state = state.write().await;
                state.active_inference_models.remove(&model_id);
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
                let mut state = state.write().await;
                state.active_inference_models.remove(&model_id);
            }
            Json(TtsScriptResponse {
                success: false, output_path: None, duration_sec: None,
                error: Some(e),
            })
        }
    };

    result
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
) -> Json<AsrUploadResponse> {
    // 测量墙钟耗时
    let started = std::time::Instant::now();

    // 解析 multipart 表单，提取音频文件和可选的 model_id
    let mut audio_data: Option<Vec<u8>> = None;
    let mut model_id_opt: Option<String> = None;

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "audio" => {
                match field.bytes().await {
                    Ok(bytes) => audio_data = Some(bytes.to_vec()),
                    Err(e) => {
                        return Json(AsrUploadResponse {
                            success: false,
                            text: String::new(),
                            error: Some(format!("读取音频文件失败: {}", e)),
                            model: String::new(),
                            elapsed_ms: started.elapsed().as_millis() as u64,
                        });
                    }
                }
            }
            "model_id" => {
                match field.text().await {
                    Ok(text) => model_id_opt = Some(text),
                    Err(e) => {
                        return Json(AsrUploadResponse {
                            success: false,
                            text: String::new(),
                            error: Some(format!("读取模型ID失败: {}", e)),
                            model: String::new(),
                            elapsed_ms: started.elapsed().as_millis() as u64,
                        });
                    }
                }
            }
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
            });
        }
    };

    // 确定模型 ID
    let model_id = match model_id_opt {
        Some(id) => id,
        None => {
            let state = state.read().await;
            state.config.current_asr_model.clone()
                .or_else(|| state.config.current_model_id.clone())
                .unwrap_or_else(|| {
                    state.models.iter()
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
        });
    }

    // 检查模型是否支持 ASR
    if !inference::is_model_supported(&model_id) {
        return Json(AsrUploadResponse {
            success: false,
            text: String::new(),
            error: Some(format!("模型 {} 不支持 ASR 推理", model_id)),
            model: model_id.clone(),
            elapsed_ms: started.elapsed().as_millis() as u64,
        });
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
        });
    }

    // 标记模型使用中
    {
        let mut state = state.write().await;
        state.active_inference_models.insert(model_id.clone());
    }

    // 调用 ASR 推理
    let result = match inference::transcribe(&temp_path, &model_id).await {
        Ok(text) => {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            {
                let mut state = state.write().await;
                state.config.model_meta.entry(model_id.clone()).or_default().last_used = Some(now);
                if let Err(e) = config_persist::save_config(&state.config) {
                    tracing::warn!("更新模型最后使用时间失败: {}", e);
                }
                state.active_inference_models.remove(&model_id);
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
                let mut state = state.write().await;
                state.active_inference_models.remove(&model_id);
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

    result
}
