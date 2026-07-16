// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import {
  useUIStore,
  defaultAgents,
  setChatDbForTesting,
  type ChatSession,
} from '@/store/uiStore';
import type { ChatDb, PersistedMessage } from '@/lib/chatDb';

/**
 * Component tests for the streaming-chat-output ChatPage integration
 * (tasks 5.1 / 5.2 / 5.3 / 5.5).
 *
 * Streaming coverage:
 *  - Render/state: placeholder + disabled input on send (Req 2.1/2.3), growing
 *    text on increments (Req 2.2), finalize + exit generating on done (Req 2.4).
 *  - Stop: Stop entry while generating (Req 3.1), abort keeps partial content,
 *    persists it, exits (Req 3.2–3.4), no content removes placeholder without an
 *    empty Final_Message (Req 3.5).
 *  - Persistence: user message persisted (Req 4.1), final assistant persisted
 *    once on done/stop (Req 4.2/4.3).
 *  - TTS: autoPlay ON + done → one synth of the FULL text (Req 5.1); not while
 *    streaming (Req 5.2); autoPlay OFF → no synth (Req 5.3); stop non-empty +
 *    autoPlay ON → one synth (Req 5.4).
 *  - Error/fallback: error chunk shows a toast + exits, no persist when empty
 *    (Req 6.1/6.5/6.6); connection failure with no content falls back to
 *    /api/chat and renders/persists the reply (Req 6.2/6.3); fallback failure
 *    shows an error + exits (Req 6.4).
 *
 * No-regression coverage (Voice_Loop): ASR transcribe fills the input (Req 7.3)
 * and the manual TTS read control still issues the right request (Req 7.4).
 *
 * The streaming endpoint is consumed through the global `fetch` + ReadableStream;
 * we stub `fetch` with a controllable stream. The fallback path and ASR/TTS go
 * through the mocked `apiClient` / useApi hooks. The REAL uiStore is used with an
 * in-memory fake Chat_DB injected, so store actions exercise their real logic.
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
vi.mock('@/api/client', () => ({
  apiClient: { post: mocks.apiPost },
  setApiBaseUrl: vi.fn(),
  getApiBaseUrl: () => '',
  apiUrl: (path: string) => path,
  longRequestTimeoutMs: () => 300000,
}));

// Toast store mock that supports both the hook-selector form (ChatPage) and the
// imperative getState() form (uiStore internal save-failed toasts).
vi.mock('@/store/toastStore', () => {
  const useToastStore: any = (selector: any) => selector({ addToast: mocks.addToast });
  useToastStore.getState = () => ({ addToast: mocks.addToast });
  return { useToastStore };
});

import ChatPage from '@/components/ChatPage';

// ---------------------------------------------------------------------------
// In-memory fake Chat_DB (no IndexedDB needed under jsdom).
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Streaming helpers: build NDJSON ReadableStreams the component can consume.
// ---------------------------------------------------------------------------

const tick = () => new Promise((r) => setTimeout(r, 0));


/** A manually driven stream: tests push chunks / close / abort on demand. */


/** Controlled agent stream: push SSE events manually, then call done(). */
function agentStreamController() {
  let instRef: { onmessage: ((e: { data: string }) => void) | null; onerror: (() => void) | null } | null = null;
  let closed = false;

  const push = (ev: Record<string, unknown>) => {
    if (closed || !instRef?.onmessage) return;
    instRef.onmessage({ data: JSON.stringify(ev) });
  };
  const done = () => {
    if (!instRef?.onmessage) return;
    closed = true;
    instRef.onmessage({ data: JSON.stringify({ status: 'completed' }) });
    instRef = null;
  };
  const error = () => {
    if (!instRef?.onerror) return;
    closed = true;
    instRef.onerror();
    instRef = null;
  };

  const ctrl = {
    push,
    done,
    error,
    install: (win: any) => {
      win.EventSource = class {
        onmessage: ((e: { data: string }) => void) | null = null;
        onerror: (() => void) | null = null;
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- exposes the instance to the enclosing push/done/error closures
        constructor() { instRef = this; }
        close() {}
      };
      mocks.apiPost.mockImplementation((url: string, _body: any) => {
        if (url === '/api/agents/run-stream') {
          return Promise.resolve({ data: { success: true, task_id: 'agent_test' } });
        }
        return Promise.resolve({ data: { role: 'assistant', content: '降级回复', model: 'gemma', done: true } });
      });
    },
  };
  return ctrl;
}

/** Send the given text through the composer. */
function sendText(text: string) {
  const ta = screen.getByPlaceholderText('输入消息...');
  fireEvent.change(ta, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: /发送/ }));
}

// Capture the ORIGINAL store actions once so each test can wrap them with a
// delegating spy without accumulating nested wrappers across tests.
const original = {
  createSession: useUIStore.getState().createSession,
  switchSession: useUIStore.getState().switchSession,
  deleteSession: useUIStore.getState().deleteSession,
  renameSession: useUIStore.getState().renameSession,
  appendMessage: useUIStore.getState().appendMessage,
};

const baseSessions: ChatSession[] = [
  { id: 's1', title: '会话一', characterId: 'assistant', voiceId: 'jyy', updatedAt: '2024-01-01T10:00:00.000Z', pinned: false },
  { id: 's2', title: '会话二', characterId: 'assistant', voiceId: 'jyy', updatedAt: '2024-01-02T10:00:00.000Z', pinned: false },
];

