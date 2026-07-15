// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

//! 模型扫描服务 — 扫描 models/ 目录下的二级子目录作为独立模型
//!
//! 扫描规则:
//! - 优先扫描 models/{type}/{model_name}/ 作为独立模型
//! - 如果 models/ 下的一级目录自身包含模型文件，也作为一个模型
//! - 自动从路径推断模型类型 (asr/tts/llm/other)

use std::path::Path;

use crate::state::ModelInfo;

const MODEL_EXTS: &[&str] = &[
    ".pth",
    ".ckpt",
    ".safetensors",
    ".gguf",
    ".bin",
    ".onnx",
    ".pt",
];
const SKIP_PATTERNS: &[&str] = &[
    ".cache",
    ".git",
    "__pycache__",
    ".mdl",
    ".msc",
    ".mv",
    ".download",
];

/// 扫描指定目录下的所有模型
///
/// 扫描策略:
/// 1. 遍历 models/ 下的一级子目录 (asr, tts, llm, gpt-sovits 等)
/// 2. 对每个一级子目录，遍历其下的二级子目录，每个作为独立模型
/// 3. 如果一级子目录自身有模型文件（无二级子目录或二级子目录为空），则自身也作为模型
pub fn scan_models_dir(models_dir: &Path) -> Vec<ModelInfo> {
    let mut models = Vec::new();

    let entries = match std::fs::read_dir(models_dir) {
        Ok(e) => e,
        Err(_) => return models,
    };

    for entry in entries.filter_map(|e| e.ok()) {
        let type_dir = entry.path();
        if !type_dir.is_dir() {
            continue;
        }

        let type_name = type_dir
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase();

        // 推断一级目录的模型类型
        let parent_type = detect_type_from_name(&type_name);

        // 扫描二级子目录
        let mut has_submodels = false;
        if let Ok(sub_entries) = std::fs::read_dir(&type_dir) {
            for sub in sub_entries.filter_map(|e| e.ok()) {
                let model_dir = sub.path();
                if !model_dir.is_dir() {
                    continue;
                }

                let model_name = model_dir
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();

                // 跳过隐藏目录、缓存和源码目录
                if model_name.starts_with('.')
                    || model_name == "__pycache__"
                    || model_name.ends_with("_src")
                {
                    continue;
                }

                if let Some(model) =
                    scan_single_model(&model_dir, &type_dir, models_dir, &parent_type, &model_name)
                {
                    models.push(model);
                    has_submodels = true;
                }
            }
        }

        // 如果一级目录自身有模型文件但没有有效的二级模型，则把自身作为模型
        if !has_submodels {
            let dir_name = type_dir
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            if let Some(model) =
                scan_single_model(&type_dir, &type_dir, models_dir, &parent_type, &dir_name)
            {
                models.push(model);
            }
        }
    }

    // 按名称排序
    models.sort_by(|a, b| a.name.cmp(&b.name));
    models
}

/// 扫描单个模型目录
fn scan_single_model(
    model_dir: &Path,
    type_dir: &Path,
    models_dir: &Path,
    model_type: &str,
    raw_name: &str,
) -> Option<ModelInfo> {
    let mut total_size: u64 = 0;
    let mut file_count = 0i32;
    let mut main_files: Vec<String> = Vec::new();

    collect_files(
        model_dir,
        model_dir,
        &mut total_size,
        &mut file_count,
        &mut main_files,
    );

    if file_count == 0 {
        return None;
    }

    let size_mb = (total_size as f64) / (1024.0 * 1024.0);

    // 生成友好名称
    let name = generate_friendly_name(raw_name);

    // 生成描述
    let mut desc = if !main_files.is_empty() {
        format!("{} 个模型文件", main_files.len())
    } else {
        format!("{} 个文件", file_count)
    };
    if size_mb > 1024.0 {
        desc.push_str(&format!(" · {:.1} GB", size_mb / 1024.0));
    } else {
        desc.push_str(&format!(" · {:.1} MB", size_mb));
    }

    // 根据模型类型和目录名添加额外描述
    let extra_desc = describe_model(raw_name, model_type);
    if !extra_desc.is_empty() {
        desc.push_str(&format!(" · {}", extra_desc));
    }

    // 相对路径（基于项目根目录，即 models_dir 的父目录）
    let rel_path = model_dir
        .strip_prefix(models_dir.parent().unwrap_or(models_dir))
        .unwrap_or(model_dir)
        .to_string_lossy()
        .replace('\\', "/");

    Some(ModelInfo {
        id: format!("{}/{}", type_dir.file_name()?.to_string_lossy(), raw_name),
        name,
        version: "1.0".to_string(),
        quant: detect_quant(&main_files),
        path: rel_path,
        sample_rate: detect_sample_rate(raw_name),
        model_type: model_type.to_string(),
        size_mb: (size_mb * 100.0).round() / 100.0,
        files: file_count,
        main_files: main_files.into_iter().take(5).collect(),
        description: desc,
        source: "local".to_string(),
        context_length: None,
    })
}

