// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { apiClient } from '@/api/client';
import { useToastStore } from '@/store/toastStore';
import ModelsPage from './ModelsPage';
import type { InstalledModel } from '@/lib/modelTypes';

/**
 * ModelsPage 活跃模型选择集成测试。
 * Validates: Requirements 2.5, 2.6, 2.7
 */

vi.mock('@/api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  setApiBaseUrl: vi.fn(),
  getApiBaseUrl: () => '',
  apiUrl: (path: string) => path,
  longRequestTimeoutMs: () => 300000,
}));

const mockGet = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = apiClient.post as unknown as ReturnType<typeof vi.fn>;

const MODELS: InstalledModel[] = [
  { id: 'm-asr', name: 'WhisperX', model_type: 'asr', path: '/p', size_mb: 1500, files: 3, main_files: ['model.bin'], description: 'ASR', version: '1', quant: 'q4', source: 'local' },
  { id: 'm-tts', name: 'CosyTTS', model_type: 'tts', path: '/t', size_mb: 900, files: 2, main_files: ['tts.bin'], description: 'TTS', version: '1', quant: 'q4', source: 'local' },
];

const DISK = { total_bytes: 1, free_bytes: 1, used_bytes: 1, total_text: '', free_text: '', used_text: '', used_percent: 60 };

let currentConfig: Record<string, unknown> = { current_models: {}, model_meta: {} };

function routeGet(url: string) {
  if (url === '/api/models') return Promise.resolve({ data: MODELS });
  if (url === '/api/config') return Promise.resolve({ data: currentConfig });
  if (url === '/api/downloads/presets') return Promise.resolve({ data: [] });
  if (url === '/api/downloads') return Promise.resolve({ data: [] });
  if (url === '/api/system/disk') return Promise.resolve({ data: DISK });
  if (url === '/api/system/gpu') return Promise.resolve({ data: null });
  return Promise.resolve({ data: {} });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ModelsPage)),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  currentConfig = { current_models: {}, model_meta: {} };
  mockGet.mockImplementation(routeGet);
  mockPost.mockResolvedValue({ data: {} });
});

describe('ModelsPage - 活跃模型', () => {
  it('calls set-model with model_type and id when 使用 clicked (Req 2.5/2.6)', async () => {
    // set-model 返回更新后的 config，将 tts 设为 m-tts
    mockPost.mockImplementation((url: string) => {
      if (url === '/api/config/set-model') {
        return Promise.resolve({ data: { current_models: { tts: 'm-tts' }, model_meta: {} } });
      }
      return Promise.resolve({ data: {} });
    });
    renderPage();
    // 等待非活跃模型卡片出现（初始无活跃模型，CosyTTS 仅在卡片中出现一次）
    await waitFor(() => expect(screen.getByText('CosyTTS')).toBeInTheDocument(), { timeout: 3000 });
    // 点击 CosyTTS 卡片的「使用」按钮
    const useButtons = screen.getAllByText('使用');
    fireEvent.click(useButtons[0]);
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/api/config/set-model', { model_type: 'tts', model_id: 'm-tts' }),
    );
  });

  it('does not render active banner card when active id is absent from models (Req 2.7)', async () => {
    // config 指向一个不存在于 models 的 id
    currentConfig = { current_models: { asr: 'ghost-model' }, model_meta: {} };
    renderPage();
    await waitFor(() => expect(screen.getByText('CosyTTS')).toBeInTheDocument(), { timeout: 3000 });
    // 「当前活跃模型」标题区存在，但没有「使用中」徽标（无有效活跃卡片）
    expect(screen.queryByText('使用中')).not.toBeInTheDocument();
  });

  it('highlights active model with 使用中 badge when config matches a model (Req 2.6)', async () => {
    currentConfig = { current_models: { asr: 'm-asr' }, model_meta: {} };
    renderPage();
    await waitFor(() => expect(screen.getByText('CosyTTS')).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByText('使用中')).toBeInTheDocument();
  });
});
