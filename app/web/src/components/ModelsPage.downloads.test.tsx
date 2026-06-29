import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { apiClient } from '@/api/client';
import { useToastStore } from '@/store/toastStore';
import ModelsPage from './ModelsPage';
import type { DownloadTask } from '@/lib/modelTypes';

/**
 * ModelsPage「下载任务」集成测试。
 * Validates: Requirements 4.1, 4.9
 */

vi.mock('@/api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

const mockGet = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = apiClient.post as unknown as ReturnType<typeof vi.fn>;
const mockDelete = apiClient.delete as unknown as ReturnType<typeof vi.fn>;

const TASKS: DownloadTask[] = [
  { id: 't-run', mode: 'single', status: 'running', progress: 42, speed_mbps: 5, total_files: 0, completed_files: 0, url: 'http://x/run.bin', dest: 'run.bin', error: null },
  { id: 't-done', mode: 'single', status: 'completed', progress: 100, speed_mbps: 0, total_files: 0, completed_files: 0, url: 'http://x/done.bin', dest: 'done.bin', error: null },
  { id: 't-fail', mode: 'single', status: 'failed', progress: 10, speed_mbps: 0, total_files: 0, completed_files: 0, url: 'http://x/fail.bin', dest: 'fail.bin', error: 'boom' },
];

function routeGet(url: string) {
  if (url === '/api/models') return Promise.resolve({ data: [] });
  if (url === '/api/config') return Promise.resolve({ data: { current_models: {}, model_meta: {} } });
  if (url === '/api/downloads/presets') return Promise.resolve({ data: [] });
  if (url === '/api/downloads') return Promise.resolve({ data: TASKS });
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
  mockDelete.mockResolvedValue({ data: {} });
});

describe('ModelsPage - 下载任务', () => {
  it('renders download tasks with status labels (Req 4.1)', async () => {
    renderPage();
    fireEvent.click(screen.getByText('下载任务'));
    await waitFor(() => expect(screen.getByText('run.bin')).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByText('下载中')).toBeInTheDocument();
    expect(screen.getByText('已完成')).toBeInTheDocument();
    expect(screen.getByText('失败')).toBeInTheDocument();
  });

  it('cancels a running task via cancel endpoint (Req 4.9)', async () => {
    renderPage();
    fireEvent.click(screen.getByText('下载任务'));
    await waitFor(() => expect(screen.getByText('run.bin')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.click(screen.getByTitle('取消'));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/api/downloads/t-run/cancel'));
  });

  it('deletes a finished task via delete endpoint (Req 4.9)', async () => {
    renderPage();
    fireEvent.click(screen.getByText('下载任务'));
    await waitFor(() => expect(screen.getByText('done.bin')).toBeInTheDocument(), { timeout: 3000 });
    // 已完成与失败任务都可删除，第一个删除按钮对应已完成任务 t-done。
    fireEvent.click(screen.getAllByTitle('删除')[0]);
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('/api/downloads/t-done'));
  });

  it('retries a failed single task by re-posting the download (Req 4.9)', async () => {
    renderPage();
    fireEvent.click(screen.getByText('下载任务'));
    await waitFor(() => expect(screen.getByText('fail.bin')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.click(screen.getByTitle('重试'));
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/api/downloads', { url: 'http://x/fail.bin', dest: 'fail.bin' }),
    );
  });
});