/// 递归收集文件信息
fn collect_files(
    dir: &Path,
    root: &Path,
    total_size: &mut u64,
    file_count: &mut i32,
    main_files: &mut Vec<String>,
) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_dir() {
            collect_files(&path, root, total_size, file_count, main_files);
        } else {
            let rel = path.strip_prefix(root).unwrap_or(&path);
            let rel_str = rel.to_string_lossy();

            // 跳过缓存、元数据和下载临时文件
            if SKIP_PATTERNS.iter().any(|p| rel_str.contains(p)) {
                continue;
            }

            if let Ok(meta) = entry.metadata() {
                *total_size += meta.len();
            }
            *file_count += 1;

            if let Some(ext) = path.extension() {
                let ext_lower = ext.to_string_lossy().to_lowercase();
                if MODEL_EXTS
                    .iter()
                    .any(|e| e.trim_start_matches('.') == ext_lower)
                {
                    main_files.push(rel_str.replace('\\', "/"));
                }
            }
        }
    }
}

/// 从目录名推断模型类型
fn detect_type_from_name(name: &str) -> String {
    let d = name.to_lowercase();
    if d.contains("asr")
        || d.contains("whisper")
        || d.contains("paraformer")
        || d.contains("qwen-asr")
        || d.contains("glm-asr")
        || d.contains("firered")
        || d.contains("mimo")
        || d.contains("dolphin")
        || d.contains("stt")
        || d.contains("moonshine")
        || d.contains("wav2vec")
        || d.contains("parakeet")
    {
        "asr".to_string()
    } else if d.contains("tts")
        || d.contains("sovits")
        || d.contains("cosyvoice")
        || d.contains("glm-tts")
        || d.contains("fishspeech")
        || d.contains("indextts")
        || d.contains("chatterbox")
        || d.contains("mimo-tts")
        || d.contains("openvoice")
        || d.contains("qwen3-tts")
        || d.contains("megatts")
        || d.contains("maskgct")
        || d.contains("zonos")
        || d.contains("orpheus")
        || d.contains("tada")
        || d.contains("spark-tts")
        || d.contains("f5-tts")
        || d.contains("melotts")
        || d.contains("bark")
        || d.contains("parler")
        || d.contains("dia")
        || d.contains("kokoro")
        || d.contains("xtts")
        || d.contains("chattts")
    {
        "tts".to_string()
    } else if d.contains("llm") || d.contains("gemma") || d.contains("glm") {
        "llm".to_string()
    } else if d.contains("singer") || d.contains("svs") || d.contains("soulx") {
        "svs".to_string()
    } else if d.contains("music") || d.contains("musicgen") {
        "music".to_string()
    } else if d.contains("sound") || d.contains("audiogen") {
        "sound".to_string()
    } else if d.contains("enhance") || d.contains("deepfilter") || d.contains("denoise") {
        "enhance".to_string()
    } else if d.contains("vad") || d.contains("silero") {
        "vad".to_string()
    } else if d.contains("diarization") || d.contains("pyannote") {
        "diarization".to_string()
    } else if d.contains("speaker") || d.contains("ecapa") || d.contains("wavlm") {
        "speaker".to_string()
    } else if d.contains("emotion") || d.contains("emotion2vec") {
        "emotion".to_string()
    } else if d.contains("audio_lm") || d.contains("qwen-audio") || d.contains("moshi") {
        "audio_lm".to_string()
    } else if d.contains("translation") || d.contains("hibiki") {
        "translation".to_string()
    } else {
        "other".to_string()
    }
}