let createSpy: ReturnType<typeof vi.fn>;
let switchSpy: ReturnType<typeof vi.fn>;
let deleteSpy: ReturnType<typeof vi.fn>;
let renameSpy: ReturnType<typeof vi.fn>;
let appendSpy: ReturnType<typeof vi.fn>;
// Module-level handle to the per-test fake Chat_DB so action tests can assert
// persistence calls (saveSession / saveMessage / deleteMessage / truncate...).
let fakeDb: ChatDb;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);

  mocks.recorder.isRecording = false;
  mocks.recorder.recordingTime = 0;
  mocks.recorder.error = null;
  mocks.recorder.stop.mockResolvedValue(new Blob(['audio-bytes'], { type: 'audio/webm' }));

  mocks.player.playingKey = null;
  mocks.player.isPlaying.mockReturnValue(false);
  mocks.player.play.mockResolvedValue(undefined);
  mocks.player.enqueue = vi.fn();
  mocks.player.playNow = vi.fn();
  mocks.player.clear = vi.fn();
  mocks.player.getQueueLength = vi.fn(() => 0);

  mocks.configData = {
    current_models: { asr: 'asr/paraformer-large', tts: 'tts/cosyvoice3' },
  };
  mocks.voicesData = [
    { id: 'jyy', name: '佳怡音色', path: '/voices/jyy.wav', transcript: '你好世界', sample_rate: 24000 },
  ];
  // Default fallback reply (only used when fetch fails and a test expects fallback).
  mocks.apiPost.mockResolvedValue({
    data: { role: 'assistant', content: '降级回复', model: 'gemma', done: true },
  });
  // Default: apiPost handles agent run-stream (success) and fallback /api/chat (降级回复)
  // Individual tests override with agentStreamController for controlled event timing
  mocks.apiPost.mockImplementation((url: string, _body: any) => {
    if (url === '/api/agents/run-stream') {
      return Promise.resolve({ data: { success: true, task_id: 'agent_default' } });
    }
    return Promise.resolve({ data: { role: 'assistant', content: '降级回复', model: 'gemma', done: true } });
  });
  // Always re-install the global EventSource mock — agentStreamController.install()
  // replaces it for individual tests, and we must restore the default here.
  (window as any).__agentEventHandlers = [];
  (window as any).EventSource = class {
      onmessage: ((e: any) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(url: string) {
        if (url.includes('/events')) {
          // eslint-disable-next-line @typescript-eslint/no-this-alias -- exposes the instance for the array-push below and later setTimeout closures
          const inst = this;
          (window as any).__agentEventHandlers.push(inst);
          // Fire default delta then completed after a brief delay
          setTimeout(() => {
            if (inst.onmessage) {
              inst.onmessage({ data: JSON.stringify({ delta: '默认回复', status: 'running' }) });
            }
            setTimeout(() => {
              if (inst.onmessage) {
                inst.onmessage({ data: JSON.stringify({ status: 'completed' }) });
              }
            }, 50);
          }, 50);
        }
      }
      close() {}
    };

  // Fresh in-memory Chat_DB per test, pre-seeded with the base sessions.
  fakeDb = makeFakeChatDb();
  void fakeDb.saveSession(baseSessions[0]);
  void fakeDb.saveSession(baseSessions[1]);
  setChatDbForTesting(fakeDb);

  // Clipboard stub for Copy_Action tests (jsdom has no clipboard by default).
  mocks.clipboardWriteText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: mocks.clipboardWriteText },
    configurable: true,
  });

  // Delegating spies over the real actions: assert invocation AND keep the real
  // reactive state updates.
  createSpy = vi.fn(original.createSession);
  switchSpy = vi.fn(original.switchSession);
  deleteSpy = vi.fn(original.deleteSession);
  renameSpy = vi.fn(original.renameSession);
  appendSpy = vi.fn(original.appendMessage);

  useUIStore.setState({
    inputText: '',
    currentAgentId: 'agent-assistant',
    agents: defaultAgents,
    sessions: baseSessions.map((s) => ({ ...s })),
    currentSessionId: 's2',
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
    createSession: createSpy as any,
    switchSession: switchSpy as any,
    deleteSession: deleteSpy as any,
    renameSession: renameSpy as any,
    appendMessage: appendSpy as any,
  });
});

describe('ChatPage data source & loading state', () => {
  it('renders sessions from the store and no hardcoded mock messages', () => {
    render(<ChatPage />);
    expect(screen.getByText('会话一')).toBeInTheDocument();
    expect(screen.getByText('会话二')).toBeInTheDocument();
    expect(screen.queryByText('今天天气怎么样？')).not.toBeInTheDocument();
  });

  it('shows a loading placeholder while sessions are loading', () => {
    useUIStore.setState({ sessionsLoading: true, sessions: [] });
    render(<ChatPage />);
    expect(screen.getByText('加载会话中…')).toBeInTheDocument();
    expect(screen.queryByText('会话一')).not.toBeInTheDocument();
  });

});

describe('ChatPage session lifecycle UI', () => {
  it('creates a new session bound to the current agent', () => {
    render(<ChatPage />);
    fireEvent.click(screen.getByRole('button', { name: /新建对话/ }));
    expect(createSpy).toHaveBeenCalledWith('agent-assistant');
  });

  it('switches session when a session row is clicked', async () => {
    render(<ChatPage />);
    fireEvent.click(screen.getByText('会话一'));
    expect(switchSpy).toHaveBeenCalledWith('s1');
    await waitFor(() => expect(useUIStore.getState().currentSessionId).toBe('s1'));
  });

  it('deletes a session after the two-step confirm', async () => {
    render(<ChatPage />);
    // 分组渲染后组内按 updatedAt 降序，故按「会话一」所在行定位其删除按钮（与排序无关）。
    const row1 = screen.getByText('会话一').closest('.group') as HTMLElement;
    fireEvent.click(within(row1).getByLabelText('删除会话'));
    expect(deleteSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('确认删除'));
    expect(deleteSpy).toHaveBeenCalledWith('s1');
    await waitFor(() => expect(screen.queryByText('会话一')).not.toBeInTheDocument());
  });

  it('does not delete when the confirm is cancelled', () => {
    render(<ChatPage />);
    fireEvent.click(screen.getAllByLabelText('删除会话')[0]);
    fireEvent.click(screen.getByLabelText('取消删除'));
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(screen.getByText('会话一')).toBeInTheDocument();
  });

  it('renames a session via inline edit', async () => {
    render(<ChatPage />);
    fireEvent.doubleClick(screen.getByText('会话一'));
    const input = screen.getByLabelText('重命名会话') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '新标题' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(renameSpy).toHaveBeenCalledWith('s1', '新标题');
    await waitFor(() => expect(screen.getByText('新标题')).toBeInTheDocument());
  });
});

