import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useUIStore, defaultCharacters, setChatDbForTesting, type ChatSession } from '@/store/uiStore';
import type { ChatDb, PersistedMessage } from '@/lib/chatDb';

/**
 * context-window-management 集成测试：
 * - Task 8.3：warning / over 告警与 Trim_Notice 的渲染（Req 7.1–7.4）。
 * - Task 9.2：外发请求接入裁剪、契约不变（Req 6.8, 8.5）。
 */

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  apiPost: vi.fn(),
  addToast: vi.fn(),
  synthMutate: vi.fn(),
  transMutate: vi.fn(),
}));

vi.mock('@/hooks/useApi', () => ({
  useTranscribe: () => ({ mutateAsync: mocks.transMutate }),
  useSynthesize: () => ({ mutateAsync: mocks.synthMutate }),
  useConfig: () => ({ data: { current_models: { asr: 'a', tts: 't' } } }),
  useVoices: () => ({ data: [] }),
}));
vi.mock('@/hooks/useRecorder', () => ({
  useRecorder: () => ({ isRecording: false, recordingTime: 0, error: null, start: vi.fn(), stop: vi.fn() }),
}));
vi.mock('@/hooks/useAudioPlayer', () => ({
  useAudioPlayer: () => ({ playingKey: null, play: vi.fn(), stop: vi.fn(), isPlaying: () => false }),
}));
vi.mock('@/api/client', () => ({ apiClient: { post: mocks.apiPost } }));
vi.mock('@/store/toastStore', () => {
  const useToastStore: any = (selector: any) => selector({ addToast: mocks.addToast });
  useToastStore.getState = () => ({ addToast: mocks.addToast });
  return { useToastStore };
});

import ChatPage from '@/components/ChatPage';

function fullStream(objs: unknown[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const o of objs) controller.enqueue(enc.encode(JSON.stringify(o) + '\n'));
      controller.close();
    },
  });
}

function makeFakeChatDb(): ChatDb {
  const sessions = new Map<string, ChatSession>();
  const messages = new Map<string, PersistedMessage>();
  return {
    init: vi.fn(async () => {}),
    getAllSessions: vi.fn(async () => [...sessions.values()]),
    getMessages: vi.fn(async (sid: string) =>
      [...messages.values()].filter((m) => m.sessionId === sid).sort((a, b) => a.seq - b.seq).map(({ sessionId: _s, seq: _q, ...rest }) => rest),
    ),
    saveSession: vi.fn(async (s: ChatSession) => { sessions.set(s.id, s); }),
    saveMessage: vi.fn(async (m: PersistedMessage) => { messages.set(m.id, m); }),
    deleteSession: vi.fn(async () => {}),
    deleteMessage: vi.fn(async () => {}),
    truncateMessagesAfter: vi.fn(async () => {}),
  };
}

const cjk = (n: number) => '你'.repeat(n);
const baseSession: ChatSession = {
  id: 's1', title: '会话', characterId: 'assistant', voiceId: 'jyy',
  updatedAt: '2024-01-01T10:00:00.000Z', pinned: false,
};

function seed(messages: { id: string; role: 'user' | 'assistant'; content: string }[]) {
  useUIStore.setState({
    inputText: '',
    currentCharacterId: 'assistant',
    characters: defaultCharacters,
    sessions: [{ ...baseSession }],
    currentSessionId: 's1',
    messages,
    sessionsLoading: false,
    isPersistent: true,
    lastTrimmedCount: 0,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.fetch.mockResolvedValue({ ok: true, body: fullStream([{ delta: '回复' }, { done: true }]) } as any);
  const db = makeFakeChatDb();
  void db.saveSession(baseSession);
  setChatDbForTesting(db);
});

describe('ChatPage context-window indicator & alerts (Task 8.3)', () => {
  it('shows neither warning nor trim notice when usage is normal (Req 7.4)', () => {
    seed([]);
    render(<ChatPage />);
    expect(screen.getByTestId('usage-indicator')).toBeInTheDocument();
    expect(screen.queryByTestId('context-warning')).toBeNull();
    expect(screen.queryByTestId('context-over')).toBeNull();
    expect(screen.queryByTestId('context-trim-notice')).toBeNull();
  });

  it('shows the warning banner when near the limit (Req 7.1)', () => {
    // used ≈ 3004 (+512 reserved) / 4096 ≈ 0.86 → warning, 未超限
    seed([{ id: 'm1', role: 'user', content: cjk(3000) }]);
    render(<ChatPage />);
    expect(screen.getByTestId('usage-indicator').getAttribute('data-usage-state')).toBe('warning');
    expect(screen.getByTestId('context-warning')).toBeInTheDocument();
    expect(screen.queryByTestId('context-over')).toBeNull();
  });

  it('shows the over banner when above the limit (Req 7.2)', () => {
    // used ≈ 4004 (+512) > 4096 → over
    seed([{ id: 'm1', role: 'user', content: cjk(4000) }]);
    render(<ChatPage />);
    expect(screen.getByTestId('usage-indicator').getAttribute('data-usage-state')).toBe('over');
    expect(screen.getByTestId('context-over')).toBeInTheDocument();
  });

  it('shows the trim notice when lastTrimmedCount > 0 (Req 7.3)', () => {
    seed([]);
    useUIStore.setState({ lastTrimmedCount: 3 });
    render(<ChatPage />);
    const notice = screen.getByTestId('context-trim-notice');
    expect(notice).toBeInTheDocument();
    expect(notice.textContent).toContain('3');
  });
});

describe('ChatPage outgoing trim & contract invariance (Task 9.2)', () => {
  it('trims oldest history, keeps the latest user message, and keeps the request contract', async () => {
    // 6 条各 1000 CJK 字符（每条 ~1004 tokens），远超 4096-512 预算。
    const seeded = Array.from({ length: 6 }, (_, i) => ({
      id: `m${i}`,
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: cjk(1000),
    }));
    seed(seeded);
    render(<ChatPage />);

    const ta = screen.getByPlaceholderText('输入消息...');
    fireEvent.change(ta, { target: { value: '最新的问题' } });
    fireEvent.click(screen.getByRole('button', { name: /发送/ }));

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());

    const [, init] = mocks.fetch.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);

    // 契约不变：键集合仅 messages / system（默认生成参数 Inactive → 无额外字段）。
    expect(Object.keys(body).sort()).toEqual(['messages', 'system']);

    // 发生裁剪：下发消息少于「6 条历史 + 1 条新消息 = 7」。
    expect(body.messages.length).toBeLessThan(7);
    // 永不丢弃最新 user 消息。
    expect(body.messages[body.messages.length - 1]).toEqual({ role: 'user', content: '最新的问题' });
    // 下发消息每项仅含 role/content（不新增后端字段）。
    for (const m of body.messages) {
      expect(Object.keys(m).sort()).toEqual(['content', 'role']);
    }

    // store 展示态记录了本次裁剪条数，并渲染 Trim_Notice。
    await waitFor(() => expect(useUIStore.getState().lastTrimmedCount).toBeGreaterThan(0));
    expect(screen.getByTestId('context-trim-notice')).toBeInTheDocument();
  });
});
