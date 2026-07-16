// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import {
  useUIStore,
  defaultAgents,
  setChatDbForTesting,
  type ChatSession,
} from '@/store/uiStore';
import type { ChatDb, PersistedMessage } from '@/lib/chatDb';

/**
 * 单元 / 回归测试：ChatPage 集成 MarkdownMessage 后的无回归行为（markdown-message-rendering 任务 7.4）。
 *
 * 覆盖：
 *  - 流式态（isStreaming，streaming-content 区域）不渲染任何 message-actions 入口（Req 3.4）。
 *  - assistant 四操作（复制/删除/重新生成/编辑）可用性不变，复用 actionAvailabilityFor 的语义（Req 9.2）。
 *  - speakMessage 调用 synthesize 时 text === msg.content（Markdown 源，Req 11.3）。
 *
 * 与 ChatPage.test.tsx 保持一致的 store 初始化 / mock / render 辅助方式。
 */

const mocks = vi.hoisted(() => ({
  transcribeMutateAsync: vi.fn(),
  synthesizeMutateAsync: vi.fn(() => Promise.resolve({ success: true, output_path: 'tts.wav', error: null })),
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
    enqueue: vi.fn(),
    playNow: vi.fn(),
    clear: vi.fn(),
    getQueueLength: vi.fn(() => 0),
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
vi.mock('@/hooks/useAudioQueue', () => ({ useAudioQueue: () => mocks.player }));
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


/** 手动驱动的流：测试按需 push 增量 / close。 */


function sendText(text: string) {
  const ta = screen.getByPlaceholderText('输入消息...');
  fireEvent.change(ta, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: /发送/ }));
}

const baseSessions: ChatSession[] = [
  { id: 's1', title: '会话一', characterId: 'assistant', voiceId: 'jyy', updatedAt: '2024-01-01T10:00:00.000Z', pinned: false },
];

beforeEach(() => {
  vi.clearAllMocks();

  mocks.player.isPlaying.mockReturnValue(false);
  mocks.player.play.mockResolvedValue(undefined);
  mocks.configData = { current_models: { asr: 'asr/paraformer-large', tts: 'tts/cosyvoice3' } };
  mocks.voicesData = [
    { id: 'jyy', name: '佳怡音色', path: '/voices/jyy.wav', transcript: '你好世界', sample_rate: 24000 },
  ];
  // Mock agent API for streaming
  mocks.apiPost.mockImplementation((url: string) => {
    if (url === '/api/agents/run-stream') {
      return Promise.resolve({ data: { success: true, task_id: 'agent_md_test' } });
    }
    return Promise.resolve({ data: { role: 'assistant', content: '降级回复', model: 'gemma', done: true } });
  });
  // Mock EventSource auto-complete
  (window as any).EventSource = class {
    onmessage: ((e: any) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() {
      setTimeout(() => {
        if (this.onmessage) {
          this.onmessage({ data: JSON.stringify({ delta: '默认回复', status: 'running' }) });
        }
        setTimeout(() => {
          if (this.onmessage) {
            this.onmessage({ data: JSON.stringify({ status: 'completed' }) });
          }
        }, 50);
      }, 50);
    }
    close() {}
  };
  mocks.fetch.mockResolvedValue({ ok: true, body: undefined } as any);

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
  vi.unstubAllGlobals();
});

describe('ChatPage 流式气泡无消息操作入口（Req 3.4）', () => {
  it('流式态 streaming-content 区域不渲染任何 message-actions testid', async () => {
    render(<ChatPage />);
    sendText('你好');
    await screen.findByText('正在思考...');

    const streaming = await screen.findByTestId('streaming-content');
    const streamingBubble = streaming.closest('div.flex.gap-3') as HTMLElement;
    expect(streamingBubble).not.toBeNull();
    expect(streamingBubble.querySelector('[data-testid^="message-actions"]')).toBeNull();
  });
});

describe('ChatPage assistant 四操作可用性不变（Req 9.2）', () => {
  beforeEach(() => {
    useUIStore.setState({
      messages: [
        { id: 'u1', role: 'user', content: '原始问题' },
        { id: 'a1', role: 'assistant', content: '# 回复标题\n**加粗回复**', voiceName: '佳怡音色', duration: '0:05' },
      ],
    });
  });

  it('Last_Assistant_Message：复制/删除/重新生成可用，编辑重发不可用', () => {
    render(<ChatPage />);
    const actions = screen.getByTestId('message-actions-a1');
    // 与 actionAvailabilityFor(messages, lastIdx, false) 语义一致：assistant 末条 → 可复制/删除/重新生成，不可编辑。
    expect(within(actions).getByLabelText('复制')).toBeInTheDocument();
    expect(within(actions).getByLabelText('删除消息')).toBeInTheDocument();
    expect(within(actions).getByLabelText('重新生成')).toBeInTheDocument();
    expect(within(actions).queryByLabelText('编辑重发')).not.toBeInTheDocument();
  });

  it('User_Message：复制/编辑重发/删除可用，重新生成不可用', () => {
    render(<ChatPage />);
    const actions = screen.getByTestId('message-actions-u1');
    expect(within(actions).getByLabelText('复制')).toBeInTheDocument();
    expect(within(actions).getByLabelText('编辑重发')).toBeInTheDocument();
    expect(within(actions).getByLabelText('删除消息')).toBeInTheDocument();
    expect(within(actions).queryByLabelText('重新生成')).not.toBeInTheDocument();
  });
});

describe('ChatPage speakMessage TTS 输入为 Markdown 源（Req 11.3）', () => {
  it('手动朗读时 synthesize 的 text === msg.content（含 Markdown 标记的原文）', async () => {
    const content = '# 标题\n**加粗** 与 `code`';
    useUIStore.setState({
      messages: [{ id: 'a1', role: 'assistant', content, voiceName: '佳怡音色', duration: '0:05' }],
    });
    mocks.synthesizeMutateAsync.mockResolvedValue({ success: true, output_path: 'reply.wav', error: null });

    render(<ChatPage />);
    fireEvent.click(screen.getAllByRole('button', { name: /播放/ })[0]);

    await waitFor(() => expect(mocks.synthesizeMutateAsync).toHaveBeenCalledTimes(1));
    // 朗读输入应为 Markdown 源原文（不传渲染后文本）。
    expect(mocks.synthesizeMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ text: content }),
    );
  });
});