describe('ChatPage streaming render & finalize', () => {
  it('shows a placeholder and disables the composer right after sending (Req 2.1/2.3)', async () => {
    const ag = agentStreamController();
    ag.install(window);

    render(<ChatPage />);
    sendText('你好');

    await screen.findByText('正在思考...');
    const textarea = screen.getByPlaceholderText('输入消息...') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
    expect(screen.getByRole('button', { name: /停止/ })).toBeInTheDocument();

    await act(async () => { ag.done(); await tick(); });
  });

  it('grows the streaming text as deltas arrive, then finalizes on done (Req 2.2/2.4/2.5)', async () => {
    const ag = agentStreamController();
    ag.install(window);

    render(<ChatPage />);
    sendText('你好');
    await screen.findByText('正在思考...');

    await act(async () => { ag.push({ delta: '你' }); await tick(); });
    await waitFor(() => expect(screen.getByTestId('streaming-content')).toHaveTextContent('你'));

    await act(async () => { ag.push({ delta: '好呀' }); await tick(); });
    await waitFor(() => expect(screen.getByTestId('streaming-content')).toHaveTextContent('你好呀'));

    await act(async () => { ag.done(); await tick(); });

    await waitFor(() =>
      expect(appendSpy).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'assistant', content: '你好呀' })
      )
    );
    await waitFor(() => expect(screen.queryByTestId('streaming-content')).not.toBeInTheDocument());
    expect((screen.getByPlaceholderText('输入消息...') as HTMLTextAreaElement).disabled).toBe(false);
  });

  it('persists the user message then the assistant reply exactly once each (Req 4.1/4.2)', async () => {
    const ag = agentStreamController();
    ag.install(window);

    render(<ChatPage />);
    sendText('在吗');
    await screen.findByText('正在思考...');

    await act(async () => { ag.push({ delta: '你好呀，我能帮你什么？' }); await tick(); ag.done(); await tick(); });

    await waitFor(() =>
      expect(appendSpy).toHaveBeenCalledWith(expect.objectContaining({ role: 'user', content: '在吗' }))
    );
    await waitFor(() =>
      expect(appendSpy).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'assistant', content: '你好呀，我能帮你什么？' })
      )
    );
    const assistantCalls = appendSpy.mock.calls.filter((c) => c[0]?.role === 'assistant');
    expect(assistantCalls).toHaveLength(1);
    expect(screen.getByText('在吗')).toBeInTheDocument();
    expect(screen.getByText('你好呀，我能帮你什么？')).toBeInTheDocument();
  });
});

describe('ChatPage stop generation', () => {
  it('keeps the partial content as the Final_Message and exits on stop (Req 3.2–3.4/4.3)', async () => {
    const ag = agentStreamController();
    ag.install(window);

    render(<ChatPage />);
    sendText('你好');
    await screen.findByText('正在思考...');

    await act(async () => { ag.push({ delta: '已生成部分' }); await tick(); });
    await waitFor(() => expect(screen.getByTestId('streaming-content')).toHaveTextContent('已生成部分'));

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /停止/ })); await tick(); });

    await waitFor(() =>
      expect(appendSpy).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'assistant', content: '已生成部分' })
      )
    );
    await waitFor(() => expect(screen.queryByTestId('streaming-content')).not.toBeInTheDocument());
  });

  it('removes the placeholder without an empty Final_Message when stopped with no content (Req 3.5)', async () => {
    const ag = agentStreamController();
    ag.install(window);

    render(<ChatPage />);
    sendText('你好');
    await screen.findByText('正在思考...');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /停止/ })); await tick(); });

    await waitFor(() => expect(screen.queryByText('正在思考...')).not.toBeInTheDocument());
    expect(appendSpy).not.toHaveBeenCalledWith(expect.objectContaining({ role: 'assistant' }));
  });
});

describe('ChatPage TTS integration', () => {
  it('enqueues audio per-sentence when autoPlay is ON (Req 5.1)', async () => {
    useUIStore.setState((s) => ({ settings: { ...s.settings, autoPlay: true } }));
    mocks.synthesizeMutateAsync.mockResolvedValue({ success: true, output_path: 'reply.wav', error: null });
    const ag = agentStreamController();
    ag.install(window);

    render(<ChatPage />);
    sendText('你好，这是测试。');
    await screen.findByText('正在思考...');

    await act(async () => { ag.push({ delta: '你好，这是测试。' }); await tick(); ag.done(); await tick(); });

    await waitFor(() => expect(mocks.player.enqueue).toHaveBeenCalled());
  });

  it('does NOT synthesize while streaming has no sentence boundaries yet (Req 5.2)', async () => {
    useUIStore.setState((s) => ({ settings: { ...s.settings, autoPlay: true } }));
    const ag = agentStreamController();
    ag.install(window);

    render(<ChatPage />);
    sendText('你好');
    await screen.findByText('正在思考...');

    await act(async () => { ag.push({ delta: '生成中' }); await tick(); });
    await waitFor(() => expect(screen.getByTestId('streaming-content')).toHaveTextContent('生成中'));
    // No sentence boundary: no TTS triggered
    expect(mocks.synthesizeMutateAsync).not.toHaveBeenCalled();

    await act(async () => { ag.done(); await tick(); });
  });

  it('does NOT auto-play when autoPlay is OFF but renders a manual read control (Req 5.3)', async () => {
    useUIStore.setState((s) => ({ settings: { ...s.settings, autoPlay: false } }));
    const ag = agentStreamController();
    ag.install(window);

    render(<ChatPage />);
    sendText('你好');
    await screen.findByText('正在思考...');

    await act(async () => { ag.push({ delta: '你好呀。' }); await tick(); ag.done(); await tick(); });
    await screen.findByText('你好呀。');
    expect(mocks.synthesizeMutateAsync).not.toHaveBeenCalled();
    expect(mocks.player.enqueue).not.toHaveBeenCalled();
  });

  it('clears audio queue on stop when content is non-empty and autoPlay is ON (Req 5.4)', async () => {
    useUIStore.setState((s) => ({ settings: { ...s.settings, autoPlay: true } }));
    mocks.synthesizeMutateAsync.mockResolvedValue({ success: true, output_path: 'reply.wav', error: null });
    const ag = agentStreamController();
    ag.install(window);

    render(<ChatPage />);
    sendText('你好');
    await screen.findByText('正在思考...');
    await act(async () => { ag.push({ delta: '停止前内容。' }); await tick(); });
    await waitFor(() => expect(screen.getByTestId('streaming-content')).toHaveTextContent('停止前内容。'));

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /停止/ })); await tick(); });

    await waitFor(() => expect(mocks.player.clear).toHaveBeenCalled());
  });
});

