// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

//! 统一错误类型 — 使用 `thiserror` 定义 AppError 枚举，替换全项目中的
//! `Result<_, String>` 和 `.map_err(|e| format!(...))` 模式。
//!
//! 每个 variant 的 `#[from]` derive 和 `#[error]` display 确保与旧 String 消息
//! 向后兼容，同时让调用方可以做类型匹配的错误处理。

use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Ollama 错误: {0}")]
    Ollama(String),

    #[error("推理失败: {0}")]
    Inference(String),

    #[error("配置错误: {0}")]
    Config(String),

    #[error("下载失败: {0}")]
    Download(String),

    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),

    #[error("序列化错误: {0}")]
    Serialize(#[from] serde_json::Error),

    #[error("网络错误: {0}")]
    Network(#[from] reqwest::Error),

    #[error("未找到: {0}")]
    NotFound(String),
}

impl From<String> for AppError {
    fn from(s: String) -> Self {
        AppError::Inference(s)
    }
}

pub type AppResult<T> = Result<T, AppError>;
