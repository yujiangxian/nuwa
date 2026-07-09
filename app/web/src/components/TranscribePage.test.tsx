// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { installMockClipboard } from '@/test/setup';

/**
 * TranscribePage 单元测试（任务 5.3）。
 *
 * 覆盖需求：
 *  - 1.5：success 响应渲染 Transcription_Text + 所用 model + elapsed_ms（毫秒）。
 *  - 1.6：success:false 渲染 error 文本且不渲染转写文本。
 *  - 1.8：点击复制将转写文本写入剪贴板（navigator.clipboard.writeText）。
 *  - 1.9：ASR 请求等待期（isPending）显示处理中并禁用提交。
 *
 * 依赖隔离：
 *  - mock `@/hooks/useApi` 的 useTranscribe（可控 mutateAsync / isPending）。
 *  - mock `@/hooks/useRecorder`（可控录音状态，避免真实媒体 API）。
 *  - uiStore / toastStore 使用真实 zustand store，jsdom 下可直接运行。
 */

// vi.hoisted 让 mock 工厂在模块求值前即可安全引用这些可控句柄，避免 TDZ。
const { mockMutateAsync, getIsPending, setIsPending, mockRecorder } = vi.hoisted(() => {
  let isPending = false;
  return {
    mockMutateAsync: vi.fn(),
    getIsPending: () => isPending,
    setIsPending: (v: boolean) => {
      isPending = v;
    },
    mockRecorder: {
      isRecording: false,
      recordingTime: 0,
      error: null as string | null,
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => null),
    },
  };
});

vi.mock('@/hooks/useApi', () => ({
  useTranscribe: () => ({
    mutateAsync: mockMutateAsync,
    isPending: getIsPending(),
  }),
  useModels: () => ({ data: [] }),
}));

vi.mock('@/hooks/useRecorder', () => ({
  useRecorder: () => mockRecorder,
}));

import TranscribePage from './TranscribePage';

/** 取页面中隐藏的文件上传 input。 */
function getFileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!input) throw new Error('file input not found');
  return input as HTMLInputElement;
}

/** 通过文件上传路径触发一次转写提交。 */
function uploadAudioFile(name = 'clip.wav') {
  const file = new File(['fake-audio-bytes'], name, { type: 'audio/wav' });
  fireEvent.change(getFileInput(), { target: { files: [file] } });
  return file;
}

beforeEach(() => {
  mockMutateAsync.mockReset();
  mockRecorder.error = null;
  mockRecorder.isRecording = false;
  mockRecorder.recordingTime = 0;
  setIsPending(false);
});

describe('TranscribePage', () => {
  it('success 响应渲染转写文本、所用模型与耗时，并支持复制到剪贴板（需求 1.5 / 1.8）', async () => {
    const writeText = installMockClipboard();
    mockMutateAsync.mockResolvedValue({
      success: true,
      text: '你好世界',
      error: null,
      model: 'asr/paraformer-large',
      elapsed_ms: 1234,
    });

    render(<TranscribePage />);
    uploadAudioFile();

    // 转写文本（需求 1.5）
    expect(await screen.findByText('你好世界')).toBeInTheDocument();
    // 所用模型（需求 1.5）
    expect(screen.getByText('asr/paraformer-large')).toBeInTheDocument();
    // 耗时（毫秒，需求 1.5）
    expect(screen.getByText('1234 ms')).toBeInTheDocument();

    // 复制按钮存在并写入剪贴板（需求 1.8）
    const copyButton = screen.getByRole('button', { name: /复制/ });
    fireEvent.click(copyButton);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('你好世界');
    });
  });

  it('success:false 渲染 error 文本且不渲染转写结果（需求 1.6）', async () => {
    mockMutateAsync.mockResolvedValue({
      success: false,
      text: '',
      error: '未选择 ASR 模型',
      model: '',
      elapsed_ms: 0,
    });

    render(<TranscribePage />);
    uploadAudioFile();

    // 展示后端 error 文本
    expect(await screen.findByText('未选择 ASR 模型')).toBeInTheDocument();
    // 不渲染转写结果区块
    expect(screen.queryByText('转写结果')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /复制/ })).not.toBeInTheDocument();
  });

  it('加载态（isPending）显示识别处理中并禁用提交按钮（需求 1.9）', () => {
    setIsPending(true);

    render(<TranscribePage />);

    // 处理中提示
    expect(screen.getByText('识别处理中…')).toBeInTheDocument();

    // 上传按钮禁用，避免重复提交
    const uploadButton = screen.getByRole('button', { name: /上传音频文件/ });
    expect(uploadButton).toBeDisabled();

    // 文件 input 处于禁用状态时上传也应被拦截：录音按钮（页面首个 button）同样禁用
    const recordButton = document.querySelectorAll('button')[1] as HTMLButtonElement;
    expect(recordButton).toBeDisabled();
  });
});