/// 生成友好显示名称
fn generate_friendly_name(raw: &str) -> String {
    let name = raw
        .replace(['_', '-'], " ")
        .split_whitespace()
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                None => String::new(),
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ");

    // 特殊名称映射
    match name.to_lowercase().as_str() {
        s if s.contains("glm asr nano") && !s.contains("full") => "GLM-ASR-Nano".to_string(),
        s if s.contains("glm asr nano full") => "GLM-ASR-Nano (Full)".to_string(),
        s if s.contains("paraformer") => "Paraformer-Large".to_string(),
        s if s.contains("qwen3 asr") => "Qwen3-ASR-0.6B".to_string(),
        s if s.contains("whisper tiny") => "Whisper Tiny".to_string(),
        s if s.contains("firered") => "FireRed-ASR".to_string(),
        s if s.contains("cosyvoice3") || s.contains("cosyvoice 3") => "CosyVoice-3".to_string(),
        s if s.contains("cosyvoice") && s.contains("src") => "CosyVoice (Source)".to_string(),
        s if s.contains("glm tts") && s.contains("full") => "GLM-TTS (Full)".to_string(),
        s if s.contains("glm tts") && !s.contains("full") => "GLM-TTS".to_string(),
        s if s.contains("qwen3 tts") && s.contains("base") => "Qwen3-TTS-Base".to_string(),
        s if s.contains("qwen3 tts") && s.contains("tokenizer") => {
            "Qwen3-TTS-Tokenizer".to_string()
        }
        s if s.contains("qwen3 tts") => "Qwen3-TTS".to_string(),
        s if s.contains("openvoice") => "OpenVoice".to_string(),
        s if s.contains("gpt sovits") && s.contains("pretrained") => {
            "GPT-SoVITS Pretrained".to_string()
        }
        s if s.contains("gpt sovits") => "GPT-SoVITS".to_string(),
        _ => name,
    }
}

/// 检测量化格式
fn detect_quant(main_files: &[String]) -> String {
    let has_safetensors = main_files.iter().any(|f| f.ends_with(".safetensors"));
    let has_gguf = main_files.iter().any(|f| f.ends_with(".gguf"));
    let has_pth = main_files
        .iter()
        .any(|f| f.ends_with(".pth") || f.ends_with(".pt"));
    let has_ckpt = main_files.iter().any(|f| f.ends_with(".ckpt"));
    let has_onnx = main_files.iter().any(|f| f.ends_with(".onnx"));

    if has_gguf {
        "GGUF".to_string()
    } else if has_safetensors {
        "Safetensors".to_string()
    } else if has_onnx {
        "ONNX".to_string()
    } else if has_ckpt {
        "Checkpoint".to_string()
    } else if has_pth {
        "PyTorch".to_string()
    } else {
        "fp16".to_string()
    }
}

/// 检测采样率（根据模型类型推断）
fn detect_sample_rate(name: &str) -> i32 {
    let n = name.to_lowercase();
    if n.contains("whisper") || n.contains("glm-asr") || n.contains("paraformer") {
        16000
    } else if n.contains("cosyvoice") || n.contains("glm-tts") || n.contains("qwen3-tts") {
        24000
    } else if n.contains("gpt-sovits") {
        32000
    } else {
        24000
    }
}

/// 根据模型名和类型生成额外描述
fn describe_model(name: &str, model_type: &str) -> String {
    let n = name.to_lowercase();
    match model_type {
        "asr" => {
            if n.contains("paraformer") {
                "FunASR · 中文语音识别".to_string()
            } else if n.contains("whisper") {
                "OpenAI · 多语言语音识别".to_string()
            } else if n.contains("glm-asr") {
                "智谱 · 端到端语音理解".to_string()
            } else if n.contains("qwen3-asr") {
                "阿里 · 多语言语音识别".to_string()
            } else if n.contains("firered") {
                "网易 · 语音识别".to_string()
            } else {
                String::new()
            }
        }
        "tts" => {
            if n.contains("cosyvoice") {
                "阿里 · 语音合成".to_string()
            } else if n.contains("glm-tts") {
                "智谱 · 语音合成".to_string()
            } else if n.contains("qwen3-tts") {
                "阿里 · 语音合成".to_string()
            } else if n.contains("openvoice") {
                "MyShell · 声音克隆".to_string()
            } else if n.contains("gpt-sovits") {
                "少样本声音克隆".to_string()
            } else {
                String::new()
            }
        }
        "llm" => "大语言模型".to_string(),
        "svs" => "歌声合成".to_string(),
        "music" => "音乐生成".to_string(),
        "sound" => "音效生成".to_string(),
        "enhance" => "语音增强".to_string(),
        "vad" => "语音活动检测".to_string(),
        "diarization" => "说话人分离".to_string(),
        "speaker" => "声纹识别".to_string(),
        "emotion" => "情感识别".to_string(),
        "audio_lm" => "音频语言模型".to_string(),
        "translation" => "语音翻译".to_string(),
        _ => String::new(),
    }
}

