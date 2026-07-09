// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import fc from 'fast-check';
import {
  useUIStore,
  defaultCharacters,
  setChatDbForTesting,
  type ChatSession,
} from '@/store/uiStore';
import type { ChatDb, PersistedMessage } from '@/lib/chatDb';

/**
 * Property-based test：消息级复制复制原始 Markdown 源（markdown-message-rendering 任务 7.3）。
 *
 * 复用项目既有 fast-check@3.23.2，属性测试至少运行 100 次随机迭代。
 * 与 ChatPage.test.tsx 一致：真实 uiStore + 内存 Chat_DB，navigator.clipboard.writeText 被 mock。
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

  // jsdom 无 clipboard：注入可断言的 writeText（默认 resolve）。
  mocks.clipboardWriteText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: mocks.clipboardWriteText },
    configurable: true,
  });

  useUIStore.setState({
    inputText: '',
    currentCharacterId: 'assistant',
    characters: defaultCharacters,
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

// 生成随机 Markdown 源（含标题/强调/行内代码/列表/链接等构造与换行）作为 Assistant_Message content。
const WORD_CHARS = ['a', 'b', 'c', 'd', 'X', 'Y', 'Z', '0', '1', '9', '你', '好', '世', '界'];
const wordArb = fc.stringOf(fc.constantFrom(...WORD_CHARS), { minLength: 1, maxLength: 8 });
const segArb = fc.oneof(
  wordArb,
  wordArb.map((w) => `# ${w}`),
  wordArb.map((w) => `**${w}**`),
  wordArb.map((w) => `\`${w}\``),
  wordArb.map((w) => `- ${w}`),
  wordArb.map((w) => `> ${w}`),
  wordArb.map((w) => `[${w}](http://example.com)`),
);
const markdownSourceArb = fc.array(segArb, { minLength: 1, maxLength: 6 }).map((segs) => segs.join('\n'));

describe('ChatPage 消息级复制复制原始 Markdown 源', () => {
  it('Property 10: 消息级复制复制原始 Markdown 源', async () => {
    // Feature: markdown-message-rendering, Property 10: 消息级复制复制原始 Markdown 源 —— 对 assistant 消息触发既有"复制"按钮后，写入剪贴板的字符串严格等于该消息 content（Markdown 源）
    await fc.assert(
      fc.asyncProperty(markdownSourceArb, async (content) => {
        mocks.clipboardWriteText.mockClear();
        useUIStore.setState({
          messages: [{ id: 'a1', role: 'assistant', content, voiceName: '佳怡音色', duration: '0:05' }],
        });
        const { unmount } = render(<ChatPage />);

        fireEvent.click(screen.getByLabelText('复制'));

        await waitFor(() =>
          expect(mocks.clipboardWriteText).toHaveBeenCalledWith(content),
        );
        // 写入剪贴板的内容应为 Markdown 源原文，而非渲染后的 HTML/纯文本。
        expect(mocks.clipboardWriteText).toHaveBeenCalledTimes(1);
        expect(mocks.clipboardWriteText.mock.calls[0][0]).toBe(content);

        unmount();
      }),
      { numRuns: 100 },
    );
  }, 30000);

  it('复制写入的是 Markdown 源而非渲染文本（示例）', async () => {
    const content = '# 标题\n**加粗** 与 `code`\n- 项目';
    useUIStore.setState({
      messages: [{ id: 'a1', role: 'assistant', content, voiceName: '佳怡音色', duration: '0:05' }],
    });
    render(<ChatPage />);
    fireEvent.click(screen.getByLabelText('复制'));
    await waitFor(() => expect(mocks.clipboardWriteText).toHaveBeenCalledWith(content));
  });
});
