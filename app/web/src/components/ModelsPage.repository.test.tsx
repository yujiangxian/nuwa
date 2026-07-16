// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { apiClient } from '@/api/client';
import { useToastStore } from '@/store/toastStore';
import ModelsPage from './ModelsPage';
import type { PresetModel } from '@/lib/modelTypes';

/**
 * ModelsPage「模型仓库」集成测试。
 * Validates: Requirements 3.1, 3.8
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

const PRESETS: PresetModel[] = [
  { id: 'p1', name: 'PresetWhisper', model_type: 'asr', description: 'asr preset', size_mb: 200, source: 'hf', repo_id: 'r1', dest_dir: 'd1', is_downloaded: true },
  { id: 'p2', name: 'PresetTTS', model_type: 'tts', description: 'tts preset', size_mb: 100, source: 'hf', repo_id: 'r2', dest_dir: 'd2', is_downloaded: false },
];

function routeGet(url: string) {
  if (url === '/api/models') return Promise.resolve({ data: [] });
  if (url === '/api/config') return Promise.resolve({ data: { current_models: {}, model_meta: {} } });
  if (url === '/api/downloads/presets') return Promise.resolve({ data: PRESETS });
  if (url === '/api/downloads') return Promise.resolve({ data: [] });
  if (url === '/api/system/disk') return Promise.resolve({ data: null });
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
  mockGet.mockImplementation(routeGet);
  mockPost.mockResolvedValue({ data: {} });
});

describe('ModelsPage - 模型仓库', () => {
  it('renders presets with 已下载 marker on installed entries (Req 3.1)', async () => {
    renderPage();
    fireEvent.click(screen.getByText('模型仓库'));
    await waitFor(() => expect(screen.getByText('PresetWhisper')).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByText('PresetTTS')).toBeInTheDocument();
    // 已安装条目展示「已下载」标识（p1 is_downloaded=true）
    expect(screen.getAllByText('已下载').length).toBeGreaterThan(0);
  });

  it('calls refresh endpoint when 刷新 clicked (Req 3.8)', async () => {
    renderPage();
    fireEvent.click(screen.getByText('模型仓库'));
    await waitFor(() => expect(screen.getByText('PresetWhisper')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.click(screen.getByText('刷新'));
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/api/downloads/presets/refresh'),
    );
  });
});
