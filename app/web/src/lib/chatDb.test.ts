import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
// fake-indexeddb/auto installs the global IndexedDB constructors (indexedDB,
// IDBKeyRange, ...) that jsdom lacks. We still inject a fresh IDBFactory per
// test/run for isolation, but the global IDBKeyRange is needed by deleteSession.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createChatDb, type PersistedMessage } from './chatDb';
import type { ChatSession } from '@/store/uiStore';

// ---------------------------------------------------------------------------
// Helpers & arbitraries
// ---------------------------------------------------------------------------

/** Create a Chat_DB backed by a brand-new (empty) in-memory IndexedDB. */
async function freshDb() {
  const db = createChatDb(new IDBFactory());
  await db.init();
  return db;
}

const isoArb = fc
  .date({ min: new Date('2000-01-01T00:00:00Z'), max: new Date('2035-01-01T00:00:00Z') })
  .map((d) => d.toISOString());

/** Arbitrary ChatSession with a caller-supplied id. */
function sessionArb(id: string): fc.Arbitrary<ChatSession> {
  return fc.record({
    id: fc.constant(id),
    title: fc.string(),
    characterId: fc.string(),
    voiceId: fc.string(),
    updatedAt: isoArb,
    pinned: fc.boolean(),
  });
}

/** Sort sessions by id for order-independent comparison. */
function byId(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Task 2.2 - schema & interface existence (Req 1.1, 1.6)
// ---------------------------------------------------------------------------

describe('Chat_DB schema & interface', () => {
  beforeEach(() => {
    // reset the global default store between cases for hygiene
    globalThis.indexedDB = new IDBFactory();
  });

  it('exposes all ChatDb interface methods', () => {
    const db = createChatDb(new IDBFactory());
    expect(typeof db.init).toBe('function');
    expect(typeof db.getAllSessions).toBe('function');
    expect(typeof db.getMessages).toBe('function');
    expect(typeof db.saveSession).toBe('function');
    expect(typeof db.saveMessage).toBe('function');
    expect(typeof db.deleteSession).toBe('function');
    expect(typeof db.deleteMessage).toBe('function');
    expect(typeof db.truncateMessagesAfter).toBe('function');
  });

  it('creates sessions/messages stores and the by-session index after init()', async () => {
    const factory = new IDBFactory();
    const db = createChatDb(factory);
    await db.init();

    // Open a second connection to inspect the resulting schema.
    const inspected = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open('nuwa-chat');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    expect(inspected.objectStoreNames.contains('sessions')).toBe(true);
    expect(inspected.objectStoreNames.contains('messages')).toBe(true);

    const tx = inspected.transaction('messages', 'readonly');
    const messages = tx.objectStore('messages');
    expect(messages.indexNames.contains('by-session')).toBe(true);
    const index = messages.index('by-session');
    expect(index.keyPath).toBe('sessionId');
    expect(index.unique).toBe(false);
    inspected.close();
  });

  it('init() rejects when IndexedDB is unavailable', async () => {
    const original = globalThis.indexedDB;
    // @ts-expect-error simulate missing IndexedDB
    globalThis.indexedDB = undefined;
    try {
      const db = createChatDb(); // no factory -> falls back to global (undefined)
      await expect(db.init()).rejects.toThrow();
    } finally {
      globalThis.indexedDB = original;
    }
  });
});

// ---------------------------------------------------------------------------
// Task 2.3 - Property 4: session round-trip
// ---------------------------------------------------------------------------

describe('Chat_DB session round-trip (Property 4)', () => {
  // Feature: chat-session-persistence, Property 4: 会话持久化往返
  it('saveSession then getAllSessions is id-equivalent; re-saving same id yields latest', async () => {
    await fc.assert(
      fc.asyncProperty(
        // unique ids -> one session per id
        fc.uniqueArray(fc.string({ minLength: 1 }), { minLength: 0, maxLength: 8 }).chain((ids) =>
          fc.tuple(...ids.map((id) => sessionArb(id))),
        ),
        async (sessions) => {
          const db = await freshDb();
          for (const s of sessions) {
            await db.saveSession(s);
          }
          const stored = await db.getAllSessions();
          // not lost, not added; field-equal by id
          expect(byId(stored)).toEqual(byId(sessions));

          // Re-save the same id with a mutated value -> read back the latest.
          if (sessions.length > 0) {
            const target = sessions[0];
            const updated: ChatSession = {
              ...target,
              title: target.title + '#updated',
              updatedAt: new Date('2036-06-06T06:06:06Z').toISOString(),
            };
            await db.saveSession(updated);
            const after = await db.getAllSessions();
            const found = after.find((s) => s.id === target.id);
            expect(found).toEqual(updated);
            // count unchanged (put is idempotent by id)
            expect(after.length).toBe(sessions.length);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Task 2.4 - Property 5: message round-trip & ordered restore
// ---------------------------------------------------------------------------

describe('Chat_DB message round-trip & ordering (Property 5)', () => {
  // Feature: chat-session-persistence, Property 5: 消息往返与按序恢复
  it('messages restore in append order with correct sessionId', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }), // sessionId
        fc.array(
          fc.record({
            role: fc.constantFrom('user' as const, 'assistant' as const),
            content: fc.string(),
          }),
          { minLength: 0, maxLength: 12 },
        ),
        fc.array(fc.integer({ min: 1, max: 5 }), { minLength: 12, maxLength: 12 }), // seq deltas
        async (sessionId, msgs, deltas) => {
          const db = await freshDb();

          // Build a strictly increasing seq sequence and append in order.
          let seq = 0;
          const appended: PersistedMessage[] = msgs.map((m, i) => {
            seq += deltas[i];
            return {
              id: `${sessionId}::${i}`,
              role: m.role,
              content: m.content,
              sessionId,
              seq,
            };
          });

          for (const m of appended) {
            await db.saveMessage(m);
          }

          const restored = (await db.getMessages(sessionId)) as PersistedMessage[];

          // Same length, same content & order, correct sessionId.
          expect(restored.length).toBe(appended.length);
          for (let i = 0; i < appended.length; i++) {
            expect(restored[i].id).toBe(appended[i].id);
            expect(restored[i].role).toBe(appended[i].role);
            expect(restored[i].content).toBe(appended[i].content);
            expect(restored[i].sessionId).toBe(sessionId);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Task 2.5 - Property 9: deleting a session removes its messages only
// ---------------------------------------------------------------------------

describe('Chat_DB delete session (Property 9, data layer)', () => {
  // Feature: chat-session-persistence, Property 9: 删除会话移除其消息且不影响其他会话（数据层）
  it('deleteSession removes the session and its messages, leaving others intact', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .uniqueArray(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 5 })
          .chain((ids) =>
            fc.tuple(
              fc.constant(ids),
              // per-session message counts
              fc.tuple(...ids.map(() => fc.integer({ min: 0, max: 6 }))),
              // index of the session to delete
              fc.integer({ min: 0, max: ids.length - 1 }),
            ),
          ),
        async ([ids, counts, deleteIdx]) => {
          const db = await freshDb();

          // Save sessions + their messages (globally unique message ids).
          const sessions: ChatSession[] = ids.map((id, i) => ({
            id,
            title: `t-${i}`,
            characterId: 'c',
            voiceId: 'v',
            updatedAt: new Date(2020, 0, 1 + i).toISOString(),
            pinned: false,
          }));
          for (const s of sessions) await db.saveSession(s);

          const messagesBySession = new Map<string, PersistedMessage[]>();
          for (let i = 0; i < ids.length; i++) {
            const sid = ids[i];
            const list: PersistedMessage[] = [];
            for (let j = 0; j < counts[i]; j++) {
              const m: PersistedMessage = {
                id: `${sid}::${j}`,
                role: j % 2 === 0 ? 'user' : 'assistant',
                content: `msg-${i}-${j}`,
                sessionId: sid,
                seq: j + 1,
              };
              list.push(m);
              await db.saveMessage(m);
            }
            messagesBySession.set(sid, list);
          }

          const deletedId = ids[deleteIdx];
          await db.deleteSession(deletedId);

          // Deleted session gone, its messages gone.
          const remainingSessions = await db.getAllSessions();
          expect(remainingSessions.find((s) => s.id === deletedId)).toBeUndefined();
          expect(await db.getMessages(deletedId)).toEqual([]);

          // Every other session and its message sequence is unchanged.
          for (const id of ids) {
            if (id === deletedId) continue;
            const stillThere = remainingSessions.find((s) => s.id === id);
            expect(stillThere).toBeDefined();
            const restored = (await db.getMessages(id)) as PersistedMessage[];
            const expected = messagesBySession.get(id)!;
            expect(restored.length).toBe(expected.length);
            for (let k = 0; k < expected.length; k++) {
              expect(restored[k].id).toBe(expected[k].id);
              expect(restored[k].content).toBe(expected[k].content);
              expect(restored[k].sessionId).toBe(id);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Task 1.2 - Property 2: truncateMessagesAfter removes only seq > afterSeq
// ---------------------------------------------------------------------------

describe('Chat_DB truncateMessagesAfter (chat-message-actions Property 2)', () => {
  // Feature: chat-message-actions, Property 2: 截断移除且仅移除 seq 更大的消息
  it('keeps exactly the messages with seq <= afterSeq and leaves other sessions intact', async () => {
    // Validates: Requirements 3.5, 6.2
    await fc.assert(
      fc.asyncProperty(
        fc
          .uniqueArray(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 4 })
          .chain((ids) =>
            fc.tuple(
              fc.constant(ids),
              // per-session message counts
              fc.tuple(...ids.map(() => fc.integer({ min: 0, max: 8 }))),
              // index of the session to truncate
              fc.integer({ min: 0, max: ids.length - 1 }),
              // afterSeq value (may be below, within or above the seq range)
              fc.integer({ min: -2, max: 12 }),
            ),
          ),
        async ([ids, counts, targetIdx, afterSeq]) => {
          const db = await freshDb();

          // Save sessions + their messages with strictly increasing seq 0..n-1.
          const messagesBySession = new Map<string, PersistedMessage[]>();
          for (let i = 0; i < ids.length; i++) {
            const sid = ids[i];
            await db.saveSession({
              id: sid,
              title: `t-${i}`,
              characterId: 'c',
              voiceId: 'v',
              updatedAt: new Date(2020, 0, 1 + i).toISOString(),
              pinned: false,
            });
            const list: PersistedMessage[] = [];
            for (let j = 0; j < counts[i]; j++) {
              const m: PersistedMessage = {
                id: `${sid}::${j}`,
                role: j % 2 === 0 ? 'user' : 'assistant',
                content: `msg-${i}-${j}`,
                sessionId: sid,
                seq: j, // seq equals array index, matching the design invariant
              };
              list.push(m);
              await db.saveMessage(m);
            }
            messagesBySession.set(sid, list);
          }

          const targetId = ids[targetIdx];
          await db.truncateMessagesAfter(targetId, afterSeq);

          // Target session keeps exactly the messages with seq <= afterSeq.
          const restored = (await db.getMessages(targetId)) as PersistedMessage[];
          const expected = messagesBySession.get(targetId)!.filter((m) => m.seq <= afterSeq);
          expect(restored.length).toBe(expected.length);
          for (let k = 0; k < expected.length; k++) {
            expect(restored[k].id).toBe(expected[k].id);
            expect(restored[k].seq).toBe(expected[k].seq);
            expect(restored[k].content).toBe(expected[k].content);
          }
          // Every surviving message satisfies seq <= afterSeq.
          for (const m of restored) {
            expect(m.seq).toBeLessThanOrEqual(afterSeq);
          }

          // Other sessions are untouched.
          for (const id of ids) {
            if (id === targetId) continue;
            const other = (await db.getMessages(id)) as PersistedMessage[];
            const exp = messagesBySession.get(id)!;
            expect(other.length).toBe(exp.length);
            for (let k = 0; k < exp.length; k++) {
              expect(other[k].id).toBe(exp[k].id);
              expect(other[k].seq).toBe(exp[k].seq);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Task 1.2 (companion) - deleteMessage removes only the targeted message
// ---------------------------------------------------------------------------

describe('Chat_DB deleteMessage (chat-message-actions data layer)', () => {
  // Feature: chat-message-actions, Property 1 (DB layer): delete a single message by id
  it('removes only the targeted message and is a no-op for absent ids', async () => {
    // Validates: Requirements 6.1
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        fc.integer({ min: 1, max: 8 }),
        fc.nat(),
        async (sessionId, count, delIdxRaw) => {
          const db = await freshDb();
          await db.saveSession({
            id: sessionId,
            title: 't',
            characterId: 'c',
            voiceId: 'v',
            updatedAt: new Date(2021, 0, 1).toISOString(),
            pinned: false,
          });
          const all: PersistedMessage[] = [];
          for (let j = 0; j < count; j++) {
            const m: PersistedMessage = {
              id: `${sessionId}::${j}`,
              role: j % 2 === 0 ? 'user' : 'assistant',
              content: `c-${j}`,
              sessionId,
              seq: j,
            };
            all.push(m);
            await db.saveMessage(m);
          }

          const delIdx = delIdxRaw % count;
          const deletedId = all[delIdx].id;
          await db.deleteMessage(deletedId);

          const restored = (await db.getMessages(sessionId)) as PersistedMessage[];
          const expected = all.filter((m) => m.id !== deletedId);
          expect(restored.length).toBe(expected.length);
          expect(restored.map((m) => m.id)).toEqual(expected.map((m) => m.id));

          // Deleting a non-existent id is a no-op.
          await db.deleteMessage('does-not-exist');
          const afterNoop = (await db.getMessages(sessionId)) as PersistedMessage[];
          expect(afterNoop.length).toBe(expected.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