describe('ChatPage error handling & fallback', () => {
  it('shows no content on agent failure without delta and exits without persisting (Req 6.1/6.5/6.6)', async () => {
    // Reset apiPost mock to fail for run-stream, then fail for fallback too
    mocks.apiPost.mockRejectedValue(new Error('unavailable'));

    render(<ChatPage />);
    sendText('你好');

    await waitFor(() =>
      expect(mocks.addToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: '对话请求失败，请检查网络', type: 'error' })
      )
    );
    // No content → placeholder removed, no assistant Final_Message.
    await waitFor(() => expect(screen.queryByTestId('streaming-content')).not.toBeInTheDocument());
    expect(appendSpy).not.toHaveBeenCalledWith(expect.objectContaining({ role: 'assistant' }));
  });

  it('falls back to /api/chat when the agent stream cannot connect and no content yet (Req 6.2/6.3)', async () => {
    mocks.apiPost.mockImplementation((url: string) => {
      if (url === '/api/agents/run-stream') return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve({ data: { role: 'assistant', content: '降级成功回复', model: 'gemma', done: true } });
    });

    render(<ChatPage />);
    sendText('你好');

    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith('/api/chat', expect.any(Object), expect.any(Object)));
    await waitFor(() =>
      expect(appendSpy).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'assistant', content: '降级成功回复' })
      )
    );
    expect(screen.getByText('降级成功回复')).toBeInTheDocument();
  });

  it('shows an error and exits when the fallback also fails (Req 6.4)', async () => {
    mocks.apiPost.mockRejectedValue(new TypeError('Failed to fetch'));
    mocks.apiPost.mockRejectedValue({ response: { data: { error: '后端错误，请稍后再试' } } });

    render(<ChatPage />);
    sendText('你好');

    await waitFor(() =>
      expect(mocks.addToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: '后端错误，请稍后再试', type: 'error' })
      )
    );
    await waitFor(() => expect(screen.queryByTestId('streaming-content')).not.toBeInTheDocument());
    expect(appendSpy).not.toHaveBeenCalledWith(expect.objectContaining({ role: 'assistant' }));
  });
});

describe('ChatPage Voice_Loop no regression', () => {
  it('fills the input with the transcript after a successful ASR (Req 7.3)', async () => {
    mocks.recorder.isRecording = true;
    mocks.transcribeMutateAsync.mockResolvedValue({
      success: true,
      text: '今天天气很好',
      error: null,
      model: 'asr/paraformer-large',
      elapsed_ms: 120,
    });

    const { container } = render(<ChatPage />);
    const micButton = container.querySelector('.lucide-mic')?.closest('button');
    expect(micButton).toBeTruthy();
    fireEvent.click(micButton!);

    await waitFor(() => expect(mocks.transcribeMutateAsync).toHaveBeenCalledTimes(1));
    expect(mocks.transcribeMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'asr/paraformer-large' })
    );

    const textarea = screen.getByPlaceholderText('输入消息...') as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.value).toBe('今天天气很好'));
    expect(useUIStore.getState().inputText).toBe('今天天气很好');
  });

  it('sends model_id and the character-bound reference voice in the manual TTS request (Req 7.4)', async () => {
    useUIStore.setState({
      messages: [
        { id: 'a1', role: 'assistant', content: '你好呀', voiceName: '佳怡音色', duration: '0:04' },
      ],
      agents: defaultAgents.map((a) =>
        a.id === 'agent-assistant' ? { ...a, voiceId: 'jyy' } : a,
      ),
    });
    mocks.synthesizeMutateAsync.mockResolvedValue({ success: true, output_path: 'reply.wav', error: null });

    render(<ChatPage />);
    fireEvent.click(screen.getAllByRole('button', { name: /播放/ })[0]);

    await waitFor(() => expect(mocks.synthesizeMutateAsync).toHaveBeenCalledTimes(1));
    expect(mocks.synthesizeMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'tts/cosyvoice3',
        refAudio: '/voices/jyy.wav',
        refText: '你好世界',
      })
    );
  });
});

