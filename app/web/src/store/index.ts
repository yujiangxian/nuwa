// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { create } from 'zustand';
import { apiClient } from '@/api/client';

// ==================== Types ====================

export interface Model {
  id: string;
  name: string;
  version: string;
  quant: string;
  path: string;
  sample_rate: number;
  /** 模型类型（asr/tts/llm），对齐后端 `Model.model_type` */
  model_type: string;
  /** 模型总大小(MB) */
  size_mb?: number;
  description?: string;
  source?: string;
  context_length?: number;
}

export interface Voice {
  id: string;
  name: string;
  path: string;
  transcript: string | null;
  sample_rate: number;
  /** 音频时长（秒）。WAV 精确解析；非 WAV 未知时为 null。新增可选字段。 */
  duration_seconds?: number | null;
}

/**
 * 前端 `AppConfig`，与后端实际使用字段对齐（已移除 VoxCPM 遗留字段）。
 * 后端 `AppConfig` 序列化层对多余/缺失字段容忍，前端仅声明真实使用的字段。
 */
export interface AppConfig {
  models_dir: string;
  output_dir: string;
  voices_dir: string;
  backend: string;
  threads: number;
  default_cfg: number;
  default_timesteps: number;
  current_llm_model: string | null;
  current_asr_model: string | null;
  current_tts_model: string | null;
  current_models: Record<string, string>;
  current_voice_id: string | null;
  theme: string;
  model_meta?: Record<string, { notes: string; tags: string[]; last_used: number | null }>;
}

// ==================== Config Store ====================

interface ConfigState {
  config: AppConfig | null;
  isLoading: boolean;
  initConfig: () => Promise<void>;
  updateConfig: (cfg: Partial<AppConfig>) => Promise<void>;
}

const defaultConfig: AppConfig = {
  models_dir: 'models',
  output_dir: 'output',
  voices_dir: 'assets/datasets/voices',
  backend: 'cpu',
  threads: 8,
  default_cfg: 1.0,
  default_timesteps: 20,
  current_llm_model: null,
  current_asr_model: null,
  current_tts_model: null,
  current_models: {},
  current_voice_id: null,
  theme: 'ocean',
};

export const useConfigStore = create<ConfigState>((set, get) => ({
  config: null,
  isLoading: false,

  async initConfig() {
    set({ isLoading: true });
    try {
      const { data } = await apiClient.get<AppConfig>('/api/config');
      set({ config: data, isLoading: false });
    } catch {
      // 后端未就绪时使用默认配置
      set({ config: defaultConfig, isLoading: false });
    }
  },

  async updateConfig(cfg) {
    const current = get().config || defaultConfig;
    const merged = { ...current, ...cfg };
    await apiClient.post('/api/config', merged);
    set({ config: merged });
  },
}));

// ==================== Model Store ====================

interface ModelState {
  models: Model[];
  voices: Voice[];
  isScanning: boolean;
  fetchModels: () => Promise<void>;
  fetchVoices: () => Promise<void>;
  scanModels: () => Promise<void>;
}

export const useModelStore = create<ModelState>((set) => ({
  models: [],
  voices: [],
  isScanning: false,

  async fetchModels() {
    const { data } = await apiClient.get<Model[]>('/api/models');
    set({ models: data });
  },

  async fetchVoices() {
    const { data } = await apiClient.get<Voice[]>('/api/voices');
    set({ voices: data });
  },

  async scanModels() {
    set({ isScanning: true });
    const { data } = await apiClient.post<Model[]>('/api/models/scan');
    set({ models: data, isScanning: false });
  },
}));
