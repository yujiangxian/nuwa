import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';
import {
  useUIStore,
  setChatDbForTesting,
  defaultCharacters,
  type ChatSession,
  type ChatMessage,
} from '@/store/uiStore';
import { buildExportBundle, type ExportedSession } from '@/lib/conversationExport';
import { pickLatestSession } from '@/lib/chatSession';
import { createFakeChatDb, type FakeChatDb } from '@/store/testChatDb';
import { useToastStore } from '@/store/toastStore';

/**
 * Chat_Store importSessions property-based tests (Properties 9–14) + boundary
 * unit tests (task 2.8). A fresh in-memory fake Chat_DB is injected per test and
 * the store is reset to a clean, persistent baseline before each case.
 */

let fake: FakeChatDb;

function resetStore(): void {
  fake = createFakeChatDb();
  setChatDbForTesting(fake);
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

beforeEach(resetStore);

// ---------------------------------------------------------------------------
// Shared arbitraries.
// ---------------------------------------------------------------------------

const tokenArb = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
  { minLength: 1, maxLength: 6 },
);
const richTextArb = fc.stringOf(
  fc.constantFrom(...'abcXYZ012 你好世界🙂#*_-，。！'.split('')),
  { maxLength: 20 },
);
const isoArb = fc
  .date({ min: new Date('2020-01-01T00:00:00.000Z'), max: new Date('2030-01-01T00:00:00.000Z') })
  .map((d) => d.toISOString());

const msgArb: fc.Arbitrary<ChatMessage> = fc.record({
  id: tokenArb,
  role: fc.constantFrom<'user' | 'assistant'>('user', 'assistant'),
  content: richTextArb,
});

const importEntryArb: fc.Arbitrary<ExportedSession> = fc.record({
  session: fc.record({
    id: tokenArb,
    title: richTextArb,
    characterId: tokenArb,
    voiceId: tokenArb,
    updatedAt: isoArb,
    pinned: fc.boolean(),
  }),
  messages: fc.array(msgArb, { maxLength: 5 }),
});

const importBatchArb = fc.array(importEntryArb, { maxLength: 5 });

const existingSessionsArb = fc.uniqueArray(
  fc.record({
    id: tokenArb,
    title: richTextArb,
    characterId: tokenArb,
    voiceId: tokenArb,
    updatedAt: isoArb,
    pinned: fc.boolean(),
  }) as fc.Arbitrary<ChatSession>,
  { selector: (s) => s.id, maxLength: 5 },
);

/** Seed existing sessions into the store + fake Chat_DB (with their messages). */
async function seedExisting(sessions: ChatSession[]): Promise<Map<string, ChatMessage[]>> {
  const byId = new Map<string, ChatMessage[]>();
  for (const s of sessions) {
    await fake.saveSession(s);
    const msgs: ChatMessage[] = [
      { id: `${s.id}-m0`, role: 'user', content: `seed-${s.id}` },
    ];
    for (let i = 0; i < msgs.length; i++) {
      await fake.saveMessage({ ...msgs[i], sessionId: s.id, seq: i });
    }
    byId.set(s.id, msgs);
  }
  fake.saveSessionCalls = 0;
  fake.saveMessageCalls = 0;
  useUIStore.setState({ sessions: sessions.map((s) => ({ ...s })), currentSessionId: null, messages: [] });
  return byId;
}

function importText(batch: ExportedSession[]): string {
  return JSON.stringify(buildExportBundle(batch, new Date().toISOString()));
}

// ---------------------------------------------------------------------------
// Property 9: 导入后会话 id 库内唯一且数量正确
// ---------------------------------------------------------------------------

