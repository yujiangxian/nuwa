//! 配置持久化 — 读写 JSON 配置文件

use crate::state::AppConfig;

const CONFIG_FILE: &str = "config.json";

/// 获取配置文件路径（与可执行文件同级目录）
pub fn config_path() -> std::path::PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(CONFIG_FILE)
}

/// 从文件加载配置
pub fn load_config() -> Option<AppConfig> {
    let path = config_path();
    if !path.exists() {
        tracing::info!("配置文件不存在，使用默认配置: {}", path.display());
        return None;
    }
    let content = std::fs::read_to_string(&path).ok()?;
    let mut cfg = match serde_json::from_str::<AppConfig>(&content) {
        Ok(cfg) => cfg,
        Err(e) => {
            tracing::warn!("配置文件解析失败: {}，使用默认配置", e);
            return None;
        }
    };

    // ========== 向后兼容：旧版 current_model_id 迁移 ==========
    if let Some(ref old_id) = cfg.current_model_id {
        if cfg.current_llm_model.is_none() && old_id.starts_with("llm/") {
            cfg.current_llm_model = Some(old_id.clone());
            cfg.current_models.insert("llm".to_string(), old_id.clone());
            tracing::info!("配置迁移: current_model_id ({}) → current_llm_model", old_id);
        }
        if cfg.current_asr_model.is_none() && old_id.starts_with("asr/") {
            cfg.current_asr_model = Some(old_id.clone());
            cfg.current_models.insert("asr".to_string(), old_id.clone());
            tracing::info!("配置迁移: current_model_id ({}) → current_asr_model", old_id);
        }
        if cfg.current_tts_model.is_none() && old_id.starts_with("tts/") {
            cfg.current_tts_model = Some(old_id.clone());
            cfg.current_models.insert("tts".to_string(), old_id.clone());
            tracing::info!("配置迁移: current_model_id ({}) → current_tts_model", old_id);
        }
        cfg.current_model_id = None;
        // 立即保存迁移后的配置
        let _ = save_config(&cfg);
    }

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

/// 保存配置到文件
pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let path = config_path();
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("序列化配置失败: {}", e))?;
    std::fs::write(&path, content)
        .map_err(|e| format!("写入配置文件失败 ({}): {}", path.display(), e))?;
    tracing::info!("配置已保存到 {}", path.display());
    Ok(())
}
