import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { apiClient } from '@/api/client';
import { useToastStore } from '@/store/toastStore';
import ModelsPage from './ModelsPage';
import type { InstalledModel } from '@/lib/modelTypes';

/**
 * ModelsPage 删除确认、备注读写与错误处理集成测试。
 * Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 9.2
 */

vi.mock('@/api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

const mockGet = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = apiClient.post as unknown as ReturnType<typeof vi.fn>;
const mockDelete = apiClient.delete as unknown as ReturnType<typeof vi.fn>;

const MODELS: InstalledModel[] = [
  { id: 'local-1', name: 'LocalModel', model_type: 'asr', path: '/models/local-1', size_mb: 1500, files: 3, main_files: ['m.bin'], description: 'local', version: '1', quant: 'q4', source: 'local' },
  { id: 'oll-1', name: 'OllamaModel', model_type: 'llm', path: '/oll', size_mb: 4000, files: 1, main_files: ['o.bin'], description: 'ollama', version: '1', quant: 'q8', source: 'ollama' },
];

const DISK = { total_bytes: 1, free_bytes: 1, used_bytes: 1, total_text: '', free_text: '', used_text: '', used_percent: 60 };

function routeGet(url: string) {
  if (url === '/api/models') return Promise.resolve({ data: MODELS });
  if (url === '/api/config') return Promise.resolve({ data: { current_models: {}, model_meta: {} } });
  if (url === '/api/downloads/presets') return Promise.resolve({ data: [] });
  if (url === '/api/downloads') return Promise.resolve({ data: [] });
  if (url === '/api/system/disk') return Promise.resolve({ data: DISK });
  if (url === '/api/system/gpu') return Promise.resolve({ data: null });
  if (url.endsWith('/files')) return Promise.resolve({ data: { files: [] } });
  if (url.endsWith('/meta')) return Promise.resolve({ data: { notes: 'hi', tags: [] } });
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
  mockPost.mockResolvedValue({ data: { notes: 'updated', tags: [] } });
  mockDelete.mockResolvedValue({ data: { success: true } });
});

describe('ModelsPage - 删除/备注/错误', () => {
  it('hides delete control for ollama models (Req 5.2)', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('OllamaModel')).toBeInTheDocument(), { timeout: 3000 });
    // 只有 local-1 可删除，故只有一个「删除模型」按钮
    expect(screen.getAllByTitle('删除模型')).toHaveLength(1);
  });

  it('requires confirmation before deleting and calls delete on confirm (Req 5.3/5.4/5.6)', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('LocalModel')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.click(screen.getByTitle('删除模型'));
    // 确认框出现，确认前未调用删除端点
    await waitFor(() => expect(screen.getByRole('button', { name: '确认删除' })).toBeInTheDocument());
    expect(mockDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('/api/models/local-1'));
  });

  it('does not delete when confirmation is cancelled (Req 5.5)', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('LocalModel')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.click(screen.getByTitle('删除模型'));
    await waitFor(() => expect(screen.getByText('此操作不可撤销')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByText('此操作不可撤销')).not.toBeInTheDocument());
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('records error toast and keeps model on delete failure (Req 9.2)', async () => {
    mockDelete.mockRejectedValueOnce({ message: 'boom', response: { data: { error: 'boom' } } });
    renderPage();
    await waitFor(() => expect(screen.getByText('LocalModel')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.click(screen.getByTitle('删除模型'));
    await waitFor(() => expect(screen.getByRole('button', { name: '确认删除' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(toastMessages().some((m) => m.includes('删除失败'))).toBe(true));
    expect(screen.getByText('LocalModel')).toBeInTheDocument();
  });

  it('reads and saves model notes via meta endpoint (Req 6.1/6.2/6.3)', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('LocalModel')).toBeInTheDocument(), { timeout: 3000 });
    // 打开详情（点击模型名）
    fireEvent.click(screen.getByText('LocalModel'));
    // 备注读取：显示 'hi' 与「编辑」按钮
    await waitFor(() => expect(screen.getByText('编辑')).toBeInTheDocument());
    fireEvent.click(screen.getByText('编辑'));
    const textarea = screen.getByPlaceholderText('添加模型备注...') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'updated' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/api/models/local-1/meta', { notes: 'updated' }),
    );
  });
});