describe('Chat_Store importSessions id uniqueness (Property 9)', () => {
  it('Property 9: 导入后会话 id 库内唯一且数量正确', async () => {
    // Feature: conversation-export-import, Property 9: 导入后会话 id 库内唯一且数量正确
    // Validates: Requirements 4.2, 4.3
    await fc.assert(
      fc.asyncProperty(existingSessionsArb, importBatchArb, async (existing, batch) => {
        resetStore();
        await seedExisting(existing);

        const err = await useUIStore.getState().importSessions(importText(batch));
        expect(err).toBeNull();

        const ids = useUIStore.getState().sessions.map((s) => s.id);
        // All ids unique across batch + existing (Req 4.2, 4.3).
        expect(new Set(ids).size).toBe(ids.length);
        // Count = original + imported (Req 4.3).
        expect(ids.length).toBe(existing.length + batch.length);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 10: 导入消息保序且会话内 id 唯一
// ---------------------------------------------------------------------------

describe('Chat_Store importSessions message order & id uniqueness (Property 10)', () => {
  it('Property 10: 导入消息保序且会话内 id 唯一', async () => {
    // Feature: conversation-export-import, Property 10: 导入消息保序且会话内 id 唯一
    // Validates: Requirements 4.4
    await fc.assert(
      fc.asyncProperty(existingSessionsArb, importBatchArb, async (existing, batch) => {
        resetStore();
        await seedExisting(existing);

        const err = await useUIStore.getState().importSessions(importText(batch));
        expect(err).toBeNull();

        // New sessions are appended after existing ones, in batch order.
        const all = useUIStore.getState().sessions;
        const newOnes = all.slice(existing.length);
        expect(newOnes.length).toBe(batch.length);

        for (let i = 0; i < batch.length; i++) {
          const sid = newOnes[i].id;
          const persisted = await fake.getMessages(sid); // sorted by seq = append order
          const expected = batch[i].messages;
          // role/content equal per message, order preserved (Req 4.4).
          expect(persisted.length).toBe(expected.length);
          persisted.forEach((m, j) => {
            expect(m.role).toBe(expected[j].role);
            expect(m.content).toBe(expected[j].content);
          });
          // Message ids unique within the session (Req 4.4).
          const ids = persisted.map((m) => m.id);
          expect(new Set(ids).size).toBe(ids.length);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 11: 成功导入保留全部现有数据
// ---------------------------------------------------------------------------

describe('Chat_Store importSessions preserves existing data (Property 11)', () => {
  it('Property 11: 成功导入保留全部现有数据', async () => {
    // Feature: conversation-export-import, Property 11: 成功导入保留全部现有数据
    // Validates: Requirements 4.5
    await fc.assert(
      fc.asyncProperty(existingSessionsArb, importBatchArb, async (existing, batch) => {
        resetStore();
        const seededMsgs = await seedExisting(existing);
        const before = existing.map((s) => ({ ...s }));

        const err = await useUIStore.getState().importSessions(importText(batch));
        expect(err).toBeNull();

        const after = useUIStore.getState().sessions;
        // Every existing session is still present, unmodified.
        for (const orig of before) {
          const found = after.find((s) => s.id === orig.id);
          expect(found).toBeDefined();
          expect(found).toEqual(orig);
          // Its persisted messages are unchanged (Req 4.5).
          const msgs = await fake.getMessages(orig.id);
          const expected = seededMsgs.get(orig.id) ?? [];
          expect(msgs.map((m) => ({ id: m.id, role: m.role, content: m.content }))).toEqual(
            expected.map((m) => ({ id: m.id, role: m.role, content: m.content })),
          );
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 12: 导入后切换到最新会话
// ---------------------------------------------------------------------------

describe('Chat_Store importSessions switches to latest (Property 12)', () => {
  // Non-empty import batch (Req 4.7 applies to a non-empty batch).
  const nonEmptyBatchArb = fc.array(importEntryArb, { minLength: 1, maxLength: 5 });

  it('Property 12: 导入后切换到最新会话', async () => {
    // Feature: conversation-export-import, Property 12: 导入后切换到最新会话
    // Validates: Requirements 4.7
    await fc.assert(
      fc.asyncProperty(existingSessionsArb, nonEmptyBatchArb, async (existing, batch) => {
        resetStore();
        await seedExisting(existing);

        const err = await useUIStore.getState().importSessions(importText(batch));
        expect(err).toBeNull();

        const state = useUIStore.getState();
        const newOnes = state.sessions.slice(existing.length);
        const latest = pickLatestSession(newOnes);
        expect(latest).not.toBeNull();
        // currentSessionId = newest imported session (Req 4.7).
        expect(state.currentSessionId).toBe(latest!.id);
        // messages = that session's message sequence (role/content, order).
        const idx = newOnes.findIndex((s) => s.id === latest!.id);
        const expected = batch[idx].messages;
        expect(state.messages.map((m) => ({ role: m.role, content: m.content }))).toEqual(
          expected.map((m) => ({ role: m.role, content: m.content })),
        );
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 13: 非法导入不修改现有数据
// ---------------------------------------------------------------------------

describe('Chat_Store importSessions error keeps data intact (Property 13)', () => {
  // Texts that trigger each Import_Error category, paired with the expected kind.
  const syntaxTextArb = fc
    .string()
    .filter((s) => {
      try {
        JSON.parse(s);
        return false;
      } catch {
        return true;
      }
    })
    .map((text) => ({ text, kind: 'syntax' as const }));
  const structureTextArb = fc
    .constantFrom<unknown>(42, 'str', null, [1, 2], { sessions: [] }, { formatVersion: '1', sessions: 5 }, { formatVersion: '1', sessions: [{ messages: [] }] })
    .map((v) => ({ text: JSON.stringify(v), kind: 'structure' as const }));
  const versionTextArb = fc
    .string()
    .filter((v) => v !== '1')
    .map((v) => ({ text: JSON.stringify({ formatVersion: v, sessions: [] }), kind: 'version' as const }));
  const errorTextArb = fc.oneof(syntaxTextArb, structureTextArb, versionTextArb);

  it('Property 13: 非法导入不修改现有数据', async () => {
    // Feature: conversation-export-import, Property 13: 非法导入不修改现有数据
    // Validates: Requirements 6.1
    await fc.assert(
      fc.asyncProperty(existingSessionsArb, errorTextArb, async (existing, bad) => {
        resetStore();
        await seedExisting(existing);
        // Establish a non-trivial current session + messages to guard against changes.
        const curId = existing.length > 0 ? existing[0].id : null;
        const curMsgs: ChatMessage[] = curId ? await fake.getMessages(curId) : [];
        useUIStore.setState({ currentSessionId: curId, messages: curMsgs });

        const beforeSessions = JSON.stringify(useUIStore.getState().sessions);
        const beforeMessages = JSON.stringify(useUIStore.getState().messages);
        const beforeCurrent = useUIStore.getState().currentSessionId;
        const beforeDbSessions = JSON.stringify([...fake.sessionStore.entries()]);
        const beforeDbMessages = JSON.stringify([...fake.messageStore.entries()]);

        const err = await useUIStore.getState().importSessions(bad.text);
        // Returns the Import_Error of the expected category.
        expect(err).not.toBeNull();
        expect(err?.kind).toBe(bad.kind);

        // Nothing changed in memory or the persistent layer (Req 6.1).
        expect(JSON.stringify(useUIStore.getState().sessions)).toBe(beforeSessions);
        expect(JSON.stringify(useUIStore.getState().messages)).toBe(beforeMessages);
        expect(useUIStore.getState().currentSessionId).toBe(beforeCurrent);
        expect(JSON.stringify([...fake.sessionStore.entries()])).toBe(beforeDbSessions);
        expect(JSON.stringify([...fake.messageStore.entries()])).toBe(beforeDbMessages);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 14: 降级模式导入仅维护内存
// ---------------------------------------------------------------------------

describe('Chat_Store importSessions memory-only in fallback mode (Property 14)', () => {
  const nonEmptyBatchArb = fc.array(importEntryArb, { minLength: 1, maxLength: 5 });

  it('Property 14: 降级模式导入仅维护内存', async () => {
    // Feature: conversation-export-import, Property 14: 降级模式导入仅维护内存
    // Validates: Requirements 8.1
    await fc.assert(
      fc.asyncProperty(existingSessionsArb, nonEmptyBatchArb, async (existing, batch) => {
        resetStore();
        await seedExisting(existing);
        // Enter Memory_Fallback_Mode; reset the persistence counters first.
        fake.saveSessionCalls = 0;
        fake.saveMessageCalls = 0;
        useUIStore.setState({ isPersistent: false });

        const err = await useUIStore.getState().importSessions(importText(batch));
        expect(err).toBeNull();

        // No Chat_DB writes in fallback mode (Req 8.1).
        expect(fake.saveSessionCalls).toBe(0);
        expect(fake.saveMessageCalls).toBe(0);

        // In-memory state updated from the import.
        const state = useUIStore.getState();
        expect(state.sessions.length).toBe(existing.length + batch.length);
        const newOnes = state.sessions.slice(existing.length);
        const latest = pickLatestSession(newOnes);
        expect(state.currentSessionId).toBe(latest!.id);
        const idx = newOnes.findIndex((s) => s.id === latest!.id);
        expect(state.messages.map((m) => ({ role: m.role, content: m.content }))).toEqual(
          batch[idx].messages.map((m) => ({ role: m.role, content: m.content })),
        );
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Task 2.8: importSessions boundary unit tests
// ---------------------------------------------------------------------------

describe('Chat_Store importSessions boundary cases', () => {
  function spyToast() {
    return vi.spyOn(useToastStore.getState(), 'addToast');
  }

  it('falls back to current time when updatedAt is missing (Req 4.1)', async () => {
    resetStore();
    const text = JSON.stringify({
      formatVersion: '1',
      sessions: [{ session: { title: 't', characterId: 'assistant', voiceId: 'jyy' }, messages: [] }],
    });
    const before = Date.now();
    const err = await useUIStore.getState().importSessions(text);
    expect(err).toBeNull();
    const created = useUIStore.getState().sessions[0];
    expect(created.updatedAt.length).toBeGreaterThan(0);
    const ts = new Date(created.updatedAt).getTime();
    expect(Number.isNaN(ts)).toBe(false);
    // Within a generous window around "now".
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('keeps memory state and toasts a save failure when persistence fails (Req 8.2)', async () => {
    resetStore();
    // Make session persistence reject to simulate a Chat_DB write failure.
    fake.saveSession = async () => {
      throw new Error('write failed');
    };
    const toast = spyToast();
    const text = JSON.stringify(
      buildExportBundle(
        [{ session: { id: 'x', title: 't', characterId: 'assistant', voiceId: 'jyy', updatedAt: '2025-01-01T00:00:00.000Z', pinned: false }, messages: [{ id: 'm', role: 'user', content: '你好' }] }],
        '2025-01-01T00:00:00.000Z',
      ),
    );
    const err = await useUIStore.getState().importSessions(text);
    expect(err).toBeNull();
    // Memory updated despite the persistence failure.
    expect(useUIStore.getState().sessions.length).toBe(1);
    // A "保存失败" toast was shown (Req 8.2).
    expect(toast.mock.calls.some((c) => (c[0] as { message: string }).message === '保存失败')).toBe(true);
  });

  it('shows a success toast including the imported count (Req 6.5)', async () => {
    resetStore();
    const toast = spyToast();
    const batch: ExportedSession[] = [
      { session: { id: 'a', title: 't1', characterId: 'assistant', voiceId: 'jyy', updatedAt: '2025-01-01T00:00:00.000Z', pinned: false }, messages: [] },
      { session: { id: 'b', title: 't2', characterId: 'assistant', voiceId: 'jyy', updatedAt: '2025-01-02T00:00:00.000Z', pinned: false }, messages: [] },
    ];
    await useUIStore.getState().importSessions(importText(batch));
    expect(toast.mock.calls.some((c) => (c[0] as { message: string }).message === '成功导入 2 个会话')).toBe(true);
  });

  it.each([
    ['不是合法JSON{{{', '文件格式无法解析'],
    [JSON.stringify({ sessions: [] }), '文件内容结构不正确'],
    [JSON.stringify({ formatVersion: '999', sessions: [] }), '文件版本不受支持'],
  ])('shows the right error toast for invalid input (Req 6.2–6.4)', async (text, expectedMessage) => {
    resetStore();
    const toast = spyToast();
    const err = await useUIStore.getState().importSessions(text);
    expect(err).not.toBeNull();
    expect(toast.mock.calls.some((c) => (c[0] as { message: string }).message === expectedMessage)).toBe(true);
  });
});

export { tokenArb, richTextArb, isoArb, msgArb, importEntryArb, importBatchArb, existingSessionsArb, seedExisting, importText, resetStore };
