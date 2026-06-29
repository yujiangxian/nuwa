import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  useUIStore,
  defaultCharacters,
  setChatDbForTesting,
  type ChatSession,
} from '@/store/uiStore';
import type { ChatDb, PersistedMessage } from '@/lib/chatDb';

/**
 * ChatPage export/import UI component tests (task 4.3).
 *
 * Covers Session_Sidebar export/import entries:
 *  - 导出当前 / 全部 入口含 JSON / Markdown 选项（Req 7.1, 7.2）
 *  - 隐藏 input[type=file][accept='.json']（Req 7.3）
 *  - 模拟文件选择触发 importSessions(文本)（Req 7.4）
 *  - 触发导出创建带 .json / .md download 属性的锚点并 click（Req 1.5, 2.6）
 *  - 无会话时导出入口禁用（Req 7.5）
 *
 * The hooks/clients ChatPage depends on are mocked; the REAL uiStore is used
 * with selected actions overridden by spies so we can assert wiring.
 */

const mocks = vi.hoisted(() => ({
  transcribeMutateAsync: vi.fn(),
  synthesizeMutateAsync: vi.fn(),
  apiPost: vi.fn(),
  fetch: vi.fn(),
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
    getMessages: vi.fn(async (sid: string) =>
      [...messages.values()].filter((m) => m.sessionId === sid).sort((a, b) => a.seq - b.seq).map(({ sessionId: _s, seq: _q, ...rest }) => rest),
    ),
    saveSession: vi.fn(async (s: ChatSession) => { sessions.set(s.id, s); }),
    saveMessage: vi.fn(async (m: PersistedMessage) => { messages.set(m.id, m); }),
    deleteSession: vi.fn(async (sid: string) => { sessions.delete(sid); }),
    deleteMessage: vi.fn(async (mid: string) => { messages.delete(mid); }),
    truncateMessagesAfter: vi.fn(async () => {}),
  };
}

const baseSessions: ChatSession[] = [
  { id: 's1', title: '会话一', characterId: 'assistant', voiceId: 'jyy', updatedAt: '2024-01-01T10:00:00.000Z', pinned: false },
  { id: 's2', title: '会话二', characterId: 'assistant', voiceId: 'jyy', updatedAt: '2024-01-02T10:00:00.000Z', pinned: false },
];

let importSpy: ReturnType<typeof vi.fn>;
let collectSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.configData = { current_models: { asr: 'asr/x', tts: 'tts/y' } };
  mocks.voicesData = [{ id: 'jyy', name: '佳怡音色', path: '/voices/jyy.wav', transcript: '你好', sample_rate: 24000 }];

  setChatDbForTesting(makeFakeChatDb());

  importSpy = vi.fn(async () => null);
  collectSpy = vi.fn(async (_scope: 'current' | 'all') => [
    { session: baseSessions[1], messages: [{ id: 'm1', role: 'user', content: '你好' }] },
  ]);

  useUIStore.setState({
    inputText: '',
    currentCharacterId: 'assistant',
    characters: defaultCharacters,
    sessions: baseSessions.map((s) => ({ ...s })),
    currentSessionId: 's2',
    messages: [],
    sessionsLoading: false,
    isPersistent: true,
    importSessions: importSpy as any,
    collectExportSessions: collectSpy as any,
  });
});

describe('ChatPage export/import entries', () => {
  it('renders 导出当前 / 全部 entries with JSON and Markdown options (Req 7.1, 7.2)', () => {
    render(<ChatPage />);
    expect(screen.getByRole('button', { name: '导出当前会话 JSON' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导出当前会话 Markdown' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导出全部 JSON' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导出全部 Markdown' })).toBeInTheDocument();
  });

  it('renders a hidden .json file input (Req 7.3)', () => {
    render(<ChatPage />);
    const input = screen.getByTestId('import-file-input') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.type).toBe('file');
    expect(input.accept).toBe('.json');
  });

  it('file selection reads text and calls importSessions (Req 7.4)', async () => {
    render(<ChatPage />);
    const input = screen.getByTestId('import-file-input') as HTMLInputElement;
    const payload = '{"formatVersion":"1","exportedAt":"x","sessions":[]}';
    const file = new File([payload], 'backup.json', { type: 'application/json' });
    // jsdom's Blob.text() is unreliable here; provide a deterministic text().
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(payload) });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(importSpy).toHaveBeenCalledTimes(1));
    expect(importSpy).toHaveBeenCalledWith(payload);
  });

  it('export creates an anchor with a .json download and clicks it (Req 1.5)', async () => {
    const created: HTMLAnchorElement[] = [];
    const realCreate = document.createElement.bind(document);
    const clickSpy = vi.fn();
    vi.spyOn(document, 'createElement').mockImplementation((tag: any) => {
      const el = realCreate(tag);
      if (tag === 'a') {
        (el as HTMLAnchorElement).click = clickSpy;
        created.push(el as HTMLAnchorElement);
      }
      return el;
    });

    render(<ChatPage />);
    fireEvent.click(screen.getByRole('button', { name: '导出当前会话 JSON' }));
    await waitFor(() => expect(collectSpy).toHaveBeenCalledWith('current'));
    await waitFor(() => expect(created.some((a) => a.download.endsWith('.json'))).toBe(true));
    expect(clickSpy).toHaveBeenCalled();
  });

  it('export Markdown creates an anchor with a .md download (Req 2.6)', async () => {
    const created: HTMLAnchorElement[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: any) => {
      const el = realCreate(tag);
      if (tag === 'a') { (el as HTMLAnchorElement).click = vi.fn(); created.push(el as HTMLAnchorElement); }
      return el;
    });

    render(<ChatPage />);
    fireEvent.click(screen.getByRole('button', { name: '导出全部 Markdown' }));
    await waitFor(() => expect(collectSpy).toHaveBeenCalledWith('all'));
    await waitFor(() => expect(created.some((a) => a.download.endsWith('.md'))).toBe(true));
  });

  it('disables export entries when there are no sessions (Req 7.5)', () => {
    useUIStore.setState({ sessions: [], currentSessionId: null });
    render(<ChatPage />);
    expect(screen.getByRole('button', { name: '导出当前会话 JSON' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '导出全部 Markdown' })).toBeDisabled();
  });
});
