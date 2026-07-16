// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

//! 推理服务封装 — 通过子进程调用 Python 脚本进行 ASR/TTS 推理

use std::path::{Path, PathBuf};

use crate::util;
use crate::util::gpu_backend::{self, GpuBackend};

/// Inject `NUWA_GPU_BACKEND` (and default `CUDA_VISIBLE_DEVICES` for CUDA) into a subprocess.
fn apply_inference_env(cmd: &mut tokio::process::Command) -> GpuBackend {
    let backend = gpu_backend::resolve_backend();
    cmd.env("NUWA_GPU_BACKEND", backend.as_str());
    if backend == GpuBackend::Cuda && std::env::var_os("CUDA_VISIBLE_DEVICES").is_none() {
        cmd.env("CUDA_VISIBLE_DEVICES", "0");
    }
    backend
}

/// Maximum wall-clock time for a single inference subprocess (seconds).
/// Beyond this the subprocess is killed and an error returned to the caller.
const INFERENCE_TIMEOUT_SECS: u64 = 600; // 10 minutes

/// Truncate user-facing text for logs (avoid dumping full transcripts / model stdout).
fn redact_preview(s: &str, max_chars: usize) -> String {
    let count = s.chars().count();
    if count <= max_chars {
        return s.to_string();
    }
    let preview: String = s.chars().take(max_chars).collect();
    format!("{preview}…({count} chars)")
}

/// Read WAV header and return duration in seconds.
/// WAV format: bytes 24-27 = sample rate, bytes 28-31 = byte rate,
/// data chunk size follows "data" tag.
pub fn wav_duration_secs(path: &Path) -> Option<f64> {
    let data = std::fs::read(path).ok()?;
    if data.len() < 44 || &data[0..4] != b"RIFF" || &data[8..12] != b"WAVE" {
        return None;
    }
    let byte_rate = u32::from_le_bytes([data[28], data[29], data[30], data[31]]) as f64;
    if byte_rate <= 0.0 {
        return None;
    }
    // Find "data" chunk
    let mut pos = 12;
    while pos + 8 <= data.len() {
        let tag = &data[pos..pos + 4];
        let size = u32::from_le_bytes([data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7]])
            as usize;
        if tag == b"data" {
            return Some(size as f64 / byte_rate);
        }
        pos += 8 + size;
    }
    None
}

/// 清理所有 `util::project_root()` / `util::python_exe()` / `util::resolve_path()` 调用，统一走 `util` 模块。
/// 解析模型 ID 到实际路径和脚本
pub fn resolve_asr_model(model_id: &str) -> Result<(&'static str, PathBuf), String> {
    match model_id {
        "asr/paraformer-large" => Ok((
            "scripts/inference_asr_paraformer.py",
            util::project_root().join("models/asr/paraformer-large/damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch"),
        )),
        "asr/whisper-tiny" => Ok((
            "scripts/inference_asr_whisper.py",
            util::project_root().join("models/asr/whisper-tiny"),
        )),
        "asr/glm-asr-nano" => Ok((
            "scripts/inference_asr_glm.py",
            util::project_root().join("models/asr/glm-asr-nano"),
        )),
        "asr/qwen3-asr-0.6b" => Ok((
            "scripts/inference_asr_qwen3.py",
            util::project_root().join("models/asr/qwen3-asr-0.6b/Qwen/Qwen3-ASR-0___6B"),
        )),
        _ => Err(format!("不支持的 ASR 模型: {}", model_id)),
    }
}

pub fn resolve_tts_model(model_id: &str) -> Result<(&'static str, PathBuf), String> {
    match model_id {
        // CosyVoice2-0.5B：zero-shot 声音克隆效果第一梯队，复用同一推理脚本
        // （脚本按目录下 cosyvoice2.yaml 自动选用 CosyVoice2 类、采样率 24000、GPU fp16）。
        "tts/cosyvoice2" => Ok((
            "scripts/inference_tts_cosyvoice.py",
            util::project_root().join("models/tts/cosyvoice2/iic/CosyVoice2-0.5B"),
        )),
        "tts/cosyvoice3" => Ok((
            "scripts/inference_tts_cosyvoice.py",
            util::project_root().join("models/tts/cosyvoice3/iic/CosyVoice-300M"),
        )),
        "tts/glm-tts-full" => Ok((
            "scripts/inference_tts_glm.py",
            util::project_root().join("models/tts/glm-tts-full"),
        )),
        // 向后兼容旧 ID
        "tts/glm-tts" => Ok((
            "scripts/inference_tts_glm.py",
            util::project_root().join("models/tts/glm-tts-full"),
        )),
        "tts/qwen3-tts-base" => Ok((
            "scripts/inference_tts_qwen3.py",
            util::project_root().join("models/tts/qwen3-tts-base"),
        )),
        "tts/openvoice" => Ok((
            "scripts/inference_tts_openvoice.py",
            util::project_root().join("models/tts/openvoice"),
        )),
        _ => Err(format!("不支持的 TTS 模型: {}", model_id)),
    }
}

