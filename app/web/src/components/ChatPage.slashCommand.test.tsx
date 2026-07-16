// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  useUIStore,
  defaultAgents,
  setChatDbForTesting,
  type PromptPreset,
} from '@/store/uiStore';
import { createFakeChatDb } from '@/store/testChatDb';

/**
 * Integration tests for chat-input-slash-commands inside ChatPage (Task 4.2).
 *
 * 覆盖：斜杠激活显示菜单与过滤（Req 4.1, 4.2）、ArrowDown/Up 高亮回绕（Req 4.4, 4.5）、
 * Enter 选中不发送（Req 4.6）、Escape 关闭保留文本（Req 4.8）、点击选中（Req 4.7）、
 * 内置命令分发 clear/retry/presets（Req 5.4, 5.5, 5.7）、预设插入（Req 5.1）、
 * 超长拒绝插入并提示（Req 5.3）、选中后关闭菜单（Req 5.2）。
 */

const mocks = vi.hoisted(() => ({
  transcribeMutateAsync: vi.fn(),
  synthesizeMutateAsync: vi.fn(),
  apiPost: vi.fn(),
  addToast: vi.fn(),
  configData: undefined as any,
  voicesData: [] as any[],
  recorder: { isRecording: false, recordingTime: 0, error: null as string | null, start: vi.fn(), stop: vi.fn() },
  player: { playingKey: null as string | null, play: vi.fn(), stop: vi.fn(), isPlaying: vi.fn((_k: string) => false) },
}));

vi.mock('@/hooks/useApi', () => ({
  useTranscribe: () => ({ mutateAsync: mocks.transcribeMutateAsync }),
  useSynthesize: () => ({ mutateAsync: mocks.synthesizeMutateAsync }),
  useConfig: () => ({ data: mocks.configData }),
  useVoices: () => ({ data: mocks.voicesData }),
  useModels: () => ({ data: [] }),
}));
vi.mock('@/hooks/useRecorder', () => ({ useRecorder: () => mocks.recorder }));
vi.mock('@/hooks/useAudioPlayer', () => ({ useAudioPlayer: () => mocks.player }));
vi.mock('@/api/client', () => ({
  apiClient: { post: mocks.apiPost },
  setApiBaseUrl: vi.fn(),
  getApiBaseUrl: () => '',
  apiUrl: (path: string) => path,
  longRequestTimeoutMs: () => 300000,
}));
vi.mock('@/store/toastStore', () => {
  const useToastStore: any = (selector: any) => selector({ addToast: mocks.addToast });
  useToastStore.getState = () => ({ addToast: mocks.addToast });
  return { useToastStore };
});

import ChatPage from '@/components/ChatPage';

const presets: PromptPreset[] = [
  { id: 'p1', title: 'Greeting', content: 'Hello there' },
  { id: 'p2', title: 'Summarize', content: 'Summarize this' },
  { id: 'p3', title: 'Long', content: 'a'.repeat(2001) },
];

let setPageSpy: ReturnType<typeof vi.fn>;
let regenerateSpy: ReturnType<typeof vi.fn>;
let appendSpy: ReturnType<typeof vi.fn>;

