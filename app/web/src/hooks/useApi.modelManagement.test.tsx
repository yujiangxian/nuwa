// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { apiClient } from '@/api/client';
import {
  usePresets,
  useDownloads,
  useModelMeta,
  useDiskInfo,
  useGpuInfo,
  useSetModel,
  useDeleteModel,
  useSaveModelMeta,
  useRefreshPresets,
  useCancelDownload,
  useRetryDownload,
  useDeleteDownload,
  useBatchDownload,
} from '@/hooks/useApi';

/**
 * 数据层集成测试：断言各 query/mutation 的 URL、请求体形状与缓存行为。
 * Validates: Requirements 2.6, 4.9, 4.10, 5.6, 9.6
 */

vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockGet = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = apiClient.post as unknown as ReturnType<typeof vi.fn>;
const mockDelete = apiClient.delete as unknown as ReturnType<typeof vi.fn>;

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useApi model-management queries', () => {
  it('usePresets GETs /api/downloads/presets', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ id: 'p1' }] });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => usePresets(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/api/downloads/presets');
    expect(result.current.data).toEqual([{ id: 'p1' }]);
  });

  it('useDownloads GETs /api/downloads', async () => {
    mockGet.mockResolvedValueOnce({ data: [] });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useDownloads(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/api/downloads');
  });

  it('useModelMeta GETs /api/models/{id}/meta and is disabled for null id', async () => {
    mockGet.mockResolvedValueOnce({ data: { notes: 'n', tags: [] } });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useModelMeta('m 1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/api/models/m%201/meta');

    vi.clearAllMocks();
    const { result: disabled } = renderHook(() => useModelMeta(null), { wrapper });
    expect(disabled.current.fetchStatus).toBe('idle');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('useDiskInfo and useGpuInfo hit system endpoints', async () => {
    mockGet.mockResolvedValue({ data: null });
    const { wrapper } = makeWrapper();
    renderHook(() => useDiskInfo(), { wrapper });
    renderHook(() => useGpuInfo(), { wrapper });
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/api/system/disk');
      expect(mockGet).toHaveBeenCalledWith('/api/system/gpu');
    });
  });
});

describe('useApi model-management mutations', () => {
  it('useSetModel POSTs { model_type, model_id } unchanged (contract) and caches config', async () => {
    const cfg = { current_models: { svs: 'x' } };
    mockPost.mockResolvedValueOnce({ data: cfg });
    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => useSetModel(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ model_type: 'svs', model_id: 'x' });
    });
    expect(mockPost).toHaveBeenCalledWith('/api/config/set-model', {
      model_type: 'svs',
      model_id: 'x',
    });
    expect(queryClient.getQueryData(['config'])).toEqual(cfg);
  });

  it('useDeleteModel DELETEs /api/models/{id} and invalidates models/config/disk', async () => {
    mockDelete.mockResolvedValueOnce({ data: { success: true } });
    const { queryClient, wrapper } = makeWrapper();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteModel(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync('m/1');
    });
    expect(mockDelete).toHaveBeenCalledWith('/api/models/m%2F1');
    const keys = spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
    expect(keys).toContain(JSON.stringify(['models']));
    expect(keys).toContain(JSON.stringify(['config']));
    expect(keys).toContain(JSON.stringify(['system', 'disk']));
  });

  it('useSaveModelMeta POSTs notes and updates meta cache', async () => {
    const meta = { notes: 'hello', tags: [] };
    mockPost.mockResolvedValueOnce({ data: meta });
    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => useSaveModelMeta(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 'm1', notes: 'hello' });
    });
    expect(mockPost).toHaveBeenCalledWith('/api/models/m1/meta', { notes: 'hello' });
    expect(queryClient.getQueryData(['modelMeta', 'm1'])).toEqual(meta);
  });

  it('useRefreshPresets POSTs refresh endpoint', async () => {
    mockPost.mockResolvedValueOnce({ data: {} });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useRefreshPresets(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(mockPost).toHaveBeenCalledWith('/api/downloads/presets/refresh');
  });

  it('download task mutations hit correct endpoints', async () => {
    mockPost.mockResolvedValue({ data: {} });
    mockDelete.mockResolvedValue({ data: {} });
    const { wrapper } = makeWrapper();

    const cancel = renderHook(() => useCancelDownload(), { wrapper });
    await act(async () => { await cancel.result.current.mutateAsync('t1'); });
    expect(mockPost).toHaveBeenCalledWith('/api/downloads/t1/cancel');

    const retry = renderHook(() => useRetryDownload(), { wrapper });
    await act(async () => { await retry.result.current.mutateAsync('t2'); });
    expect(mockPost).toHaveBeenCalledWith('/api/downloads/t2/retry');

    const del = renderHook(() => useDeleteDownload(), { wrapper });
    await act(async () => { await del.result.current.mutateAsync('t3'); });
    expect(mockDelete).toHaveBeenCalledWith('/api/downloads/t3');

    const batch = renderHook(() => useBatchDownload(), { wrapper });
    await act(async () => {
      await batch.result.current.mutateAsync({ repo_id: 'r', source: 's', dest_dir: 'd', files: ['a'] });
    });
    expect(mockPost).toHaveBeenCalledWith('/api/downloads/batch', {
      repo_id: 'r', source: 's', dest_dir: 'd', files: ['a'],
    });
  });
});
