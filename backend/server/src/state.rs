use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use crate::services::downloader::ChunkedDownloader;

/// 扫描进度
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanProgress {
    pub phase: String,
    pub current_dir: Option<String>,
    pub total_dirs: u32,
    pub processed_dirs: u32,
    pub models_found: u32,
}

/// 共享应用状态（被 Axum State 提取器使用）。
#[derive(Debug)]
pub struct AppState {
    /// 应用配置
    pub config: AppConfig,
    /// 已扫描到的模型列表
    pub models: Vec<ModelInfo>,
    /// 参考音频列表
    pub voices: Vec<VoiceInfo>,
    /// 下载任务（key = task_id）
    pub download_tasks: HashMap<String, DownloadTask>,
    /// 下载器实例（key = task_id），用于取消和进度查询
    pub downloaders: HashMap<String, Arc<ChunkedDownloader>>,
    /// 扫描进度
    pub scan_progress: Option<ScanProgress>,
    /// 正在推理中使用的模型 ID 集合
    pub active_inference_models: HashSet<String>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            config: AppConfig::default(),
            models: Vec::new(),
            voices: Vec::new(),
            download_tasks: HashMap::new(),
            downloaders: HashMap::new(),
            scan_progress: None,
            active_inference_models: HashSet::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelMeta {
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub last_used: Option<u64>,
}

impl Default for ModelMeta {
    fn default() -> Self {
        Self {
            notes: String::new(),
            tags: Vec::new(),
            last_used: None,
        }
    }
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    // ========== 路径配置 ==========
    pub models_dir: String,
    pub output_dir: String,
    pub voices_dir: String,

    // ========== 推理配置 ==========
    pub backend: String,
    pub threads: i32,
    pub default_cfg: f32,
    pub default_timesteps: i32,

    // ========== 模型配置（按类型分离）==========
    /// 当前 LLM 对话模型（Ollama 模型名）
    pub current_llm_model: Option<String>,
    /// 当前 ASR 语音识别模型
    pub current_asr_model: Option<String>,
    /// 当前 TTS 语音合成模型
    pub current_tts_model: Option<String>,
    /// 按 model_type → model_id 的映射（扩展字段）
    #[serde(default)]
    pub current_models: HashMap<String, String>,

    // ========== UI 配置 ==========
    pub current_mode: String,
    pub current_voice_id: Option<String>,
    pub theme: String,

    // ========== 模型元数据 ==========
    #[serde(default)]
    pub model_meta: HashMap<String, ModelMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub quant: String,
    pub path: String,
    pub sample_rate: i32,
    /// 模型类型: asr / tts / llm / other
    pub model_type: String,
    /// 模型总大小(MB)
    pub size_mb: f64,
    /// 文件数量
    pub files: i32,
    /// 主要模型文件列表
    pub main_files: Vec<String>,
    /// 描述
    pub description: String,
    /// 模型来源: "local" | "ollama"
    #[serde(default = "default_source")]
    pub source: String,
    /// 上下文窗口长度（tokens），LLM 模型此字段有效
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_length: Option<u32>,
}

fn default_source() -> String {
    "local".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceInfo {
    pub id: String,
    pub name: String,
    /// 项目可读的音频文件路径（作为 TTS ref_audio），语义不变
    pub path: String,
    pub transcript: Option<String>,
    pub sample_rate: i32,
    /// 新增：音频时长（秒）。WAV 精确解析；非 WAV 未知时为 None
    #[serde(default)]
    pub duration_seconds: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadTask {
    pub id: String,
    /// 下载模式: "single" | "batch"
    pub mode: String,
    /// 仓库ID (batch 模式)
    pub repo_id: Option<String>,
    /// 来源 (batch 模式)
    pub source: Option<String>,
    /// 目标目录 (batch 模式)
    pub dest_dir: Option<String>,
    /// 单文件模式: URL
    pub url: String,
    /// 单文件模式: 目标路径
    pub dest: String,
    /// 批量模式: 总文件数
    pub total_files: i32,
    /// 批量模式: 已完成文件数
    pub completed_files: i32,
    /// 批量模式: 当前正在下载的文件
    pub current_file: Option<String>,
    pub status: TaskStatus,
    pub progress: f64,
    pub speed_mbps: f64,
    pub error: Option<String>,
    /// 批量下载时记录失败的文件路径
    #[serde(default)]
    pub failed_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    Running,
    Completed,
    PartialFailed,
    Failed,
    Cancelled,
}