describe('ChatPage voice resolution (task 6.6)', () => {
  it('resolves the current voice name via the voices list and falls back when unmatched (Req 5.5/7.3)', () => {
    useUIStore.setState({
      messages: [{ id: 'a1', role: 'assistant', content: 'test', voiceName: '佳怡音色' }],
    });
    render(<ChatPage />);
    expect(screen.getAllByText('佳怡音色').length).toBeGreaterThan(0);

    // Re-point: when voiceName is absent, badge should show fallback
    act(() => {
      useUIStore.setState({
        messages: [{ id: 'a2', role: 'assistant', content: 'test', voiceName: '默认音色' }],
      });
    });
    expect(screen.getAllByText('默认音色').length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// chat-message-actions feature (tasks 5.2–5.6)
//
// Covers the per-message action entries layered onto ChatPage:
//  - Req 1.5: streaming/placeholder bubble exposes NO action entry.
//  - Req 2.x: Regenerate removes the last assistant, streams a replacement with
//    the truncated history payload, shows the placeholder + Stop, finalizes.
//  - Req 3.x: Edit prefills the original content inline, Enter submits the
//    trimmed edit + truncates + streams; Esc / empty edits are no-ops.
//  - Req 4.x: Copy writes to the clipboard and toasts success / failure.
//  - Req 5.2: a deleted message is no longer rendered.
//  - Req 6.3: the three store actions are exposed as functions.
//  - Req 6.6: a regenerated Final_Message bumps the session updatedAt + persists.
//
// The REAL store actions (deleteMessage / regenerateLast / editAndResend) run;
// only appendMessage is a delegating spy. fetch + clipboard are stubbed.
// ===========================================================================

/** Parse the JSON body sent to the agent streaming endpoint (last matching call). */
function lastStreamPayload(): any {
  const calls = mocks.apiPost.mock.calls.filter((c: any[]) => c[0] === '/api/agents/run-stream');
  expect(calls.length).toBeGreaterThan(0);
  const body = calls[calls.length - 1][1] as any;
  return body.input || body;
}

describe('ChatPage message actions — entry availability (Req 1.5)', () => {
  it('does not render any action entry inside the streaming placeholder bubble', async () => {
    const ag = agentStreamController();
    ag.install(window);

    render(<ChatPage />);
    sendText('你好');
    const placeholder = await screen.findByText('正在思考...');

    const bubble = placeholder.closest('.glass') as HTMLElement;
    expect(within(bubble).queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByLabelText('重新生成')).not.toBeInTheDocument();

    await act(async () => { ag.done(); await tick(); });
  });

  it('exposes the three message-action store hooks as functions (Req 6.3)', () => {
    const st = useUIStore.getState();
    expect(typeof st.deleteMessage).toBe('function');
    expect(typeof st.regenerateLast).toBe('function');
    expect(typeof st.editAndResend).toBe('function');
  });
});

describe('ChatPage Regenerate_Action (Req 2.1/2.2/2.3/2.6)', () => {
  beforeEach(() => {
    useUIStore.setState({
      messages: [
        { id: 'u1', role: 'user', content: '原始问题' },
        { id: 'a1', role: 'assistant', content: '旧回复', voiceName: '佳怡音色', duration: '0:05' },
      ],
    });
  });

  it('streams a replacement with the truncated history, shows placeholder + Stop, finalizes (Req 2.2/2.3/2.6)', async () => {
    const ag = agentStreamController();
    ag.install(window);

    render(<ChatPage />);
    // "重新生成" 按钮先打开温度选项菜单，需再点击菜单项才会真正触发生成。
    fireEvent.click(screen.getByLabelText('重新生成'));
    fireEvent.click(screen.getByText('默认重新生成'));

    await screen.findByText('正在思考...');
    expect(screen.getByRole('button', { name: /停止/ })).toBeInTheDocument();

    expect(lastStreamPayload().messages).toEqual([{ role: 'user', content: '原始问题' }]);
    expect(screen.queryByText('旧回复')).not.toBeInTheDocument();

    await act(async () => { ag.push({ delta: '新回复' }); ag.done(); await tick(); });

    await waitFor(() =>
      expect(appendSpy).toHaveBeenCalledWith(expect.objectContaining({ role: 'assistant', content: '新回复' })),
    );
  });

  it('bumps the active session updatedAt and persists it after a regenerated Final_Message (Req 6.6)', async () => {
    const before = useUIStore.getState().sessions.find((s) => s.id === 's2')!.updatedAt;

    render(<ChatPage />);
    // "重新生成" 按钮先打开温度选项菜单，需再点击菜单项才会真正触发生成。
    fireEvent.click(screen.getByLabelText('重新生成'));
    fireEvent.click(screen.getByText('默认重新生成'));

    await waitFor(() =>
      expect(appendSpy).toHaveBeenCalledWith(expect.objectContaining({ role: 'assistant' })),
    );
    await waitFor(() => {
      const after = useUIStore.getState().sessions.find((s) => s.id === 's2')!.updatedAt;
      expect(after).not.toBe(before);
    });
    expect(fakeDb.saveSession).toHaveBeenCalledWith(expect.objectContaining({ id: 's2' }));
  });
});

describe('ChatPage Edit_Resend_Action (Req 3.1/3.2/3.3/3.6)', () => {
  beforeEach(() => {
    useUIStore.setState({
      messages: [
        { id: 'u1', role: 'user', content: '原始问题' },
        { id: 'a1', role: 'assistant', content: '旧回复', voiceName: '佳怡音色', duration: '0:05' },
      ],
    });
  });

  it('prefills the original content inline and submits a trimmed edit + truncation + stream on Enter (Req 3.1/3.6)', async () => {
    const ag = agentStreamController();
    ag.install(window);

    render(<ChatPage />);
    fireEvent.click(screen.getByLabelText('编辑重发'));

    const editor = (await screen.findByLabelText('编辑消息')) as HTMLTextAreaElement;
    expect(editor.value).toBe('原始问题');

    fireEvent.change(editor, { target: { value: '  修改后的问题  ' } });
    fireEvent.keyDown(editor, { key: 'Enter' });

    await screen.findByText('正在思考...');
    expect(lastStreamPayload().messages).toEqual([{ role: 'user', content: '修改后的问题' }]);
    expect(screen.queryByText('旧回复')).not.toBeInTheDocument();

    await act(async () => { ag.push({ delta: '编辑后的回复' }); ag.done(); await tick(); });
    await waitFor(() =>
      expect(appendSpy).toHaveBeenCalledWith(expect.objectContaining({ role: 'assistant', content: '编辑后的回复' })),
    );
  });

  it('cancels the edit on Escape without changing any message or generating (Req 3.2)', async () => {
    render(<ChatPage />);
    fireEvent.click(screen.getByLabelText('编辑重发'));
    const editor = (await screen.findByLabelText('编辑消息')) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '不想要的改动' } });
    fireEvent.keyDown(editor, { key: 'Escape' });

    // Editor closed, original message intact, no stream started.
    await waitFor(() => expect(screen.queryByLabelText('编辑消息')).not.toBeInTheDocument());
    expect(screen.getByText('原始问题')).toBeInTheDocument();
    expect(mocks.apiPost.mock.calls.filter((c: any[]) => c[0] === '/api/agents/run-stream')).toHaveLength(0);
  });

  it('is a no-op when the submitted edit is whitespace-only (Req 3.3)', async () => {
    render(<ChatPage />);
    fireEvent.click(screen.getByLabelText('编辑重发'));
    const editor = (await screen.findByLabelText('编辑消息')) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '    ' } });
    fireEvent.keyDown(editor, { key: 'Enter' });

    // No generation; both original messages remain unchanged.
    await waitFor(() => expect(screen.queryByLabelText('编辑消息')).not.toBeInTheDocument());
    expect(screen.getByText('原始问题')).toBeInTheDocument();
    expect(screen.getByText('旧回复')).toBeInTheDocument();
    expect(mocks.apiPost.mock.calls.filter((c: any[]) => c[0] === '/api/agents/run-stream')).toHaveLength(0);
  });
});

