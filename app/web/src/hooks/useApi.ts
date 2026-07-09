// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import type { Model, Voice, AppConfig } from '@/store';
import type {
  ModelType,
  PresetModel,
  DownloadTask,
  ModelMeta,
  DiskInfo,
  GpuInfo,
  InstalledModel,
} from '@/lib/modelTypes';

// ==================== Inference API 响应类型 ====================

/**
 * `POST /api/inference/asr/upload` 响应，对齐后端 `AsrUploadResponse`
 * (backend/server/src/handlers/inference.rs)。
 */
export interface AsrUploadResponse {
  success: boolean;
  text: string;
  error: string | null;
  /** 本次实际使用的 model_id（含 fallback 后的最终值） */
  model: string;
  /** handler 侧测量的墙钟耗时（毫秒） */
  elapsed_ms: number;
}

/**
 * `POST /api/inference/tts` 响应，对齐后端 `TtsResponse`
 * (backend/server/src/handlers/inference.rs)。
 */
export interface TtsResponse {
  success: boolean;
  output_path: string | null;
  duration_sec: number | null;
  error: string | null;
}

// ==================== Queries ====================

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: async () => {
      const { data } = await apiClient.get<AppConfig>('/api/config');
      return data;
    },
  });
}

export function useModels() {
  return useQuery({
    queryKey: ['models'],
    queryFn: async () => {
      const { data } = await apiClient.get<Model[]>('/api/models');
      return data;
    },
  });
}

export function useVoices() {
  return useQuery({
    queryKey: ['voices'],
    queryFn: async () => {
      const { data } = await apiClient.get<Voice[]>('/api/voices');
      return data;
    },
  });
}

// ==================== Mutations ====================

export function useScanModels() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post<Model[]>('/api/models/scan');
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['models'], data);
    },
  });
}

export function useDownloadModel() {
  return useMutation({
    mutationFn: async (params: { url: string; dest: string }) => {
      const { data } = await apiClient.post('/api/downloads', params);
      return data;
    },
  });
}

// ==================== Inference Mutations ====================

/**
 * ASR 上传转写：以 multipart 提交录音 Blob 或本地文件至
 * `POST /api/inference/asr/upload`，可选携带 `model_id`。
 */
export function useTranscribe() {
  return useMutation({
    mutationFn: async (args: { audio: Blob; filename?: string; modelId?: string }) => {
      const fd = new FormData();
      fd.append('audio', args.audio, args.filename ?? 'recording.webm');
      if (args.modelId) fd.append('model_id', args.modelId);
      const { data } = await apiClient.post<AsrUploadResponse>(
        '/api/inference/asr/upload',
        fd,
        // ASR 经 Python 子进程每次冷加载模型（实测 Paraformer 冷启 ~35s），
        // 叠加较长音频识别耗时，60s 易超时误报；放宽到 180s。
        { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 180000 }
      );
      return data;
    },
  });
}

/**
 * TTS 合成：以 JSON 提交 `text`/`model_id`/`ref_audio`/`ref_text` 至
 * `POST /api/inference/tts`。
 */
export function useSynthesize() {
  return useMutation({
    mutationFn: async (args: {
      text: string;
      modelId?: string;
      refAudio?: string;
      refText?: string;
    }) => {
      const { data } = await apiClient.post<TtsResponse>(
        '/api/inference/tts',
        {
          text: args.text,
          model_id: args.modelId,
          ref_audio: args.refAudio ?? '',
          ref_text: args.refText ?? '',
        },
        // TTS 经 Python 子进程每次冷加载模型（CosyVoice 冷启 ~20s）且当前 ONNX
        // 回退 CPU 推理（RTF≈3.9），合成一句正常长度回复实测可达 ~140s，
        // 120s 会在后端实际成功前 abort 并误报失败；放宽到 300s。
        { timeout: 300000 }
      );
      return data;
    },
  });
}

/**
 * 设置当前模型（ASR/TTS/LLM 通用）：提交 `{ model_type, model_id }` 至
 * `POST /api/config/set-model`，成功后用返回的 `AppConfig` 刷新 config 缓存。
 */
export function useSetModel() {
  const queryClient = useQueryClient();
  return useMutation({
    // model_type 放宽为全部 Model_Type（请求体形状 { model_type, model_id } 不变，契约兼容）。
    mutationFn: async (args: { model_type: ModelType; model_id: string }) => {
      const { data } = await apiClient.post<AppConfig>('/api/config/set-model', args);
      return data;
    },
    onSuccess: (cfg) => {
      queryClient.setQueryData(['config'], cfg);
    },
  });
}

// ==================== Model Management Queries ====================

/** 模型仓库预设列表（GET /api/downloads/presets）。 */
export function usePresets() {
  return useQuery({
    queryKey: ['presets'],
    queryFn: async () => {
      const { data } = await apiClient.get<PresetModel[]>('/api/downloads/presets');
      return data;
    },
  });
}

/**
 * 下载任务列表（GET /api/downloads）。
 * 轮询间隔由调用方通过 options.refetchInterval 控制（默认不轮询），
 * 组件挂载时启用 2s 轮询、卸载时随 query 卸载自动停止。
 */
export function useDownloads(options?: { refetchInterval?: number | false; enabled?: boolean }) {
  return useQuery({
    queryKey: ['downloads'],
    queryFn: async () => {
      const { data } = await apiClient.get<DownloadTask[]>('/api/downloads');
      return data;
    },
    refetchInterval: options?.refetchInterval ?? false,
    enabled: options?.enabled ?? true,
  });
}

