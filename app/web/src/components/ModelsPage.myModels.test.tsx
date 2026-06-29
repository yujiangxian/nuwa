import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { apiClient } from '@/api/client';
import { useToastStore } from '@/store/toastStore';
import ModelsPage from './ModelsPage';
import type { InstalledModel } from '@/lib/modelTypes';

/**
 * ModelsPage「我的模型」集成测试。
 * Validates: Requirements 1.1, 1.2, 1.9, 7.1, 7.5, 9.1
 */

vi.mock('@/api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

const mockGet = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = apiClient.post as unknown as ReturnType<typeof vi.fn>;

const MODELS: InstalledModel[] = [
  { id: 'm-asr', name: 'WhisperX', model_type: 'asr', path: '/p', size_mb: 1500, files: 3, main_files: ['model.bin'], description: 'ASR model', version: '1', quant: 'q4', source: 'local' },
  { id: 'm-llm', name: 'QwenLLM', model_type: 'llm', path: '/q', size_mb: 8000, files: 5, main_files: ['weights.bin'], description: 'LLM', version: '2', quant: 'q8', source: 'local' },
];

const CONFIG = { current_models: { asr: 'm-asr' }, current_asr_model: 'm-asr', current_tts_model: null, current_llm_model: null, model_meta: {} };
const DISK = { total_bytes: 1, free_bytes: 1, used_bytes: 1, total_text: '', free_text: '', used_text: '', used_percent: 60 };

function routeGet(url: string) {
  if (url === '/api/models') return Promise.resolve({ data: MODELS });
  if (url === '/api/config') return Promise.resolve({ data: CONFIG });
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

function toastMessages() {
  return useToastStore.getState().toasts.map((t) => t.message);
}

beforeEach(() => {
  vi.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  mockGet.mockImplementation(routeGet);
  mockPost.mockResolvedValue({ data: {} });
});

describe('ModelsPage - 我的模型', () => {
  it('renders header and model list after fetch (Req 1.1)', async () => {
    renderPage();
    expect(screen.getByText('模型管理')).toBeInTheDocument();
    // QwenLLM 只出现在模型卡片（非活跃，不在活跃横幅），用作唯一标识。
    await waitFor(() => expect(screen.getByText('QwenLLM')).toBeInTheDocument(), { timeout: 3000 });
    // WhisperX 同时出现在活跃横幅与模型卡片，故用 getAllByText。
    expect(screen.getAllByText('WhisperX').length).toBeGreaterThan(0);
  });

  it('shows loading state before models resolve (Req 1.2)', async () => {
    let resolveModels: (v: unknown) => void = () => {};
    mockGet.mockImplementation((url: string) => {
      if (url === '/api/models') return new Promise((res) => { resolveModels = res; });
      return routeGet(url);
    });
    renderPage();
    expect(screen.getByText('加载模型列表...')).toBeInTheDocument();
    resolveModels({ data: MODELS });
    await waitFor(() => expect(screen.getByText('QwenLLM')).toBeInTheDocument(), { timeout: 3000 });
  });

  it('renders disk usage bar and hides GPU bar when gpu is null (Req 7.1, 7.5)', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('QwenLLM')).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByText('磁盘空间')).toBeInTheDocument();
    expect(screen.queryByText('GPU 显存')).not.toBeInTheDocument();
  });

  it('triggers scan endpoint when 重新扫描 clicked (Req 1.9)', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('QwenLLM')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.click(screen.getByText('重新扫描'));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/api/models/scan'));
  });

  it('records error toast and exits loading when models fetch fails (Req 9.1)', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/api/models') return Promise.reject(new Error('network'));
      return routeGet(url);
    });
    renderPage();
    await waitFor(() => expect(toastMessages()).toContain('获取模型列表失败'), { timeout: 3000 });
    expect(screen.queryByText('加载模型列表...')).not.toBeInTheDocument();
  });
});
