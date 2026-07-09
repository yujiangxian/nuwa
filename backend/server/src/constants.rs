// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

//! 共享常量 — 全项目公用的 URL、默认路径等。

/// Ollama `/api/chat` 端点地址。可通过环境变量 `OLLAMA_CHAT_URL` 覆盖。
pub const OLLAMA_CHAT_URL: &str = "http://localhost:11434/api/chat";

/// Ollama `/api/tags` 端点地址（模型列表扫描）。
pub const OLLAMA_TAGS_URL: &str = "http://localhost:11434/api/tags";

/// 默认 TTS 参考音频路径 — 季莹莹 音色。
pub const DEFAULT_REF_AUDIO: &str = "assets/datasets/voices/jyy_000.wav";

/// 默认 TTS 参考音频对应文本。
pub const DEFAULT_REF_TEXT: &str = "穿上它能更好完成任务它很美";

/// 获取 TTS 输出文件保留天数（环境变量 `NUWA_TTS_RETENTION_DAYS`，默认 7 天）。
/// 启动清理和手动清理使用同一阈值。
pub fn tts_retention_secs() -> u64 {
    let days: u64 = std::env::var("NUWA_TTS_RETENTION_DAYS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(7);
    days * 86400
}
