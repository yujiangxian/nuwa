// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * model-management：模型管理领域的集中类型、枚举与状态集合常量。
 *
 * 作为所有 model-* 纯逻辑模块（modelFilter / modelSort / activeModel /
 * downloadTask / modelMeta / systemResource / modelFormat / installedModel）
 * 的类型基座。状态集合（ACTIVE_STATUS_SET / DONE_STATUS_SET）为下载任务状态
 * 判定的单一事实来源。
 *
 * 本模块不做任何 I/O，纯类型与常量声明，行为与既有 ModelsPage 内联结构一致。
 */

/** Model_Type 枚举：词汇表规定的取值集合（14 类）。 */
export type ModelType =
  | 'asr'
  | 'tts'
  | 'llm'
  | 'svs'
  | 'music'
  | 'sound'
  | 'enhance'
  | 'vad'
  | 'diarization'
  | 'speaker'
  | 'emotion'
  | 'audio_lm'
  | 'translation'
  | 'other';

/** 全部 Model_Type（稳定顺序，供遍历/生成器使用）。 */
export const MODEL_TYPES: readonly ModelType[] = [
  'asr',
  'tts',
  'llm',
  'svs',
  'music',
  'sound',
  'enhance',
  'vad',
  'diarization',
  'speaker',
  'emotion',
  'audio_lm',
  'translation',
  'other',
] as const;

/** 筛选用类型：具体 Model_Type 或 'all'（全部）。 */
export type ModelTypeFilter = ModelType | 'all';

/** Download_Status 枚举。 */
export type DownloadStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'partial_failed'
  | 'failed'
  | 'cancelled';

/** Active_Status_Set：进行中的任务状态（单一事实来源）。 */
export const ACTIVE_STATUS_SET: ReadonlySet<DownloadStatus> = new Set<DownloadStatus>([
  'pending',
  'running',
]);

/** Done_Status_Set：已结束的任务状态（单一事实来源）。 */
export const DONE_STATUS_SET: ReadonlySet<DownloadStatus> = new Set<DownloadStatus>([
  'completed',
  'partial_failed',
  'failed',
  'cancelled',
]);

/** Usage_Level：资源占用等级。 */
export type UsageLevel = 'high' | 'medium' | 'normal';

/** Installed_Model：本地已安装模型条目。 */
export interface InstalledModel {
  id: string;
  name: string;
  /** 后端可能返回枚举外字符串，渲染时回退 'other' */
  model_type: string;
  path: string;
  size_mb: number;
  files: number;
  main_files: string[];
  description: string;
  version: string;
  quant: string;
  /** 'ollama' 表示 Ollama_Model */
  source: string;
}

/** Preset_Model：模型仓库预设条目。 */
export interface PresetModel {
  id: string;
  name: string;
  model_type: string;
  description: string;
  size_mb: number;
  source: string;
  repo_id: string;
  dest_dir: string;
  note?: string;
  is_downloaded?: boolean;
  installed_model_id?: string | null;
}

/** Download_Task：下载任务。 */
export interface DownloadTask {
  id: string;
  /** 'batch' | 其它 */
  mode: string;
  status: DownloadStatus;
  progress: number;
  speed_mbps: number;
  total_files: number;
  completed_files: number;
  current_file?: string;
  repo_id?: string;
  source?: string;
  dest_dir?: string;
  url: string;
  dest: string;
  error: string | null;
}

/** Model_Meta：单模型元数据。 */
export interface ModelMeta {
  notes: string;
  tags: string[];
  /** Unix 秒级时间戳；null/缺失表示从未使用。 */
  last_used?: number | null;
}

/** 模型 id → Model_Meta 映射。 */
export type ModelMetaMap = Record<string, ModelMeta>;

/** Disk_Info：磁盘信息。 */
export interface DiskInfo {
  total_bytes: number;
  free_bytes: number;
  used_bytes: number;
  total_text: string;
  free_text: string;
  used_text: string;
  used_percent: number;
}

/** Gpu_Info：GPU 信息。 */
export interface GpuInfo {
  name: string;
  total_vram_mb: number;
  used_vram_mb: number;
  free_vram_mb: number;
  usage_percent: number;
}

/**
 * GET /api/config 中与当前模型选择相关的视图字段。
 * 后端同时返回 current_models 映射与旧字段 current_*_model，解析以前者为准。
 */
export interface ModelConfigView {
  current_asr_model?: string | null;
  current_tts_model?: string | null;
  current_llm_model?: string | null;
  current_models?: Record<string, string>;
  model_meta?: ModelMetaMap;
}

/** Active_Model_Map：每个 Model_Type 至多映射到一个模型 id。 */
export type ActiveModelMap = Partial<Record<ModelType, string>>;