use crate::constants::ollama_tags_url;

// ========== Ollama 模型发现 ==========

use serde_json::Value;

/// Known context window sizes for common model families (tokens).
fn known_context_length(name: &str) -> Option<u32> {
    let lower = name.to_lowercase();
    if lower.contains("gemma3") {
        return Some(128_000);
    }
    if lower.contains("gemma2") || lower.contains("gemma") {
        return Some(8_192);
    }
    if lower.contains("llama3.3") || lower.contains("llama3.2") || lower.contains("llama3.1") {
        return Some(128_000);
    }
    if lower.contains("llama3") {
        return Some(8_192);
    }
    if lower.contains("llama2") {
        return Some(4_096);
    }
    if lower.contains("qwen3") {
        return Some(32_768);
    }
    if lower.contains("qwen2.5") || lower.contains("qwen2") {
        return Some(32_768);
    }
    if lower.contains("qwen") {
        return Some(8_192);
    }
    if lower.contains("mistral") || lower.contains("mixtral") {
        return Some(32_768);
    }
    if lower.contains("phi4") {
        return Some(16_384);
    }
    if lower.contains("phi3") {
        return Some(128_000);
    }
    if lower.contains("phi") {
        return Some(2_048);
    }
    if lower.contains("deepseek") {
        return Some(128_000);
    }
    if lower.contains("command-r") {
        return Some(128_000);
    }
    None
}

/// 扫描 Ollama 本地模型（通过 Ollama HTTP API）
pub async fn scan_ollama_models() -> Vec<crate::state::ModelInfo> {
    let mut models = Vec::new();

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(_) => return models,
    };

    let res = match client.get(ollama_tags_url()).send().await {
        Ok(r) => r,
        Err(_) => {
            tracing::debug!("Ollama 未运行或无法连接，跳过 LLM 模型扫描");
            return models;
        }
    };

    let body: Value = match res.json().await {
        Ok(v) => v,
        Err(_) => return models,
    };

    let models_arr = match body.get("models").and_then(|v| v.as_array()) {
        Some(arr) => arr,
        None => return models,
    };

    for m in models_arr {
        let name = m.get("name").and_then(|v| v.as_str()).unwrap_or("unknown");
        let size = m.get("size").and_then(|v| v.as_u64()).unwrap_or(0);
        let param_size = m
            .get("details")
            .and_then(|d| d.get("parameter_size"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let quant = m
            .get("details")
            .and_then(|d| d.get("quantization_level"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let family = m
            .get("details")
            .and_then(|d| d.get("family"))
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let size_mb = (size as f64) / (1024.0 * 1024.0);
        let size_desc = if size_mb > 1024.0 {
            format!("{:.1} GB", size_mb / 1024.0)
        } else {
            format!("{:.0} MB", size_mb)
        };

        let mut desc = format!("{} · Ollama 管理", size_desc);
        if !param_size.is_empty() {
            desc.push_str(&format!(" · {}", param_size));
        }
        if !quant.is_empty() {
            desc.push_str(&format!(" · {}", quant));
        }

        let friendly_name = name.split(':').next().unwrap_or(name);
        let friendly_name = match friendly_name.to_lowercase().as_str() {
            "gemma" | "gemma2" | "gemma3" => format!("Gemma ({})", name),
            "llama3" | "llama3.1" | "llama3.2" => format!("Llama 3 ({})", name),
            "qwen" | "qwen2" | "qwen2.5" | "qwen3" => format!("Qwen ({})", name),
            "phi3" | "phi4" => format!("Phi ({})", name),
            "mistral" | "mixtral" => format!("Mistral ({})", name),
            "deepseek" => format!("DeepSeek ({})", name),
            _ => name.to_string(),
        };

        models.push(crate::state::ModelInfo {
            id: format!("llm/{}", name),
            name: friendly_name,
            version: "1.0".to_string(),
            quant: quant.to_string(),
            path: format!("ollama://{}", name),
            sample_rate: 0,
            model_type: "llm".to_string(),
            size_mb: (size_mb * 100.0).round() / 100.0,
            files: 1,
            main_files: vec![family.to_string()],
            description: desc,
            source: "ollama".to_string(),
            context_length: known_context_length(name),
        });
    }

    models.sort_by(|a, b| a.name.cmp(&b.name));
    models
}