/** 单模型元数据（GET /api/models/{id}/meta）。 */
export function useModelMeta(id: string | null) {
  return useQuery({
    queryKey: ['modelMeta', id],
    queryFn: async () => {
      const { data } = await apiClient.get<ModelMeta>(
        `/api/models/${encodeURIComponent(id as string)}/meta`,
      );
      return data;
    },
    enabled: !!id,
  });
}

/** 磁盘信息（GET /api/system/disk）。 */
export function useDiskInfo() {
  return useQuery({
    queryKey: ['system', 'disk'],
    queryFn: async () => {
      const { data } = await apiClient.get<DiskInfo>('/api/system/disk');
      return data;
    },
  });
}

/** GPU 信息（GET /api/system/gpu），可能返回 null。 */
export function useGpuInfo() {
  return useQuery({
    queryKey: ['system', 'gpu'],
    queryFn: async () => {
      const { data } = await apiClient.get<GpuInfo | null>('/api/system/gpu');
      return data;
    },
  });
}

/** 扫描进度（GET /api/models/scan-progress）。 */
export function useScanProgress(options?: { refetchInterval?: number | false; enabled?: boolean }) {
  return useQuery({
    queryKey: ['models', 'scan-progress'],
    queryFn: async () => {
      const { data } = await apiClient.get<{ scanning: boolean }>('/api/models/scan-progress');
      return data;
    },
    refetchInterval: options?.refetchInterval ?? false,
    enabled: options?.enabled ?? false,
  });
}

// ==================== Model Management Mutations ====================

/** 删除已安装模型（DELETE /api/models/{id}）；成功后失效 models/config 与磁盘信息。 */
export function useDeleteModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.delete(`/api/models/${encodeURIComponent(id)}`);
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['models'] });
      void queryClient.invalidateQueries({ queryKey: ['config'] });
      void queryClient.invalidateQueries({ queryKey: ['system', 'disk'] });
    },
  });
}

/** 保存模型备注（POST /api/models/{id}/meta）；成功后更新该模型 meta 缓存。 */
export function useSaveModelMeta() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; notes: string }) => {
      const { data } = await apiClient.post<ModelMeta>(
        `/api/models/${encodeURIComponent(args.id)}/meta`,
        { notes: args.notes },
      );
      return { id: args.id, meta: data };
    },
    onSuccess: ({ id, meta }) => {
      queryClient.setQueryData(['modelMeta', id], meta);
    },
  });
}

/** 刷新仓库列表（POST /api/downloads/presets/refresh）；成功后失效 presets。 */
export function useRefreshPresets() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post('/api/downloads/presets/refresh');
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['presets'] });
    },
  });
}

/** 创建单文件下载（POST /api/downloads）；成功后失效 downloads。 */
export function useCreateDownload() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { url: string; dest: string }) => {
      const { data } = await apiClient.post('/api/downloads', params);
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['downloads'] });
    },
  });
}

/** 创建批量下载（POST /api/downloads/batch）；成功后失效 downloads。 */
export function useBatchDownload() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      repo_id: string;
      source?: string;
      dest_dir: string;
      files?: string[];
    }) => {
      const { data } = await apiClient.post('/api/downloads/batch', params);
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['downloads'] });
    },
  });
}

/** 取消下载任务（POST /api/downloads/{id}/cancel）；成功后失效 downloads。 */
export function useCancelDownload() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post(`/api/downloads/${id}/cancel`);
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['downloads'] });
    },
  });
}

/** 重试下载任务（POST /api/downloads/{id}/retry）；成功后失效 downloads。 */
export function useRetryDownload() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post(`/api/downloads/${id}/retry`);
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['downloads'] });
    },
  });
}

/** 删除下载任务（DELETE /api/downloads/{id}）；成功后失效 downloads。 */
export function useDeleteDownload() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.delete(`/api/downloads/${id}`);
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['downloads'] });
    },
  });
}

/** 扫描模型目录（POST /api/models/scan）；返回扫描后的模型列表。 */
export function useScanModelsDir() {
  return useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post<InstalledModel[]>('/api/models/scan');
      return data;
    },
  });
}

// ==================== Voice Library Mutations ====================

/**
 * 试听音频 URL（经 Vite proxy 到后端 `GET /api/voices/{id}/audio`）。
 */
export function voiceAudioUrl(id: string): string {
  return `/api/voices/${id}/audio`;
}

/**
 * 上传创建参考音色：以 multipart 提交 `audio`（Blob + filename）、`name`、
 * `transcript` 至 `POST /api/voices/upload`，成功后失效 `['voices']` 触发列表刷新。
 */
export function useUploadVoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      audio: Blob;
      filename: string;
      name: string;
      transcript: string;
    }) => {
      const fd = new FormData();
      fd.append('audio', args.audio, args.filename);
      fd.append('name', args.name);
      fd.append('transcript', args.transcript);
      const { data } = await apiClient.post<Voice>('/api/voices/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
      });
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['voices'] });
    },
  });
}

/**
 * 删除参考音色：DELETE `/api/voices/{id}`，成功后失效 `['voices']` 触发列表刷新。
 */
export function useDeleteVoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.delete<{ success: boolean }>(`/api/voices/${id}`);
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['voices'] });
    },
  });
}