/// ASR 语音识别
pub async fn transcribe(audio_path: &Path, model_id: &str) -> Result<String, String> {
    let _started = std::time::Instant::now();
    let audio_path = util::resolve_path(audio_path);
    let (script, model_path) = resolve_asr_model(model_id)?;
    let script_path = util::project_root().join(script);
    let output_json = std::env::temp_dir().join(format!("nuwa_asr_{}.json", uuid::Uuid::new_v4()));

    tracing::info!(
        "ASR 推理: model={} audio={} script={}",
        model_id,
        audio_path.display(),
        script_path.display()
    );

    let mut cmd = tokio::process::Command::new(util::python_exe());
    let backend = apply_inference_env(&mut cmd);
    tracing::info!(backend = backend.as_str(), "ASR inference Python env");

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(INFERENCE_TIMEOUT_SECS),
        cmd.arg(&script_path)
            .arg("--model-path")
            .arg(&model_path)
            .arg("--audio")
            .arg(audio_path)
            .arg("--output-json")
            .arg(&output_json)
            .current_dir(util::project_root())
            .output(),
    )
    .await
    .map_err(|_| format!("ASR 推理超时 (>{INFERENCE_TIMEOUT_SECS}s)"))?
    .map_err(|e| format!("启动 ASR 子进程失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::error!(stderr = %redact_preview(&stderr, 500), "ASR subprocess failed");
        return Err(format!("ASR 推理失败: {}", stderr.truncate(500)));
    }

    let result_text = tokio::fs::read_to_string(&output_json)
        .await
        .map_err(|e| format!("读取 ASR 结果失败: {}", e))?;

    // 清理临时文件
    let _ = tokio::fs::remove_file(&output_json).await;

    let result: serde_json::Value =
        serde_json::from_str(&result_text).map_err(|e| format!("解析 ASR 结果失败: {}", e))?;

    if result.get("success").and_then(|v| v.as_bool()) == Some(true) {
        let text = result.get("text").and_then(|v| v.as_str()).unwrap_or("");
        let time_sec = result
            .get("inference_time_sec")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        tracing::info!(
            chars = text.chars().count(),
            time_sec,
            preview = %redact_preview(text, 48),
            "ASR 完成"
        );
        Ok(text.to_string())
    } else {
        let error = result
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("未知错误");
        Err(format!("ASR 推理错误: {}", error))
    }
}

