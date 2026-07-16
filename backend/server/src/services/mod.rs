// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

//! 业务逻辑服务层。
//!
//! - `model_scanner`: 扫描 models/ 目录
//! - `downloader`: 模型下载封装

pub mod agent_scheduler;
pub mod coding_cli;
pub mod downloader;
pub mod inference;
pub mod model_scanner;
pub mod repo_fetcher;
pub mod voice_library;
pub mod xai_client;
pub mod xai_oauth;
