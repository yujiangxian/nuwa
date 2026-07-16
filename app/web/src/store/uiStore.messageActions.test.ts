// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
// fake-indexeddb/auto installs the global IndexedDB constructors (indexedDB,
// IDBKeyRange, ...) that jsdom lacks; truncate/delete cursors rely on the
// global IDBKeyRange. Each property iteration still injects a brand-new
// IDBFactory-backed Chat_DB for isolation.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createChatDb, type ChatDb } from '@/lib/chatDb';
import {
  useUIStore,
  setChatDbForTesting,
  defaultAgents,
  type ChatSession,
  type ChatMessage,
} from '@/store/uiStore';
import { createFakeChatDb } from '@/store/testChatDb';

/**
 * Chat_Store message-action property tests (chat-message-actions Properties 1, 3, 4, 6).
 *
 * Properties 1/3/4 inject the REAL Chat_DB backed by a fresh fake-indexeddb
 * IDBFactory so the in-memory store mutations and the IndexedDB persistence are
 * exercised together and asserted for round-trip equivalence. Property 6 swaps
 * in a call-recording stub and disables persistence to assert no DB writes.
 */

// ---------------------------------------------------------------------------
// Helpers & arbitraries
// ---------------------------------------------------------------------------

/** A Chat_DB backed by a brand-new (empty) in-memory IndexedDB. */
async function freshDb(): Promise<ChatDb> {
  const db = createChatDb(new IDBFactory());
  await db.init();
  return db;
}

const roleArb = fc.constantFrom('user' as const, 'assistant' as const);

/** A list of {role, content} message specs. */
const messageSpecsArb = fc.array(
  fc.record({ role: roleArb, content: fc.string({ maxLength: 24 }) }),
  { minLength: 1, maxLength: 10 },
);

const SESSION_ID = 'msg-actions-sess';

/** Reset the store to a clean, persistent baseline pointing at `db`. */
function baseStore(db: ChatDb): void {
  setChatDbForTesting(db);
  useUIStore.setState({
    sessions: [],
    currentSessionId: null,
    messages: [],
    sessionsLoading: false,
    isPersistent: true,
    agents: defaultAgents,
    currentAgentId: 'assistant',
  });
}

/**
 * Seed `db` and the store with a session + the given message specs.
 * Persisted messages use seq = array index (the design's Message_Seq invariant)
 * so getMessages restores them in the same order as memory.
 */
async function seed(
  db: ChatDb,
  specs: { role: 'user' | 'assistant'; content: string }[],
  title = 'seed-title',
): Promise<{ session: ChatSession; messages: ChatMessage[] }> {
  const session: ChatSession = {
    id: SESSION_ID,
    title,
    characterId: 'assistant',
    voiceId: 'jyy',
    updatedAt: new Date('2024-01-01T00:00:00Z').toISOString(),
    pinned: false,
  };
  await db.saveSession(session);
  const messages: ChatMessage[] = specs.map((m, i) => ({
    id: `m-${i}`,
    role: m.role,
    content: m.content,
  }));
  for (let i = 0; i < messages.length; i++) {
    await db.saveMessage({ ...messages[i], sessionId: SESSION_ID, seq: i });
  }
  baseStore(db);
  useUIStore.setState({ sessions: [session], currentSessionId: SESSION_ID, messages });
  return { session, messages };
}

/** Compare two message lists by the runtime-visible fields. */
function shape(messages: { id: string; role: string; content: string }[]) {
  return messages.map((m) => ({ id: m.id, role: m.role, content: m.content }));
}

beforeEach(() => {
  // Hygiene: reset the global default IndexedDB between cases.
  globalThis.indexedDB = new IDBFactory();
});

// ---------------------------------------------------------------------------
// Task 3.2 - Property 1: delete preserves order & round-trips with Chat_DB
// ---------------------------------------------------------------------------