/// TTS 语音合成
pub async fn synthesize(
    text: &str,
    model_id: &str,
    ref_audio: &Path,
    ref_text: &str,
    output_path: &Path,
) -> Result<(), String> {
    let started = std::time::Instant::now();
    let ref_audio = util::resolve_path(ref_audio);
    let output_path = util::resolve_path(output_path);
    let (script, model_path) = resolve_tts_model(model_id)?;
    let script_path = util::project_root().join(script);
    let output_json = std::env::temp_dir().join(format!("nuwa_tts_{}.json", uuid::Uuid::new_v4()));

    // 确保输出目录存在
    if let Some(parent) = output_path.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }

    tracing::info!(
        "TTS 推理: model={} text_len={} ref={} output={}",
        model_id,
        text.len(),
        ref_audio.display(),
        output_path.display()
    );

    let mut cmd = tokio::process::Command::new(util::python_exe());
    let backend = apply_inference_env(&mut cmd);
    tracing::info!(backend = backend.as_str(), "TTS inference Python env");

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(INFERENCE_TIMEOUT_SECS),
        cmd.arg(&script_path)
            .arg("--model-path")
            .arg(&model_path)
            .arg("--text")
            .arg(text)
            .arg("--ref-audio")
            .arg(ref_audio)
            .arg("--ref-text")
            .arg(ref_text)
            .arg("--output")
            .arg(&output_path)
            .arg("--output-json")
            .arg(&output_json)
            .current_dir(util::project_root())
            .output(),
    )
    .await
    .map_err(|_| format!("TTS 推理超时 (>{INFERENCE_TIMEOUT_SECS}s)"))?
    .map_err(|e| format!("启动 TTS 子进程失败: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    tracing::debug!(stdout = %redact_preview(&stdout, 200), "TTS Python stdout");
    if !stderr.trim().is_empty() {
        tracing::debug!(stderr = %redact_preview(&stderr, 200), "TTS Python stderr");
    }

    if !output.status.success() {
        tracing::error!(stderr = %redact_preview(&stderr, 500), "TTS subprocess failed");
        return Err(format!("TTS 推理失败: {}", stderr.truncate(500)));
    }

    let elapsed = started.elapsed();
    tracing::info!(duration_ms = elapsed.as_millis(), model = %model_id, "TTS complete");

    let result_text = tokio::fs::read_to_string(&output_json)
        .await
        .map_err(|e| format!("读取 TTS 结果失败: {}", e))?;

    let _ = tokio::fs::remove_file(&output_json).await;

    let result: serde_json::Value =
        serde_json::from_str(&result_text).map_err(|e| format!("解析 TTS 结果失败: {}", e))?;

    if result.get("success").and_then(|v| v.as_bool()) == Some(true) {
        // 验证输出文件确实存在
        if !output_path.exists() {
            return Err(format!(
                "TTS 推理报告成功，但输出文件不存在: {}",
                output_path.display()
            ));
        }
        let time_sec = result
            .get("inference_time_sec")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        tracing::info!("TTS 完成: {} ({}s)", output_path.display(), time_sec);
        Ok(())
    } else {
        let error = result
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("未知错误");
        Err(format!("TTS 推理错误: {}", error))
    }
}

/// TTS 多段合成（脚本模式，支持情绪标签）
pub async fn synthesize_script(
    segments_json: &str,
    model_id: &str,
    ref_audio: &Path,
    ref_text: &str,
    output_path: &Path,
) -> Result<(), String> {
    let started = std::time::Instant::now();
    let ref_audio = util::resolve_path(ref_audio);
    let output_path = util::resolve_path(output_path);
    let (_script, model_path) = resolve_tts_model(model_id)?;
    let script_path = util::project_root().join("scripts/inference_tts_glm_script.py");
    let output_json =
        std::env::temp_dir().join(format!("nuwa_tts_script_{}.json", uuid::Uuid::new_v4()));

    if let Some(parent) = output_path.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }

    tracing::info!(
        "TTS 多段合成: model={} ref={} output={}",
        model_id,
        ref_audio.display(),
        output_path.display()
    );

    let mut cmd = tokio::process::Command::new(util::python_exe());
    let backend = apply_inference_env(&mut cmd);
    tracing::info!(backend = backend.as_str(), "TTS script inference Python env");

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(INFERENCE_TIMEOUT_SECS),
        cmd.arg(&script_path)
            .arg("--model-path")
            .arg(&model_path)
            .arg("--segments")
            .arg(segments_json)
            .arg("--ref-audio")
            .arg(&ref_audio)
            .arg("--ref-text")
            .arg(ref_text)
            .arg("--output")
            .arg(&output_path)
            .arg("--output-json")
            .arg(&output_json)
            .current_dir(util::project_root())
            .output(),
    )
    .await
    .map_err(|_| format!("TTS 多段合成超时 (>{INFERENCE_TIMEOUT_SECS}s)"))?
    .map_err(|e| format!("启动 TTS 多段合成子进程失败: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    tracing::debug!(stdout = %redact_preview(&stdout, 200), "TTS script stdout");
    if !stderr.trim().is_empty() {
        tracing::debug!(stderr = %redact_preview(&stderr, 200), "TTS script stderr");
    }

    if !output.status.success() {
        tracing::error!(stderr = %redact_preview(&stderr, 500), "TTS script subprocess failed");
        return Err(format!("TTS 多段合成失败: {}", stderr.truncate(500)));
    }

    let elapsed = started.elapsed();
    tracing::info!(duration_ms = elapsed.as_millis(), model = %model_id, "TTS script complete");

    let result_text = tokio::fs::read_to_string(&output_json)
        .await
        .map_err(|e| format!("读取 TTS 多段合成结果失败: {}", e))?;

    let _ = tokio::fs::remove_file(&output_json).await;

    let result: serde_json::Value = serde_json::from_str(&result_text)
        .map_err(|e| format!("解析 TTS 多段合成结果失败: {}", e))?;

    if result.get("success").and_then(|v| v.as_bool()) == Some(true) {
        if !output_path.exists() {
            return Err(format!(
                "TTS 多段合成报告成功，但输出文件不存在: {}",
                output_path.display()
            ));
        }
        let time_sec = result
            .get("inference_time_sec")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let dur = result
            .get("duration_sec")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        tracing::info!(
            "TTS 多段合成完成: {} ({}s, 推理 {}s)",
            output_path.display(),
            dur,
            time_sec
        );
        Ok(())
    } else {
        let error = result
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("未知错误");
        Err(format!("TTS 多段合成错误: {}", error))
    }
}

/// 检查模型是否可用于推理
pub fn is_model_supported(model_id: &str) -> bool {
    resolve_asr_model(model_id).is_ok() || resolve_tts_model(model_id).is_ok()
}

trait StringTruncate {
    fn truncate(&self, max_len: usize) -> String;
}

impl StringTruncate for str {
    fn truncate(&self, max_len: usize) -> String {
        let char_count = self.chars().count();
        if char_count > max_len {
            format!("{}...", self.chars().take(max_len).collect::<String>())
        } else {
            self.to_string()
        }
    }
}
