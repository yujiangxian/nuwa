//! 业务逻辑服务层。
//!
//! - `model_scanner`: 扫描 models/ 目录
//! - `downloader`: 模型下载封装

pub mod downloader;
pub mod inference;
pub mod model_scanner;
pub mod repo_fetcher;
pub mod voice_library;
