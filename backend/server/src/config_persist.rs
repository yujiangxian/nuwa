// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

//! 配置持久化 — 读写 JSON 配置文件

use crate::state::AppConfig;

const CONFIG_FILE: &str = "config.json";

/// 获取配置文件路径。
///
/// 优先级：
/// 1. 环境变量 `NUWA_CONFIG`（指向具体 .json 文件路径）
/// 2. 项目根目录下的 `config.json`
pub fn config_path() -> std::path::PathBuf {
    if let Ok(p) = std::env::var("NUWA_CONFIG") {
        let path = std::path::PathBuf::from(&p);
        if path.exists() || path.parent().map(|d| d.exists()).unwrap_or(false) {
            return path;
        }
    }
    crate::util::project_root().join(CONFIG_FILE)
}

/// 从文件加载配置
pub fn load_config() -> Option<AppConfig> {
    let path = config_path();
    if !path.exists() {
        tracing::info!("配置文件不存在，使用默认配置: {}", path.display());
        return None;
    }
    let content = std::fs::read_to_string(&path).ok()?;

    // Warn about unknown config keys (won't break loading, but flags typos)
    if let Ok(raw) = serde_json::from_str::<serde_json::Value>(&content) {
        if let Some(obj) = raw.as_object() {
            let known = std::collections::HashSet::from([
                "models_dir",
                "output_dir",
                "voices_dir",
                "backend",
                "threads",
                "default_cfg",
                "default_timesteps",
                "current_llm_model",
                "current_asr_model",
                "current_tts_model",
                "current_models",
                "current_mode",
                "current_voice_id",
                "theme",
                "model_meta",
            ]);
            for key in obj.keys() {
                if !known.contains(key.as_str()) {
                    tracing::warn!(key = %key, "Unknown key in config.json — typo or legacy field?");
                }
            }
        }
    }

    let mut cfg = match serde_json::from_str::<AppConfig>(&content) {
        Ok(cfg) => cfg,
        Err(e) => {
            tracing::warn!("配置文件解析失败: {}，使用默认配置", e);
            return None;
        }
    };

    // ========== 同步旧字段到 current_models ==========
    if let Some(ref id) = cfg.current_llm_model {
        cfg.current_models.insert("llm".to_string(), id.clone());
    }
    if let Some(ref id) = cfg.current_asr_model {
        cfg.current_models.insert("asr".to_string(), id.clone());
    }
    if let Some(ref id) = cfg.current_tts_model {
        cfg.current_models.insert("tts".to_string(), id.clone());
    }

    tracing::info!("已从 {} 加载配置", path.display());
    Some(cfg)
}

/// 保存配置到文件（原子写入：先写临时文件，再 rename）。
pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let path = config_path();
    let content =
        serde_json::to_string_pretty(config).map_err(|e| format!("序列化配置失败: {}", e))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &content)
        .map_err(|e| format!("写入临时配置文件失败 ({}): {}", tmp.display(), e))?;
    std::fs::rename(&tmp, &path)
        .map_err(|e| format!("重命名配置文件失败 ({}): {}", path.display(), e))?;
    tracing::info!("配置已保存到 {}", path.display());
    Ok(())
}