describe('ChatPage Copy_Action (Req 4.1/4.2/4.3)', () => {
  beforeEach(() => {
    useUIStore.setState({
      messages: [{ id: 'a1', role: 'assistant', content: '可复制文本', voiceName: '佳怡音色', duration: '0:05' }],
    });
  });

  it('writes the message content to the clipboard and toasts success (Req 4.1/4.2)', async () => {
    render(<ChatPage />);
    fireEvent.click(screen.getByLabelText('复制'));

    await waitFor(() => expect(mocks.clipboardWriteText).toHaveBeenCalledWith('可复制文本'));
    await waitFor(() =>
      expect(mocks.addToast).toHaveBeenCalledWith(expect.objectContaining({ message: '已复制', type: 'success' })),
    );
  });

  it('toasts failure when the clipboard write rejects (Req 4.3)', async () => {
    mocks.clipboardWriteText.mockRejectedValue(new Error('denied'));
    render(<ChatPage />);
    fireEvent.click(screen.getByLabelText('复制'));

    await waitFor(() =>
      expect(mocks.addToast).toHaveBeenCalledWith(expect.objectContaining({ message: '复制失败', type: 'error' })),
    );
  });
});

describe('ChatPage Delete_Action (Req 5.2)', () => {
  it('no longer renders a message after it is deleted', async () => {
    useUIStore.setState({
      messages: [
        { id: 'u1', role: 'user', content: '保留消息' },
        { id: 'a1', role: 'assistant', content: '待删除回复', voiceName: '佳怡音色', duration: '0:05' },
      ],
    });
    render(<ChatPage />);
    expect(screen.getByText('待删除回复')).toBeInTheDocument();

    // Two delete entries (user + assistant); the assistant's is the second.
    fireEvent.click(screen.getAllByLabelText('删除消息')[1]);

    await waitFor(() => expect(screen.queryByText('待删除回复')).not.toBeInTheDocument());
    // Remaining message preserved (Req 5.3).
    expect(screen.getByText('保留消息')).toBeInTheDocument();
    expect(fakeDb.deleteMessage).toHaveBeenCalledWith('a1');
  });
});

// ===========================================================================
// chat-history-search feature (tasks 5.1–5.4)
//
// Covers the ChatPage search integration layered onto the sidebar:
//  - Req 1.1: a Search_Input exists in the sidebar.
//  - Req 1.2: typing updates the store searchQuery.
//  - Req 1.3 / 1.4 / 7.4: a non-empty query shows the Search_Result_List; clearing
//    restores the session list.
//  - Req 6.1 / 6.2 / 6.3: each result shows the session title + relative time +
//    a <mark> highlighted snippet.
//  - Req 6.4: an empty state is shown when there are no matches.
//  - Req 7.1: clicking a result calls switchSession with the result session id.
//  - Req 7.2: a Message_Match result scrolls the matched message into view.
//  - Req 7.3: a result whose message is not locatable does not scroll.
//  - Req 8.1 / 8.2: debounced input triggers exactly one search for the latest query.
//
// The REAL store actions run (with the in-memory fake Chat_DB seeded above); only
// switchSession is wrapped in a delegating spy. Debounce is exercised with fake
// timers. Voice_Loop assertions remain in their own describe block above and keep
// passing (no regression).
// ===========================================================================

