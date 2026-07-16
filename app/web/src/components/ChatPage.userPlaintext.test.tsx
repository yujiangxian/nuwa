// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import fc from 'fast-check';
import {
  useUIStore,
  defaultAgents,
  setChatDbForTesting,
  type ChatSession,
} from '@/store/uiStore';
import type { ChatDb, PersistedMessage } from '@/lib/chatDb';

/**
 * Property-based test：User_Message 不被 Markdown 解析（markdown-message-rendering 任务 7.2）。
 *
 * 复用项目既有 fast-check@3.23.2，属性测试至少运行 100 次随机迭代。
 * 渲染层属性使用 @testing-library/react + jsdom。
 *
 * 与 ChatPage.test.tsx 保持一致的 store 初始化 / mock / render 辅助方式：真实 uiStore +
 * 内存 Chat_DB 注入；外设 hooks（ASR/TTS/录音/播放）、apiClient、toastStore 全部 mock。
 */

const mocks = vi.hoisted(() => ({
  transcribeMutateAsync: vi.fn(),
  synthesizeMutateAsync: vi.fn(),
  apiPost: vi.fn(),
  fetch: vi.fn(),
  addToast: vi.fn(),
  clipboardWriteText: vi.fn(),
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

function makeFakeChatDb(): ChatDb {
  const sessions = new Map<string, ChatSession>();
  const messages = new Map<string, PersistedMessage>();
  return {
    init: vi.fn(async () => {}),
    getAllSessions: vi.fn(async () => [...sessions.values()]),
    getMessages: vi.fn(async (sessionId: string) =>
      [...messages.values()]
        .filter((m) => m.sessionId === sessionId)
        .sort((a, b) => a.seq - b.seq)
        .map(({ sessionId: _s, seq: _q, ...rest }) => rest)
    ),
    saveSession: vi.fn(async (s: ChatSession) => { sessions.set(s.id, s); }),
    saveMessage: vi.fn(async (m: PersistedMessage) => { messages.set(m.id, m); }),
    deleteSession: vi.fn(async (sessionId: string) => {
      sessions.delete(sessionId);
      for (const [k, v] of messages) if (v.sessionId === sessionId) messages.delete(k);
    }),
    deleteMessage: vi.fn(async (messageId: string) => { messages.delete(messageId); }),
    truncateMessagesAfter: vi.fn(async (sessionId: string, afterSeq: number) => {
      for (const [k, v] of messages) {
        if (v.sessionId === sessionId && v.seq > afterSeq) messages.delete(k);
      }
    }),
  };
}

const baseSessions: ChatSession[] = [
  { id: 's1', title: '会话一', characterId: 'assistant', voiceId: 'jyy', updatedAt: '2024-01-01T10:00:00.000Z', pinned: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);

  mocks.player.isPlaying.mockReturnValue(false);
  mocks.configData = { current_models: { asr: 'asr/paraformer-large', tts: 'tts/cosyvoice3' } };
  mocks.voicesData = [
    { id: 'jyy', name: '佳怡音色', path: '/voices/jyy.wav', transcript: '你好世界', sample_rate: 24000 },
  ];

  const fakeDb = makeFakeChatDb();
  void fakeDb.saveSession(baseSessions[0]);
  setChatDbForTesting(fakeDb);

  useUIStore.setState({
    inputText: '',
    currentAgentId: 'agent-assistant',
    agents: defaultAgents,
    sessions: baseSessions.map((s) => ({ ...s })),
    currentSessionId: 's1',
    messages: [],
    sessionsLoading: false,
    isPersistent: true,
    settings: {
      backendUrl: 'http://localhost:8080',
      modelsDir: './models',
      theme: 'dark',
      autoPlay: false,
      language: '简体中文',
    },
  });
});

afterEach(() => {
  cleanup();
});

// 生成含 Markdown 标记的随机文本：每行由一个标记 token + 一个安全词组成，行间以换行连接，
// 既覆盖 #/**/`/-/>/有序列表/删除线等会被解析的构造，又引入换行/空白以验证原样保留。
const WORD_CHARS = ['a', 'b', 'c', 'd', 'X', 'Y', 'Z', '0', '1', '9', '你', '好', '世', '界'];
const wordArb = fc.stringOf(fc.constantFrom(...WORD_CHARS), { minLength: 1, maxLength: 8 });
const markerArb = fc.constantFrom('#', '##', '###', '-', '*', '+', '>', '1.', '**x**', '`code`', '~~s~~', '[a](http://e.com)');
const lineArb = fc.tuple(markerArb, wordArb).map(([m, w]) => `${m} ${w}`);
const userTextArb = fc.array(lineArb, { minLength: 1, maxLength: 6 }).map((lines) => lines.join('\n'));

describe('ChatPage User_Message 不被 Markdown 解析', () => {
  it('Property 2: User_Message 不被 Markdown 解析', () => {
    // Feature: markdown-message-rendering, Property 2: User_Message 不被 Markdown 解析 —— 含 Markdown 标记的随机文本作为 user 消息渲染时，输出不出现由这些标记转换的元素（h1/strong/code/li），原文（含换行空白）原样可见
    fc.assert(
      fc.property(userTextArb, (text) => {
        useUIStore.setState({ messages: [{ id: 'u1', role: 'user', content: text }] });
        const { container, unmount } = render(<ChatPage />);

        // user 气泡（rounded-tr-sm）走纯文本 <p> 分支，气泡内不存在 Markdown 渲染容器。
        const bubble = container.querySelector('.rounded-tr-sm') as HTMLElement | null;
        expect(bubble).not.toBeNull();
        expect(bubble!.querySelector('.md-content')).toBeNull();

        // 不出现由 Markdown 标记转换而成的元素。
        expect(
          bubble!.querySelector('h1, h2, h3, h4, h5, h6, strong, em, code, ul, ol, li, blockquote, a, del'),
        ).toBeNull();

        // 原文（含换行/空白）原样可见：纯文本节点的 textContent 与源文本严格相等。
        expect(bubble!.textContent).toBe(text);

        unmount();
      }),
      { numRuns: 100 },
    );
  });

  it('含 # ** ` - 标记的 user 消息原样呈现且无 Markdown 元素（示例）', () => {
    const text = '# 标题\n- 列表项\n**粗体** 与 `行内代码`';
    useUIStore.setState({ messages: [{ id: 'u1', role: 'user', content: text }] });
    const { container } = render(<ChatPage />);
    const bubble = container.querySelector('.rounded-tr-sm') as HTMLElement;
    expect(bubble).not.toBeNull();
    // 走纯文本 <p> 分支：无 Markdown 渲染容器、无标记转换出的元素，原文（含换行）原样保留。
    expect(bubble.querySelector('.md-content')).toBeNull();
    expect(bubble.querySelector('h1, strong, code, li')).toBeNull();
    expect(bubble.textContent).toBe(text);
  });
});
