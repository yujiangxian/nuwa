// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import {
  useUIStore,
  defaultCharacters,
  setChatDbForTesting,
  type ChatSession,
} from '@/store/uiStore';
import { createFakeChatDb } from '@/store/testChatDb';

/**
 * Component tests for chat-session-organization sidebar grouping & pin
 * interaction (Task 4.3).
 *
 * 覆盖：按分组渲染会话与组标题（Req 7.1, 7.2）、空组不渲染标题、每个会话项存在
 * 置顶 / 取消置顶入口（Req 7.3）、点击置顶入口后会话迁移到置顶组并重渲染（Req 7.4）、
 * Active_Session 选中态（Req 7.5）、点击会话项调既有 switchSession（Req 7.6）。
 *
 * 使用真实 uiStore（注入内存 fake Chat_DB），仅对 switchSession 包一层 spy。
 * togglePin 使用真实实现以验证迁移与重渲染。
 */

const mocks = vi.hoisted(() => ({
  transcribeMutateAsync: vi.fn(),
  synthesizeMutateAsync: vi.fn(),
  apiPost: vi.fn(),
  addToast: vi.fn(),
  configData: undefined as any,
  voicesData: [] as any[],
  recorder: {
    isRecording: false,
    recordingTime: 0,
    error: null as string | null,
    start: vi.fn(),
    stop: vi.fn(),
  },
  player: {
    playingKey: null as string | null,
    play: vi.fn(),
    stop: vi.fn(),
    isPlaying: vi.fn((_key: string) => false),
  },
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
vi.mock('@/api/client', () => ({ apiClient: { post: mocks.apiPost } }));
vi.mock('@/store/toastStore', () => {
  const useToastStore: any = (selector: any) => selector({ addToast: mocks.addToast });
  useToastStore.getState = () => ({ addToast: mocks.addToast });
  return { useToastStore };
});

import ChatPage from '@/components/ChatPage';

/** 相对当前时间偏移 days 天、固定中午 12 点，落入确定的时间桶。 */
function daysAgoNoon(days: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, 12, 0, 0);
  return d.toISOString();
}

let switchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configData = { current_models: { asr: 'asr/x', tts: 'tts/y' } };
  mocks.voicesData = [{ id: 'jyy', name: '佳怡音色', path: '/voices/jyy.wav', transcript: '你好', sample_rate: 24000 }];

  setChatDbForTesting(createFakeChatDb());

  const sessions: ChatSession[] = [
    { id: 'pin1', title: '置顶会话', characterId: 'assistant', voiceId: 'jyy', updatedAt: daysAgoNoon(100), pinned: true },
    { id: 'today1', title: '今天会话', characterId: 'assistant', voiceId: 'jyy', updatedAt: daysAgoNoon(0), pinned: false },
    { id: 'old1', title: '更早会话', characterId: 'assistant', voiceId: 'jyy', updatedAt: daysAgoNoon(60), pinned: false },
  ];

  switchSpy = vi.fn();

  useUIStore.setState({
    inputText: '',
    currentCharacterId: 'assistant',
    characters: defaultCharacters,
    sessions,
    currentSessionId: 'today1',
    messages: [],
    sessionsLoading: false,
    isPersistent: false, // 降级模式：togglePin 仅改内存，无需 DB
    switchSession: switchSpy as any,
    settings: {
      backendUrl: 'http://localhost:8080',
      modelsDir: './models',
      theme: 'dark',
      autoPlay: false,
      language: '简体中文',
    },
  });
});

describe('ChatPage 侧边栏分组渲染 (Req 7.1, 7.2)', () => {
  it('按分组渲染会话与对应组标题，空组不渲染标题', () => {
    render(<ChatPage />);
    // 非空组标题出现。
    expect(screen.getByText('置顶')).toBeInTheDocument();
    expect(screen.getByText('今天')).toBeInTheDocument();
    expect(screen.getByText('更早')).toBeInTheDocument();
    // 空组标题不出现。
    expect(screen.queryByText('昨天')).not.toBeInTheDocument();
    expect(screen.queryByText('近 7 天')).not.toBeInTheDocument();
    expect(screen.queryByText('近 30 天')).not.toBeInTheDocument();

    // 会话归入正确分组容器。
    const pinnedGroup = screen.getByTestId('session-group-pinned');
    expect(within(pinnedGroup).getByText('置顶会话')).toBeInTheDocument();
    const todayGroup = screen.getByTestId('session-group-today');
    expect(within(todayGroup).getByText('今天会话')).toBeInTheDocument();
    const earlierGroup = screen.getByTestId('session-group-earlier');
    expect(within(earlierGroup).getByText('更早会话')).toBeInTheDocument();
  });
});

describe('ChatPage 置顶入口 (Req 7.3)', () => {
  it('每个会话项都提供置顶 / 取消置顶入口', () => {
    render(<ChatPage />);
    // 已置顶会话显示「取消置顶」，未置顶会话显示「置顶」。
    expect(screen.getAllByLabelText('置顶').length).toBe(2); // today1 + old1
    expect(screen.getAllByLabelText('取消置顶').length).toBe(1); // pin1
  });
});

describe('ChatPage 置顶切换后重渲染迁移 (Req 7.4)', () => {
  it('点击未置顶会话的置顶入口后，会话迁移到置顶组', async () => {
    render(<ChatPage />);
    // today1 初始在「今天」组。
    expect(within(screen.getByTestId('session-group-today')).getByText('今天会话')).toBeInTheDocument();

    // 点击「今天会话」行内的置顶按钮。
    const todayRow = screen.getByText('今天会话').closest('.group') as HTMLElement;
    fireEvent.click(within(todayRow).getByLabelText('置顶'));

    // 迁移到置顶组，且「今天」组消失（已无成员）。
    await waitFor(() => {
      const pinnedGroup = screen.getByTestId('session-group-pinned');
      expect(within(pinnedGroup).getByText('今天会话')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('session-group-today')).not.toBeInTheDocument();
    expect(useUIStore.getState().sessions.find((s) => s.id === 'today1')?.pinned).toBe(true);
  });
});

describe('ChatPage Active_Session 选中态 (Req 7.5)', () => {
  it('当前会话所在行标记为选中（高亮边框）', () => {
    render(<ChatPage />);
    const activeRow = screen.getByText('今天会话').closest('.group') as HTMLElement;
    // 选中行使用高亮背景样式（浏览器规范化为带空格形式）。
    expect(activeRow.getAttribute('style')).toContain('rgba(72, 202, 228, 0.06)');
    // 非选中行背景透明，不使用该高亮背景。
    const otherRow = screen.getByText('更早会话').closest('.group') as HTMLElement;
    expect(otherRow.getAttribute('style')).not.toContain('rgba(72, 202, 228, 0.06)');
    expect(otherRow.getAttribute('style')).toContain('background: transparent');
  });
});

describe('ChatPage 点击会话项切换 (Req 7.6)', () => {
  it('点击非当前会话项调用既有 switchSession', () => {
    render(<ChatPage />);
    fireEvent.click(screen.getByText('更早会话'));
    expect(switchSpy).toHaveBeenCalledWith('old1');
  });
});