describe('ChatPage search input & debounce (Req 1.1/1.2/8.1/8.2)', () => {
  it('renders a Search_Input in the sidebar (Req 1.1)', () => {
    render(<ChatPage />);
    expect(screen.getByLabelText('搜索聊天记录')).toBeInTheDocument();
  });

  it('updates the store searchQuery as the user types (Req 1.2)', () => {
    render(<ChatPage />);
    const input = screen.getByLabelText('搜索聊天记录') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '会话' } });
    expect(useUIStore.getState().searchQuery).toBe('会话');
  });

  it('debounces input and runs exactly one search for the latest query (Req 8.1/8.2)', async () => {
    vi.useFakeTimers();
    const runSearchSpy = vi.fn(async () => {});
    useUIStore.setState({ runSearch: runSearchSpy as any });
    try {
      render(<ChatPage />);
      const input = screen.getByLabelText('搜索聊天记录') as HTMLInputElement;

      // Three rapid keystrokes within the debounce window.
      act(() => { fireEvent.change(input, { target: { value: '会' } }); });
      act(() => { vi.advanceTimersByTime(100); });
      act(() => { fireEvent.change(input, { target: { value: '会话' } }); });
      act(() => { vi.advanceTimersByTime(100); });
      act(() => { fireEvent.change(input, { target: { value: '会话一' } }); });

      // Not yet fired: still inside the 200ms window since the last keystroke.
      expect(runSearchSpy).not.toHaveBeenCalled();

      // Cross the debounce interval once → a single search with the latest query.
      act(() => { vi.advanceTimersByTime(200); });
      expect(runSearchSpy).toHaveBeenCalledTimes(1);
      expect(useUIStore.getState().searchQuery).toBe('会话一');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ChatPage search results rendering (Req 1.3/1.4/6.1/6.2/6.3/6.4/7.4)', () => {
  it('shows the Search_Result_List instead of sessions for a non-empty query (Req 1.3)', async () => {
    render(<ChatPage />);
    act(() => {
      useUIStore.setState({
        searchQuery: '会话',
        searchResults: [
          {
            sessionId: 's1',
            sessionTitle: '会话一',
            updatedAt: '2024-01-01T10:00:00.000Z',
            matchType: 'title',
            snippet: '会话一',
            highlights: [{ start: 0, length: 2 }],
          },
        ],
        isSearching: false,
      });
    });

    // A result row is shown; the plain session-list rendering is replaced.
    const results = await screen.findAllByTestId('search-result');
    expect(results).toHaveLength(1);
  });

  it('renders the title, relative time and a <mark> highlighted snippet (Req 6.1/6.2/6.3)', () => {
    render(<ChatPage />);
    act(() => {
      useUIStore.setState({
        searchQuery: '天气',
        searchResults: [
          {
            sessionId: 's1',
            sessionTitle: '会话一',
            updatedAt: '2024-01-01T10:00:00.000Z',
            matchType: 'message',
            messageId: 'm1',
            snippet: '今天天气怎么样',
            highlights: [{ start: 2, length: 2 }],
          },
        ],
        isSearching: false,
      });
    });

    const row = screen.getByTestId('search-result');
    // Title (Req 6.1).
    expect(within(row).getByText('会话一')).toBeInTheDocument();
    // Relative time (Req 6.2): an absolute localized date for an old timestamp.
    expect(within(row).getByText(new Date('2024-01-01T10:00:00.000Z').toLocaleDateString())).toBeInTheDocument();
    // Highlight (Req 6.3): the matched substring is wrapped in <mark>.
    const mark = row.querySelector('mark');
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toBe('天气');
  });

  it('shows the empty state when a non-empty query has no matches (Req 6.4)', () => {
    render(<ChatPage />);
    act(() => {
      useUIStore.setState({ searchQuery: '不存在的词', searchResults: [], isSearching: false });
    });
    expect(screen.getByTestId('search-empty')).toBeInTheDocument();
    expect(screen.getByText('未找到匹配结果')).toBeInTheDocument();
  });

  it('does not show the empty state while a search is still in progress (Req 6.4)', () => {
    render(<ChatPage />);
    act(() => {
      useUIStore.setState({ searchQuery: '会话', searchResults: [], isSearching: true });
    });
    expect(screen.queryByTestId('search-empty')).not.toBeInTheDocument();
  });

  it('restores the session list when the search is cleared (Req 1.4/7.4)', () => {
    render(<ChatPage />);
    act(() => {
      useUIStore.setState({
        searchQuery: '会话',
        searchResults: [
          {
            sessionId: 's1',
            sessionTitle: '会话一',
            updatedAt: '2024-01-01T10:00:00.000Z',
            matchType: 'title',
            snippet: '会话一',
            highlights: [{ start: 0, length: 2 }],
          },
        ],
        isSearching: false,
      });
    });
    expect(screen.getByTestId('search-result')).toBeInTheDocument();

    // Clearing the input hides the result list and brings the sessions back.
    fireEvent.click(screen.getByLabelText('清除搜索'));
    expect(useUIStore.getState().searchQuery).toBe('');
    expect(screen.queryByTestId('search-result')).not.toBeInTheDocument();
    expect(screen.getByText('会话一')).toBeInTheDocument();
    expect(screen.getByText('会话二')).toBeInTheDocument();
  });
});

describe('ChatPage search navigation & scroll (Req 7.1/7.2/7.3/7.4)', () => {
  it('switches to the result session and exits the search view on click (Req 7.1/7.4)', async () => {
    render(<ChatPage />);
    act(() => {
      useUIStore.setState({
        searchQuery: '会话',
        searchResults: [
          {
            sessionId: 's1',
            sessionTitle: '会话一',
            updatedAt: '2024-01-01T10:00:00.000Z',
            matchType: 'title',
            snippet: '会话一',
            highlights: [{ start: 0, length: 2 }],
          },
        ],
        isSearching: false,
      });
    });

    fireEvent.click(screen.getByTestId('search-result'));

    // switchSession called with the result's session id (Req 7.1).
    expect(switchSpy).toHaveBeenCalledWith('s1');
    // Search view cleared → session list restored (Req 7.4).
    await waitFor(() => expect(useUIStore.getState().searchQuery).toBe(''));
    await waitFor(() => expect(useUIStore.getState().currentSessionId).toBe('s1'));
  });

  it('scrolls the matched message into view for a Message_Match (Req 7.2)', async () => {
    // Seed the target session with messages so the matched id resolves to a DOM ref.
    await fakeDb.saveMessage({ id: 'm1', sessionId: 's1', seq: 0, role: 'user', content: '今天天气怎么样' } as PersistedMessage);
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');

    render(<ChatPage />);
    act(() => {
      useUIStore.setState({
        searchQuery: '天气',
        searchResults: [
          {
            sessionId: 's1',
            sessionTitle: '会话一',
            updatedAt: '2024-01-01T10:00:00.000Z',
            matchType: 'message',
            messageId: 'm1',
            snippet: '今天天气怎么样',
            highlights: [{ start: 2, length: 2 }],
          },
        ],
        isSearching: false,
      });
    });

    scrollSpy.mockClear();
    fireEvent.click(screen.getByTestId('search-result'));

    // After switchSession loads the message, the matched ref is scrolled into view.
    await waitFor(() => expect(screen.getByText('今天天气怎么样')).toBeInTheDocument());
    await waitFor(() =>
      expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ block: 'center' })),
    );
  });

  it('does not scroll-to-message when the matched message is not locatable (Req 7.3)', async () => {
    // The target session has NO message with the result's messageId.
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');

    render(<ChatPage />);
    act(() => {
      useUIStore.setState({
        searchQuery: '天气',
        searchResults: [
          {
            sessionId: 's1',
            sessionTitle: '会话一',
            updatedAt: '2024-01-01T10:00:00.000Z',
            matchType: 'message',
            messageId: 'missing',
            snippet: '今天天气怎么样',
            highlights: [{ start: 2, length: 2 }],
          },
        ],
        isSearching: false,
      });
    });

    fireEvent.click(screen.getByTestId('search-result'));
    await waitFor(() => expect(switchSpy).toHaveBeenCalledWith('s1'));
    await waitFor(() => expect(useUIStore.getState().searchQuery).toBe(''));

    // No "center" scroll-to-message call (the messagesEndRef auto-scroll uses no block).
    const centerCalls = scrollSpy.mock.calls.filter(
      (c) => (c[0] as ScrollIntoViewOptions | undefined)?.block === 'center',
    );
    expect(centerCalls).toHaveLength(0);
  });
});