function getInput(): HTMLTextAreaElement {
  return screen.getByPlaceholderText('输入消息...') as HTMLTextAreaElement;
}
function type(value: string) {
  fireEvent.change(getInput(), { target: { value } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configData = { current_models: { asr: 'asr/x', tts: 'tts/y' } };
  mocks.voicesData = [{ id: 'jyy', name: '佳怡音色', path: '/voices/jyy.wav', transcript: '你好', sample_rate: 24000 }];
  setChatDbForTesting(createFakeChatDb());

  setPageSpy = vi.fn();
  regenerateSpy = vi.fn().mockResolvedValue(null); // 无 Last_Assistant_Message：handleRegenerate 早退
  appendSpy = vi.fn().mockResolvedValue(undefined);

  useUIStore.setState({
    inputText: '',
    currentAgentId: 'agent-assistant',
    agents: defaultAgents,
    presets,
    sessions: [{ id: 's1', title: '会话', characterId: 'assistant', voiceId: 'jyy', updatedAt: new Date().toISOString(), pinned: false }],
    currentSessionId: 's1',
    messages: [],
    sessionsLoading: false,
    isPersistent: false,
    setPage: setPageSpy as any,
    regenerateLast: regenerateSpy as any,
    appendMessage: appendSpy as any,
    settings: { backendUrl: 'http://localhost:8080', modelsDir: './models', theme: 'dark', autoPlay: false, language: '简体中文' },
  });
});

describe('斜杠激活与过滤 (Req 4.1, 4.2)', () => {
  it('输入 "/" 显示菜单，含 3 条内置命令 + 预设命令', () => {
    render(<ChatPage />);
    expect(screen.queryByTestId('slash-command-menu')).not.toBeInTheDocument();
    type('/');
    expect(screen.getByTestId('slash-command-menu')).toBeInTheDocument();
    // 3 builtin + 3 presets = 6 项。
    expect(screen.getByTestId('slash-command-item-5')).toBeInTheDocument();
    expect(screen.queryByTestId('slash-command-item-6')).not.toBeInTheDocument();
  });

  it('输入 "/cl" 过滤到 /clear', () => {
    render(<ChatPage />);
    type('/cl');
    const menu = screen.getByTestId('slash-command-menu');
    expect(menu).toHaveTextContent('/clear');
    expect(menu).not.toHaveTextContent('Greeting');
  });

  it('无匹配查询时不显示菜单', () => {
    render(<ChatPage />);
    type('/zzzznotacommand');
    expect(screen.queryByTestId('slash-command-menu')).not.toBeInTheDocument();
  });
});

describe('键盘导航与回绕 (Req 4.4, 4.5)', () => {
  it('ArrowDown 下移高亮，越过末项回绕到首项', () => {
    render(<ChatPage />);
    type('/'); // 6 项，首项高亮
    const input = getInput();
    expect(screen.getByTestId('slash-command-item-0')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // 0 -> 1
    expect(screen.getByTestId('slash-command-item-1')).toHaveAttribute('aria-selected', 'true');
    // ArrowUp 从首项回绕到末项：1 -> 0 -> 5。
    fireEvent.keyDown(input, { key: 'ArrowUp' }); // 1 -> 0
    fireEvent.keyDown(input, { key: 'ArrowUp' }); // 0 -> 5（回绕）
    expect(screen.getByTestId('slash-command-item-5')).toHaveAttribute('aria-selected', 'true');
    // ArrowDown 从末项回绕到首项：5 -> 0。
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByTestId('slash-command-item-0')).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Enter 选中不发送 / Escape 关闭 (Req 4.6, 4.8)', () => {
  it('菜单可见时 Enter 选中高亮项且不发送消息', () => {
    render(<ChatPage />);
    type('/'); // 首项 /clear 高亮
    fireEvent.keyDown(getInput(), { key: 'Enter' });
    // /clear 清空输入；未发送（appendMessage 未被调用）。
    expect(appendSpy).not.toHaveBeenCalled();
    expect(useUIStore.getState().inputText).toBe('');
  });

  it('Escape 关闭菜单且保留输入文本', () => {
    render(<ChatPage />);
    type('/cl');
    expect(screen.getByTestId('slash-command-menu')).toBeInTheDocument();
    fireEvent.keyDown(getInput(), { key: 'Escape' });
    expect(screen.queryByTestId('slash-command-menu')).not.toBeInTheDocument();
    expect(useUIStore.getState().inputText).toBe('/cl');
  });
});

describe('内置命令分发 (Req 5.2, 5.4, 5.5, 5.7)', () => {
  it('/clear 清空输入并关闭菜单', () => {
    render(<ChatPage />);
    type('/clear');
    fireEvent.keyDown(getInput(), { key: 'Enter' });
    expect(useUIStore.getState().inputText).toBe('');
    expect(screen.queryByTestId('slash-command-menu')).not.toBeInTheDocument();
  });

  it('/retry 触发既有重新生成动作', () => {
    render(<ChatPage />);
    type('/retry');
    fireEvent.keyDown(getInput(), { key: 'Enter' });
    expect(regenerateSpy).toHaveBeenCalled();
  });

  it('/presets 切换到提示词预设页', () => {
    render(<ChatPage />);
    type('/presets');
    fireEvent.keyDown(getInput(), { key: 'Enter' });
    expect(setPageSpy).toHaveBeenCalledWith('presets');
  });
});

describe('预设插入与长度上限 (Req 5.1, 5.3, 4.7)', () => {
  it('点击预设命令插入其 content（Req 5.1, 4.7）', () => {
    render(<ChatPage />);
    type('/'); // p1 Greeting 在 index 3
    fireEvent.mouseDown(screen.getByTestId('slash-command-item-3'));
    expect(useUIStore.getState().inputText).toBe('Hello there');
    expect(screen.queryByTestId('slash-command-menu')).not.toBeInTheDocument();
  });

  it('插入文本超 INPUT_MAX_LENGTH 时保持原文并提示（Req 5.3）', () => {
    render(<ChatPage />);
    type('/'); // p3 Long（2001 字符）在 index 5
    fireEvent.mouseDown(screen.getByTestId('slash-command-item-5'));
    expect(mocks.addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'warning' }),
    );
    // 原斜杠文本保持不变。
    expect(useUIStore.getState().inputText).toBe('/');
  });
});

describe('无回归：未激活斜杠时正常发送 (Req 7.1, 7.3)', () => {
  it('普通文本按 Enter 走既有发送逻辑', async () => {
    render(<ChatPage />);
    type('你好世界');
    expect(screen.queryByTestId('slash-command-menu')).not.toBeInTheDocument();
    fireEvent.keyDown(getInput(), { key: 'Enter' });
    await waitFor(() => expect(appendSpy).toHaveBeenCalled());
  });
});
