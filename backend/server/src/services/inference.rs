//! 推理服务封装 — 通过子进程调用 Python 脚本进行 ASR/TTS 推理

use std::path::{Path, PathBuf};

/// 项目根目录
fn project_root() -> PathBuf {
    // 基于 exe 路径推断项目根目录
    // exe: backend/server/target/debug/voxcpm-server.exe
    // → target/debug → target → server → backend → project root
    std::env::current_exe()
        .ok()
        .and_then(|exe| {
            exe.parent()      // target/debug
                .and_then(|p| p.parent())  // target
                .and_then(|p| p.parent())  // server
                .and_then(|p| p.parent())  // backend
                .and_then(|p| p.parent())  // project root
                .map(|p| p.to_path_buf())
        })
        .unwrap_or_else(|| {
            std::env::current_dir()
                .ok()
                .and_then(|cd| cd.parent().and_then(|p| p.parent()).map(|p| p.to_path_buf()))
                .unwrap_or_else(|| PathBuf::from("."))
        })
}

/// 获取 Python 可执行文件路径
/// 优先使用虚拟环境，fallback 到系统 python
fn python_exe() -> PathBuf {
    let candidates = [
        project_root().join("envs/ai/Scripts/python.exe"),
        project_root().join("ai_env/Scripts/python.exe"),
        PathBuf::from("python"),
        PathBuf::from("python3"),
    ];
    for c in &candidates {
        if c.exists() || c.to_string_lossy() == "python" || c.to_string_lossy() == "python3" {
            return c.clone();
        }
    }
    PathBuf::from("python")
}

/// 解析模型 ID 到实际路径和脚本
pub fn resolve_asr_model(model_id: &str) -> Result<(&'static str, PathBuf), String> {
    match model_id {
        "asr/paraformer-large" => Ok((
            "scripts/inference_asr_paraformer.py",
            project_root().join("models/asr/paraformer-large/damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch"),
        )),
        "asr/whisper-tiny" => Ok((
            "scripts/inference_asr_whisper.py",
            project_root().join("models/asr/whisper-tiny"),
        )),
        "asr/glm-asr-nano" => Ok((
            "scripts/inference_asr_glm.py",
            project_root().join("models/asr/glm-asr-nano"),
        )),
        "asr/qwen3-asr-0.6b" => Ok((
            "scripts/inference_asr_qwen3.py",
            project_root().join("models/asr/qwen3-asr-0.6b/Qwen/Qwen3-ASR-0___6B"),
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
            project_root().join("models/tts/cosyvoice2/iic/CosyVoice2-0.5B"),
        )),
        "tts/cosyvoice3" => Ok((
            "scripts/inference_tts_cosyvoice.py",
            project_root().join("models/tts/cosyvoice3/iic/CosyVoice-300M"),
        )),
        "tts/glm-tts" => Ok((
            "scripts/inference_tts_glm.py",
            project_root().join("models/tts/glm-tts"),
        )),
        "tts/qwen3-tts-base" => Ok((
            "scripts/inference_tts_qwen3.py",
            project_root().join("models/tts/qwen3-tts-base"),
        )),
        "tts/openvoice" => Ok((
            "scripts/inference_tts_openvoice.py",
            project_root().join("models/tts/openvoice"),
        )),
        _ => Err(format!("不支持的 TTS 模型: {}", model_id)),
    }
}

/// 将路径解析为绝对路径（基于项目根目录）
fn resolve_path(path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        project_root().join(path)
    }
}

/// ASR 语音识别
pub async fn transcribe(audio_path: &Path, model_id: &str) -> Result<String, String> {
    let audio_path = resolve_path(audio_path);
    let (script, model_path) = resolve_asr_model(model_id)?;
    let script_path = project_root().join(script);
    let output_json = std::env::temp_dir().join(format!("nuwa_asr_{}.json", uuid::Uuid::new_v4()));

    tracing::info!(
        "ASR 推理: model={} audio={} script={}",
        model_id,
        audio_path.display(),
        script_path.display()
    );

    let output = tokio::process::Command::new(python_exe())
        .arg(&script_path)
        .arg("--model-path")
        .arg(&model_path)
        .arg("--audio")
        .arg(audio_path)
        .arg("--output-json")
        .arg(&output_json)
        .current_dir(project_root())
        .output()
        .await
        .map_err(|e| format!("启动 ASR 子进程失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ASR 推理失败: {}", stderr.truncate(500)));
    }

    let result_text = tokio::fs::read_to_string(&output_json)
        .await
        .map_err(|e| format!("读取 ASR 结果失败: {}", e))?;

    // 清理临时文件
    let _ = tokio::fs::remove_file(&output_json).await;

    let result: serde_json::Value = serde_json::from_str(&result_text)
        .map_err(|e| format!("解析 ASR 结果失败: {}", e))?;

    if result.get("success").and_then(|v| v.as_bool()) == Some(true) {
        let text = result.get("text").and_then(|v| v.as_str()).unwrap_or("");
        let time_sec = result.get("inference_time_sec").and_then(|v| v.as_f64()).unwrap_or(0.0);
        tracing::info!("ASR 完成: {} ({}s)", text, time_sec);
        Ok(text.to_string())
    } else {
        let error = result.get("error").and_then(|v| v.as_str()).unwrap_or("未知错误");
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
    let ref_audio = resolve_path(ref_audio);
    let output_path = resolve_path(output_path);
    let (script, model_path) = resolve_tts_model(model_id)?;
    let script_path = project_root().join(script);
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

    let output = tokio::process::Command::new(python_exe())
        .arg(&script_path)
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
        .current_dir(project_root())
        .output()
        .await
        .map_err(|e| format!("启动 TTS 子进程失败: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    tracing::info!("TTS Python stdout: {}", stdout);
    tracing::info!("TTS Python stderr: {}", stderr);

    if !output.status.success() {
        return Err(format!("TTS 推理失败: {}", stderr.truncate(500)));
    }

    let result_text = tokio::fs::read_to_string(&output_json)
        .await
        .map_err(|e| format!("读取 TTS 结果失败: {}", e))?;

    let _ = tokio::fs::remove_file(&output_json).await;

    let result: serde_json::Value = serde_json::from_str(&result_text)
        .map_err(|e| format!("解析 TTS 结果失败: {}", e))?;

    if result.get("success").and_then(|v| v.as_bool()) == Some(true) {
        // 验证输出文件确实存在
        if !output_path.exists() {
            return Err(format!(
                "TTS 推理报告成功，但输出文件不存在: {}",
                output_path.display()
            ));
        }
        let time_sec = result.get("inference_time_sec").and_then(|v| v.as_f64()).unwrap_or(0.0);
        tracing::info!("TTS 完成: {} ({}s)", output_path.display(), time_sec);
        Ok(())
    } else {
        let error = result.get("error").and_then(|v| v.as_str()).unwrap_or("未知错误");
        Err(format!("TTS 推理错误: {}", error))
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
        if self.len() > max_len {
            format!("{}...", &self[..max_len])
        } else {
            self.to_string()
        }
    }
}