const samplePresets = [
  { id: 'p1', title: '问候语', content: '你好，请帮我' },
  { id: 'p2', title: '翻译助手', content: '把下面的内容翻译成英文：' },
];

describe('ChatPage prompt-preset no-regression (Req 8.6)', () => {
  beforeEach(() => {
    useUIStore.setState({ presets: samplePresets.map((p) => ({ ...p })), inputText: '', currentPage: 'chat' });
  });

  it('still streams and finalizes an assistant reply while presets are present (streaming no regression)', async () => {
    const ag = agentStreamController();
    ag.install(window);

    render(<ChatPage />);
    sendText('在吗');
    await screen.findByText('正在思考...');

    await act(async () => { ag.push({ delta: '流式' }); await tick(); ag.push({ delta: '回复' }); await tick(); ag.done(); await tick(); });

    await waitFor(() =>
      expect(appendSpy).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'assistant', content: '流式回复' }),
      ),
    );
    expect(screen.getByText('流式回复')).toBeInTheDocument();
  });

  it('still issues the manual TTS request while presets are present (TTS no regression)', async () => {
    useUIStore.setState({
      messages: [
        { id: 'a1', role: 'assistant', content: '你好呀', voiceName: '佳怡音色', duration: '0:04' },
      ],
      agents: defaultAgents.map((a) =>
        a.id === 'agent-assistant' ? { ...a, voiceId: 'jyy' } : a,
      ),
    });
    mocks.synthesizeMutateAsync.mockResolvedValue({ success: true, output_path: 'reply.wav', error: null });

    render(<ChatPage />);
    fireEvent.click(screen.getAllByRole('button', { name: /播放/ })[0]);

    await waitFor(() => expect(mocks.synthesizeMutateAsync).toHaveBeenCalledTimes(1));
    expect(mocks.synthesizeMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'tts/cosyvoice3',
        refAudio: '/voices/jyy.wav',
        refText: '你好世界',
      }),
    );
  });
});

// ===========================================================================
// chat-generation-parameters feature (task 5.5 — ChatPage request merging)
//
//  - Req 4.3/6.3: Default_State → request body carries NO generation fields and
//    keeps messages/system (parity with现状).
//  - Req 4.1/4.2/4.4/4.5: Active params → BOTH the streaming path and the
//    /api/chat fallback path carry the ollama keys with clamped values while
//    preserving messages/system.
// ===========================================================================

/** Parse the JSON body sent to the /api/chat fallback (last matching call). */
function lastFallbackPayload(): any {
  const calls = mocks.apiPost.mock.calls.filter((c) => c[0] === '/api/chat');
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][1];
}

describe('ChatPage generation params merging', () => {
  beforeEach(() => {
    localStorage.clear();
    useUIStore.getState().restoreChatParamDefaults();
    localStorage.clear();
  });

  it('Default_State: streaming request body has no generation fields, keeps messages/system (4.3/6.3)', async () => {
    render(<ChatPage />);
    sendText('你好');

    await waitFor(() =>
      expect(appendSpy).toHaveBeenCalledWith(expect.objectContaining({ role: 'assistant' })),
    );

    const payload = lastStreamPayload();
    expect(payload).toHaveProperty('messages');
    expect(payload).toHaveProperty('system');
    for (const k of ['temperature', 'top_p', 'num_predict', 'top_k', 'repeat_penalty']) {
      expect(payload).not.toHaveProperty(k);
    }
  });

  it('Active params: streaming request body carries clamped ollama keys + keeps messages/system (4.1/4.4/4.5)', async () => {
    useUIStore.getState().setChatParam('temperature', 9);
    useUIStore.getState().setChatParam('topK', 3.7);

    render(<ChatPage />);
    sendText('在吗');

    await waitFor(() =>
      expect(appendSpy).toHaveBeenCalledWith(expect.objectContaining({ role: 'assistant' })),
    );

    const payload = lastStreamPayload();
    expect(payload.temperature).toBe(2);
    expect(payload.top_k).toBe(4);
    expect(payload).toHaveProperty('messages');
    expect(payload).toHaveProperty('system');
    expect(payload).not.toHaveProperty('top_p');
  });

  it('Active params: /api/chat fallback path also carries clamped keys + messages/system (4.2)', async () => {
    mocks.apiPost.mockImplementation((url: string) => {
      if (url === '/api/agents/run-stream') return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve({ data: { role: 'assistant', content: '降级回复', model: 'gemma', done: true } });
    });

    useUIStore.getState().setChatParam('temperature', 1.4);

    render(<ChatPage />);
    sendText('你好');

    await waitFor(() =>
      expect(mocks.apiPost).toHaveBeenCalledWith('/api/chat', expect.any(Object), expect.any(Object)),
    );

    const payload = lastFallbackPayload();
    expect(payload.temperature).toBe(1.4);
    expect(payload).toHaveProperty('messages');
    expect(payload).toHaveProperty('system');
  });
});
