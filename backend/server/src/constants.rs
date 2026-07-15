// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

//! 共享常量 — 全项目公用的 URL、默认路径等。

/// Ollama `/api/chat` 端点默认地址。可通过环境变量 `OLLAMA_CHAT_URL` 覆盖。
pub const OLLAMA_CHAT_URL: &str = "http://localhost:11434/api/chat";

/// Ollama `/api/tags` 端点默认地址（模型列表扫描）。
pub const OLLAMA_TAGS_URL: &str = "http://localhost:11434/api/tags";

/// 默认 TTS 参考音频路径 — 季莹莹 音色。
pub const DEFAULT_REF_AUDIO: &str = "assets/datasets/voices/jyy_000.wav";

/// 默认 TTS 参考音频对应文本。
pub const DEFAULT_REF_TEXT: &str = "穿上它能更好完成任务它很美";

/// Resolve the Ollama chat endpoint (env `OLLAMA_CHAT_URL` or [`OLLAMA_CHAT_URL`]).
pub fn ollama_chat_url() -> String {
    std::env::var("OLLAMA_CHAT_URL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| OLLAMA_CHAT_URL.to_string())
}

/// Resolve the Ollama tags endpoint.
///
/// If `OLLAMA_CHAT_URL` is set to a `.../api/chat` URL, derive tags as sibling
/// `.../api/tags`; otherwise use [`OLLAMA_TAGS_URL`] (or `OLLAMA_TAGS_URL` env).
pub fn ollama_tags_url() -> String {
    if let Ok(tags) = std::env::var("OLLAMA_TAGS_URL") {
        if !tags.trim().is_empty() {
            return tags;
        }
    }
    let chat = ollama_chat_url();
    if let Some(base) = chat.strip_suffix("/api/chat") {
        return format!("{base}/api/tags");
    }
    if let Some(base) = chat.strip_suffix("/api/chat/") {
        return format!("{base}/api/tags");
    }
    OLLAMA_TAGS_URL.to_string()
}

/// 获取 TTS 输出文件保留天数（环境变量 `NUWA_TTS_RETENTION_DAYS`，默认 7 天）。
/// 启动清理和手动清理使用同一阈值。
pub fn tts_retention_secs() -> u64 {
    let days: u64 = std::env::var("NUWA_TTS_RETENTION_DAYS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(7);
    days * 86400
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Env vars are process-global; serialize tests that mutate them.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn ollama_urls_default() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::remove_var("OLLAMA_CHAT_URL");
        std::env::remove_var("OLLAMA_TAGS_URL");
        assert_eq!(ollama_chat_url(), OLLAMA_CHAT_URL);
        assert_eq!(ollama_tags_url(), OLLAMA_TAGS_URL);
    }

    #[test]
    fn ollama_tags_derived_from_chat() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::set_var("OLLAMA_CHAT_URL", "http://remote:11434/api/chat");
        std::env::remove_var("OLLAMA_TAGS_URL");
        assert_eq!(ollama_tags_url(), "http://remote:11434/api/tags");
        std::env::remove_var("OLLAMA_CHAT_URL");
    }
}
