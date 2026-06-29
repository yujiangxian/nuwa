import { describe, it, expect, beforeEach } from 'vitest';
// fake-indexeddb/auto installs the global IndexedDB constructors that jsdom
// lacks; each test injects a brand-new IDBFactory-backed Chat_DB for isolation.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createChatDb, type ChatDb } from '@/lib/chatDb';
import {
  useUIStore,
  setChatDbForTesting,
  defaultCharacters,
  type ChatSession,
} from '@/store/uiStore';
import { createFakeChatDb } from '@/store/testChatDb';
import { useToastStore } from '@/store/toastStore';

/**
 * Chat_Store 置顶（chat-session-organization）集成测试。
 *
 * 覆盖 createSession 默认未置顶（Req 1.2）、togglePin / setPinned 持久化与读回
 * （Req 3.1）、loadSessions 缺省归一与置顶恢复（Req 1.3, 3.3）、降级模式仅内存
 * （Req 3.2）、持久写入失败保留内存并提示（Req 3.4）、切换不改其他字段 / 其他会话
 * （Req 2.3, 2.4）。
 */

/** A real Chat_DB backed by a brand-new (empty) in-memory IndexedDB. */
async function freshDb(): Promise<ChatDb> {
  const db = createChatDb(new IDBFactory());
  await db.init();
  return db;
}

/** Reset the store to a clean, persistent baseline pointing at `db`. */
function baseStore(db: ChatDb): void {
  setChatDbForTesting(db);
  useUIStore.setState({
    sessions: [],
    currentSessionId: null,
    messages: [],
    sessionsLoading: false,
    isPersistent: true,
    characters: defaultCharacters,
    currentCharacterId: 'assistant',
  });
}

function mkSession(over: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 's1',
    title: '会话',
    characterId: 'assistant',
    voiceId: 'jyy',
    updatedAt: '2024-01-01T00:00:00.000Z',
    pinned: false,
    ...over,
  };
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
});

describe('createSession 默认未置顶 (Req 1.2)', () => {
  it('新建会话 pinned === false', async () => {
    const db = await freshDb();
    baseStore(db);
    await useUIStore.getState().createSession('assistant');
    const s = useUIStore.getState();
    expect(s.sessions[0].pinned).toBe(false);
    // 已落库且持久记录 pinned===false。
    const stored = await db.getAllSessions();
    expect(stored.find((x) => x.id === s.sessions[0].id)?.pinned).toBe(false);
  });
});

describe('togglePin / setPinned 持久化与读回 (Req 3.1)', () => {
  it('togglePin 取反并持久化，再读回 pinned 已更新', async () => {
    const db = await freshDb();
    baseStore(db);
    const sess = mkSession();
    await db.saveSession(sess);
    useUIStore.setState({ sessions: [sess], currentSessionId: sess.id });

    await useUIStore.getState().togglePin(sess.id);
    expect(useUIStore.getState().sessions[0].pinned).toBe(true);
    const after = await db.getAllSessions();
    expect(after.find((x) => x.id === sess.id)?.pinned).toBe(true);

    // 再次切换回 false。
    await useUIStore.getState().togglePin(sess.id);
    expect(useUIStore.getState().sessions[0].pinned).toBe(false);
    const after2 = await db.getAllSessions();
    expect(after2.find((x) => x.id === sess.id)?.pinned).toBe(false);
  });

  it('setPinned 显式置位并持久化', async () => {
    const db = await freshDb();
    baseStore(db);
    const sess = mkSession({ pinned: false });
    await db.saveSession(sess);
    useUIStore.setState({ sessions: [sess], currentSessionId: sess.id });

    await useUIStore.getState().setPinned(sess.id, true);
    expect(useUIStore.getState().sessions[0].pinned).toBe(true);
    const after = await db.getAllSessions();
    expect(after.find((x) => x.id === sess.id)?.pinned).toBe(true);
  });
});