describe('Chat_Store deleteMessage / regenerateLast (chat-message-actions Property 1)', () => {
  // Feature: chat-message-actions, Property 1: 删除单条消息后保序且内存与 Chat_DB round-trip 一致
  // Validates: Requirements 2.1, 5.1, 5.3, 5.4, 6.1, 6.4, 6.5
  it('deleteMessage removes only the target, preserves order, and round-trips', async () => {
    await fc.assert(
      fc.asyncProperty(messageSpecsArb, fc.nat(), async (specs, indexRaw) => {
        const db = await freshDb();
        const { messages } = await seed(db, specs);

        const index = indexRaw % messages.length;
        const target = messages[index];
        await useUIStore.getState().deleteMessage(target.id);

        const mem = useUIStore.getState().messages;
        const expected = messages.filter((m) => m.id !== target.id);
        // Removed exactly the target; remaining keep their relative order.
        expect(shape(mem)).toEqual(shape(expected));
        // Round-trip: Chat_DB restores (seq-ascending) the same sequence.
        const restored = await db.getMessages(SESSION_ID);
        expect(shape(restored)).toEqual(shape(mem));
      }),
      { numRuns: 100 },
    );
  });

  it('regenerateLast drops a trailing assistant (round-trip) or is a no-op otherwise', async () => {
    await fc.assert(
      fc.asyncProperty(messageSpecsArb, async (specs) => {
        const db = await freshDb();
        const { messages } = await seed(db, specs);
        const last = messages[messages.length - 1];

        const result = await useUIStore.getState().regenerateLast();
        const mem = useUIStore.getState().messages;

        if (last.role === 'assistant') {
          const expected = messages.slice(0, -1);
          expect(result).not.toBeNull();
          expect(result).toEqual(expected.map((m) => ({ role: m.role, content: m.content })));
          expect(shape(mem)).toEqual(shape(expected));
          const restored = await db.getMessages(SESSION_ID);
          expect(shape(restored)).toEqual(shape(expected));
        } else {
          // No trailing assistant: nothing changes.
          expect(result).toBeNull();
          expect(shape(mem)).toEqual(shape(messages));
          const restored = await db.getMessages(SESSION_ID);
          expect(shape(restored)).toEqual(shape(messages));
        }
      }),
      { numRuns: 100 },
    );
  });

  it('deleting every message one-by-one empties messages but keeps the session', async () => {
    await fc.assert(
      fc.asyncProperty(messageSpecsArb, async (specs) => {
        const db = await freshDb();
        const { messages } = await seed(db, specs);

        // Delete from the head each time (relative order of the rest is stable).
        let remaining = [...messages];
        while (remaining.length > 0) {
          await useUIStore.getState().deleteMessage(remaining[0].id);
          remaining = remaining.slice(1);
          const restored = await db.getMessages(SESSION_ID);
          expect(shape(restored)).toEqual(shape(useUIStore.getState().messages));
        }

        expect(useUIStore.getState().messages).toEqual([]);
        // The Chat_Session itself is preserved.
        const sessions = await db.getAllSessions();
        expect(sessions.find((s) => s.id === SESSION_ID)).toBeDefined();
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Task 3.3 - Property 3: editAndResend trim + truncation semantics & round-trip
// ---------------------------------------------------------------------------

/** Message specs guaranteed to contain at least one `user` message. */
const specsWithUserArb = messageSpecsArb.map((specs) =>
  specs.some((s) => s.role === 'user')
    ? specs
    : [{ role: 'user' as const, content: 'forced-user' }, ...specs],
);

describe('Chat_Store editAndResend (chat-message-actions Property 3)', () => {
  // Feature: chat-message-actions, Property 3: 编辑重发的 trim 与截断语义及 round-trip 一致
  // Validates: Requirements 3.3, 3.4, 3.5, 6.4, 6.5
  it('empty-trim is a full no-op; non-empty edits, truncates, and round-trips', async () => {
    await fc.assert(
      fc.asyncProperty(
        specsWithUserArb,
        fc.nat(),
        fc.string({ maxLength: 24 }),
        async (specs, idxRaw, newContent) => {
          const db = await freshDb();
          const { messages } = await seed(db, specs);

          const userIndices = messages
            .map((m, i) => (m.role === 'user' ? i : -1))
            .filter((i) => i >= 0);
          const idx = userIndices[idxRaw % userIndices.length];
          const target = messages[idx];
          const trimmed = newContent.trim();

          const result = await useUIStore.getState().editAndResend(target.id, newContent);
          const mem = useUIStore.getState().messages;
          const restored = await db.getMessages(SESSION_ID);

          if (trimmed.length === 0) {
            // Req 3.3: trim-empty content leaves messages and persistence intact.
            expect(result).toBeNull();
            expect(shape(mem)).toEqual(shape(messages));
            expect(shape(restored)).toEqual(shape(messages));
          } else {
            // Req 3.4/3.5: content becomes the trimmed text; everything after is removed.
            const expected = [...messages.slice(0, idx), { ...target, content: trimmed }];
            expect(result).toEqual(expected.map((m) => ({ role: m.role, content: m.content })));
            expect(shape(mem)).toEqual(shape(expected));
            expect(mem[idx].content).toBe(trimmed);
            // Req 6.4/6.5: memory and Chat_DB restore to the same ordered sequence.
            expect(shape(restored)).toEqual(shape(expected));
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns null and changes nothing when the target is not a user message', async () => {
    await fc.assert(
      fc.asyncProperty(messageSpecsArb, fc.nat(), fc.string({ minLength: 1, maxLength: 8 }), async (specs, idxRaw, newContent) => {
        const db = await freshDb();
        const { messages } = await seed(db, specs);
        const assistantIndices = messages
          .map((m, i) => (m.role === 'assistant' ? i : -1))
          .filter((i) => i >= 0);
        fc.pre(assistantIndices.length > 0);
        const idx = assistantIndices[idxRaw % assistantIndices.length];

        const result = await useUIStore.getState().editAndResend(messages[idx].id, newContent);
        expect(result).toBeNull();
        expect(shape(useUIStore.getState().messages)).toEqual(shape(messages));
        const restored = await db.getMessages(SESSION_ID);
        expect(shape(restored)).toEqual(shape(messages));
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Task 3.4 - Property 4: delete & truncation keep the session title unchanged
// ---------------------------------------------------------------------------

describe('Chat_Store title invariant (chat-message-actions Property 4)', () => {
  // Feature: chat-message-actions, Property 4: 删除与截断保持会话 title 不变
  // Validates: Requirements 6.7
  it('deleteMessage / regenerateLast / editAndResend never change the session title', async () => {
    const opArb = fc.constantFrom('delete' as const, 'regenerate' as const, 'edit' as const);
    await fc.assert(
      fc.asyncProperty(
        specsWithUserArb,
        fc.nat(),
        fc.string({ minLength: 1, maxLength: 12 }),
        opArb,
        async (specs, idxRaw, newContent, op) => {
          const db = await freshDb();
          const FIXED_TITLE = 'fixed-title-xyz';
          const { messages } = await seed(db, specs, FIXED_TITLE);
          const beforeTitle = useUIStore.getState().sessions[0].title;
          expect(beforeTitle).toBe(FIXED_TITLE);

          if (op === 'delete') {
            const idx = idxRaw % messages.length;
            await useUIStore.getState().deleteMessage(messages[idx].id);
          } else if (op === 'regenerate') {
            await useUIStore.getState().regenerateLast();
          } else {
            const userIndices = messages
              .map((m, i) => (m.role === 'user' ? i : -1))
              .filter((i) => i >= 0);
            const idx = userIndices[idxRaw % userIndices.length];
            await useUIStore.getState().editAndResend(messages[idx].id, newContent);
          }

          // In-memory title unchanged.
          expect(useUIStore.getState().sessions[0].title).toBe(beforeTitle);
          // Persisted session title unchanged as well.
          const sessions = await db.getAllSessions();
          expect(sessions.find((s) => s.id === SESSION_ID)?.title).toBe(beforeTitle);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Task 3.5 - Property 6: Memory_Fallback_Mode performs no Chat_DB writes
// ---------------------------------------------------------------------------

describe('Chat_Store Memory_Fallback_Mode (chat-message-actions Property 6)', () => {
  // Feature: chat-message-actions, Property 6: 降级模式下仅内存变更、不触发持久化写入
  // Validates: Requirements 8.2
  it('deleteMessage / regenerateLast / editAndResend mutate memory only, no DB writes', async () => {
    const opArb = fc.constantFrom('delete' as const, 'regenerate' as const, 'edit' as const);
    await fc.assert(
      fc.asyncProperty(
        specsWithUserArb,
        fc.nat(),
        fc.string({ minLength: 1, maxLength: 12 }),
        opArb,
        async (specs, idxRaw, newContent, op) => {
          // A call-recording stub Chat_DB; counters must stay at 0 in fallback mode.
          const fake = createFakeChatDb();
          setChatDbForTesting(fake);

          const session: ChatSession = {
            id: SESSION_ID,
            title: 'fallback-title',
            characterId: 'assistant',
            voiceId: 'jyy',
            updatedAt: new Date('2024-01-01T00:00:00Z').toISOString(),
            pinned: false,
          };
          const messages: ChatMessage[] = specs.map((m, i) => ({
            id: `m-${i}`,
            role: m.role,
            content: m.content,
          }));
          // isPersistent = false => Memory_Fallback_Mode.
          useUIStore.setState({
            sessions: [session],
            currentSessionId: SESSION_ID,
            messages,
            sessionsLoading: false,
            isPersistent: false,
            agents: defaultAgents,
            currentAgentId: 'assistant',
          });

          if (op === 'delete') {
            const idx = idxRaw % messages.length;
            await useUIStore.getState().deleteMessage(messages[idx].id);
            // Memory updated: that message is gone.
            expect(useUIStore.getState().messages.some((m) => m.id === messages[idx].id)).toBe(false);
          } else if (op === 'regenerate') {
            const last = messages[messages.length - 1];
            await useUIStore.getState().regenerateLast();
            if (last.role === 'assistant') {
              expect(useUIStore.getState().messages.length).toBe(messages.length - 1);
            } else {
              expect(useUIStore.getState().messages.length).toBe(messages.length);
            }
          } else {
            const userIndices = messages
              .map((m, i) => (m.role === 'user' ? i : -1))
              .filter((i) => i >= 0);
            const idx = userIndices[idxRaw % userIndices.length];
            const result = await useUIStore.getState().editAndResend(messages[idx].id, newContent);
            if (newContent.trim().length > 0) {
              expect(result).not.toBeNull();
              // Memory truncated after the edited message.
              expect(useUIStore.getState().messages.length).toBe(idx + 1);
            }
          }

          // No persistence writes occurred in Memory_Fallback_Mode.
          expect(fake.deleteMessageCalls).toBe(0);
          expect(fake.truncateMessagesAfterCalls).toBe(0);
          expect(fake.saveMessageCalls).toBe(0);
          expect(fake.saveSessionCalls).toBe(0);
          // The stub stores stayed empty too.
          expect(fake.messageStore.size).toBe(0);
          expect(fake.sessionStore.size).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