describe('togglePin 局部性 (Req 2.3, 2.4)', () => {
  it('仅改目标会话 pinned，其余字段与其他会话不变', async () => {
    const db = await freshDb();
    baseStore(db);
    const a = mkSession({ id: 'a', title: 'A', characterId: 'socrates', voiceId: 'narrator', updatedAt: '2024-05-01T00:00:00.000Z', pinned: false });
    const b = mkSession({ id: 'b', title: 'B', updatedAt: '2024-06-01T00:00:00.000Z', pinned: false });
    await db.saveSession(a);
    await db.saveSession(b);
    useUIStore.setState({ sessions: [a, b], currentSessionId: 'a' });

    await useUIStore.getState().togglePin('a');
    const sessions = useUIStore.getState().sessions;
    const newA = sessions.find((s) => s.id === 'a')!;
    const newB = sessions.find((s) => s.id === 'b')!;

    // 目标会话仅 pinned 改变，其余字段不变。
    expect(newA.pinned).toBe(true);
    expect(newA.title).toBe('A');
    expect(newA.characterId).toBe('socrates');
    expect(newA.voiceId).toBe('narrator');
    expect(newA.updatedAt).toBe('2024-05-01T00:00:00.000Z');
    // 其他会话完全不变。
    expect(newB).toEqual(b);
  });

  it('切换不存在的 id 不抛出且不写库', async () => {
    const fake = createFakeChatDb();
    setChatDbForTesting(fake);
    const sess = mkSession();
    useUIStore.setState({
      sessions: [sess],
      currentSessionId: sess.id,
      isPersistent: true,
      characters: defaultCharacters,
      currentCharacterId: 'assistant',
    });
    await useUIStore.getState().togglePin('missing-id');
    // 未命中：无可持久化目标，saveSession 不被调用。
    expect(fake.saveSessionCalls).toBe(0);
    expect(useUIStore.getState().sessions[0]).toEqual(sess);
  });
});

describe('loadSessions 缺省归一与置顶恢复 (Req 1.3, 3.3)', () => {
  it('缺 pinned 字段的记录归一为 false，含 pinned===true 的记录恢复置顶', async () => {
    const db = await freshDb();
    // 预置：一条缺 pinned 字段（模拟旧数据），一条 pinned===true。
    const legacy = { id: 'legacy', title: '旧', characterId: 'assistant', voiceId: 'jyy', updatedAt: '2024-02-01T00:00:00.000Z' } as ChatSession;
    const pinnedRec = mkSession({ id: 'pin', title: '置顶', updatedAt: '2024-07-01T00:00:00.000Z', pinned: true });
    await db.saveSession(legacy);
    await db.saveSession(pinnedRec);

    baseStore(db);
    await useUIStore.getState().loadSessions();

    const sessions = useUIStore.getState().sessions;
    const got = (id: string) => sessions.find((s) => s.id === id)!;
    expect(got('legacy').pinned).toBe(false); // 归一（Req 1.3）
    expect(got('pin').pinned).toBe(true); // 恢复置顶（Req 3.3）
    // 全部 pinned 为布尔。
    for (const s of sessions) expect(typeof s.pinned).toBe('boolean');
  });
});

describe('降级模式仅内存 (Req 3.2)', () => {
  it('isPersistent=false 时 togglePin 仅改内存、不调 saveSession', async () => {
    const fake = createFakeChatDb();
    setChatDbForTesting(fake);
    const sess = mkSession();
    useUIStore.setState({
      sessions: [sess],
      currentSessionId: sess.id,
      isPersistent: false,
      characters: defaultCharacters,
      currentCharacterId: 'assistant',
    });

    await useUIStore.getState().togglePin(sess.id);
    expect(useUIStore.getState().sessions[0].pinned).toBe(true); // 内存已更新
    expect(fake.saveSessionCalls).toBe(0); // 未写库
  });
});

describe('持久写入失败保留内存并提示 (Req 3.4)', () => {
  it('saveSession reject 时内存保留新 pinned 且触发一次 toast', async () => {
    const fake = createFakeChatDb();
    // 覆盖 saveSession 使其 reject。
    fake.saveSession = async () => {
      throw new Error('disk full');
    };
    setChatDbForTesting(fake);
    const sess = mkSession();
    useUIStore.setState({
      sessions: [sess],
      currentSessionId: sess.id,
      isPersistent: true,
      characters: defaultCharacters,
      currentCharacterId: 'assistant',
    });
    useToastStore.setState({ toasts: [] });

    await useUIStore.getState().togglePin(sess.id);
    // 内存保留新 pinned（不回滚）。
    expect(useUIStore.getState().sessions[0].pinned).toBe(true);
    // 触发一次保存失败提示。
    const toasts = useToastStore.getState().toasts;
    expect(toasts.length).toBe(1);
    expect(toasts[0].type).toBe('error');
  });
});
