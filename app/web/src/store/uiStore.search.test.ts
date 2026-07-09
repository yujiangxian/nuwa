// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, beforeEach } from 'vitest';
// fake-indexeddb/auto installs the global IndexedDB constructors (indexedDB,
// IDBKeyRange, ...) that jsdom lacks. Each test injects a fresh IDBFactory-backed
// Chat_DB for isolation so the real cross-session corpus assembly is exercised.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createChatDb, type ChatDb, type PersistedMessage } from '@/lib/chatDb';
import {
  useUIStore,
  setChatDbForTesting,
  defaultCharacters,
  type ChatSession,
  type ChatMessage,
} from '@/store/uiStore';

/**
 * Chat_Store search corpus-assembly integration tests (chat-history-search task 3.2).
 *
 * Persistent-mode cases inject the REAL Chat_DB backed by a fresh fake-indexeddb
 * IDBFactory so cross-session reads (getAllSessions + getMessages) are exercised
 * end-to-end. Fallback / read-failure cases inject stubs to drive the in-memory
 * corpus branch. These are example-based integration tests (not property tests).
 */

/** A Chat_DB backed by a brand-new (empty) in-memory IndexedDB. */
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
    searchQuery: '',
    searchResults: [],
    isSearching: false,
  });
}

function makeSession(id: string, title: string, updatedAt: string): ChatSession {
  return { id, title, characterId: 'assistant', voiceId: 'jyy', updatedAt, pinned: false };
}

beforeEach(() => {
  // Ensure a clean store between tests even if a test throws mid-way.
  useUIStore.setState({
    sessions: [],
    currentSessionId: null,
    messages: [],
    searchQuery: '',
    searchResults: [],
    isSearching: false,
    isPersistent: true,
  });
});

describe('Chat_Store runSearch — persistent cross-session corpus (Req 4.1, 4.3, 4.4)', () => {
  it('assembles corpus across all persisted sessions and returns ordered title + message matches', async () => {
    const db = await freshDb();
    baseStore(db);

    // Three sessions, distinct updatedAt for deterministic ordering (newest first).
    const sessA = makeSession('A', 'Apple talk', '2024-01-03T00:00:00.000Z');
    const sessB = makeSession('B', 'Banana chat', '2024-01-02T00:00:00.000Z');
    const sessC = makeSession('C', 'Cherry', '2024-01-01T00:00:00.000Z');
    await db.saveSession(sessA);
    await db.saveSession(sessB);
    await db.saveSession(sessC);

    const msgs: PersistedMessage[] = [
      { id: 'a0', role: 'user', content: 'I like apple pie', sessionId: 'A', seq: 0 },
      { id: 'a1', role: 'assistant', content: 'banana split', sessionId: 'A', seq: 1 },
      { id: 'b0', role: 'user', content: 'apple juice please', sessionId: 'B', seq: 0 },
      { id: 'c0', role: 'user', content: 'nothing relevant here', sessionId: 'C', seq: 0 },
    ];
    for (const m of msgs) await db.saveMessage(m);

    // The store's in-memory sessions/messages are intentionally empty: persistent
    // mode must read the corpus cross-session from Chat_DB, not from memory.
    useUIStore.setState({ searchQuery: 'apple' });
    await useUIStore.getState().runSearch();

    const { searchResults, isSearching } = useUIStore.getState();
    expect(isSearching).toBe(false);

    // Case-insensitive matches for 'apple':
    //  - A.title 'Apple talk' (title)
    //  - A.msg a0 'I like apple pie' (message)
    //  - B.msg b0 'apple juice please' (message)
    // Ordered by session updatedAt desc (A before B); within A title precedes message.
    expect(
      searchResults.map((r) => ({ sessionId: r.sessionId, matchType: r.matchType, messageId: r.messageId })),
    ).toEqual([
      { sessionId: 'A', matchType: 'title', messageId: undefined },
      { sessionId: 'A', matchType: 'message', messageId: 'a0' },
      { sessionId: 'B', matchType: 'message', messageId: 'b0' },
    ]);
    // Session C (no title/message match) contributes nothing.
    expect(searchResults.some((r) => r.sessionId === 'C')).toBe(false);
    // sessionTitle snapshot is carried through for direct rendering.
    expect(searchResults[0].sessionTitle).toBe('Apple talk');
  });
});

describe('Chat_Store runSearch — Memory_Fallback_Mode in-memory corpus (Req 4.2)', () => {
  it('searches all in-memory titles + current session messages; non-current messages are not available', async () => {
    // A db that would throw if any read were attempted — proves memory mode never reads DB.
    const guardDb: ChatDb = {
      async init() {},
      async getAllSessions() {
        throw new Error('getAllSessions must not be called in Memory_Fallback_Mode');
      },
      async getMessages() {
        throw new Error('getMessages must not be called in Memory_Fallback_Mode');
      },
      async saveSession() {},
      async saveMessage() {},
      async deleteSession() {},
      async deleteMessage() {},
      async truncateMessagesAfter() {},
    };
    setChatDbForTesting(guardDb);

    const sessCur = makeSession('cur', 'Apple current', '2024-02-02T00:00:00.000Z');
    const sessOther = makeSession('other', 'Apple other', '2024-02-01T00:00:00.000Z');
    const currentMessages: ChatMessage[] = [
      { id: 'm1', role: 'user', content: 'apple in current session' },
      { id: 'm2', role: 'assistant', content: 'unrelated reply' },
    ];

    useUIStore.setState({
      isPersistent: false,
      sessions: [sessCur, sessOther],
      currentSessionId: 'cur',
      messages: currentMessages,
      searchQuery: 'apple',
      searchResults: [],
      isSearching: false,
    });

    await expect(useUIStore.getState().runSearch()).resolves.toBeUndefined();

    const { searchResults, isSearching } = useUIStore.getState();
    expect(isSearching).toBe(false);

    // Both session titles match (in-memory titles always searchable), and the
    // current session's loaded message matches. The 'other' session's messages
    // are NOT in memory ([]), so no message match can come from it.
    expect(
      searchResults.map((r) => ({ sessionId: r.sessionId, matchType: r.matchType, messageId: r.messageId })),
    ).toEqual([
      { sessionId: 'cur', matchType: 'title', messageId: undefined },
      { sessionId: 'cur', matchType: 'message', messageId: 'm1' },
      { sessionId: 'other', matchType: 'title', messageId: undefined },
    ]);
  });
});

describe('Chat_Store runSearch — DB read failure falls back to in-memory (Req 9.2)', () => {
  it('does not throw and returns results from the in-memory corpus when getAllSessions rejects', async () => {
    const rejectingDb: ChatDb = {
      async init() {},
      async getAllSessions() {
        throw new Error('simulated IndexedDB read failure');
      },
      async getMessages() {
        throw new Error('simulated IndexedDB read failure');
      },
      async saveSession() {},
      async saveMessage() {},
      async deleteSession() {},
      async deleteMessage() {},
      async truncateMessagesAfter() {},
    };
    setChatDbForTesting(rejectingDb);

    const sessCur = makeSession('cur', 'Apple title', '2024-03-01T00:00:00.000Z');
    const currentMessages: ChatMessage[] = [
      { id: 'm1', role: 'user', content: 'apple content in memory' },
    ];

    // Persistent mode is on, so runSearch attempts a DB read first; the reject
    // must be caught and degrade to the in-memory corpus without throwing.
    useUIStore.setState({
      isPersistent: true,
      sessions: [sessCur],
      currentSessionId: 'cur',
      messages: currentMessages,
      searchQuery: 'apple',
      searchResults: [],
      isSearching: false,
    });

    await expect(useUIStore.getState().runSearch()).resolves.toBeUndefined();

    const { searchResults, isSearching } = useUIStore.getState();
    expect(isSearching).toBe(false);
    // Fallback corpus = in-memory titles + current session messages.
    expect(
      searchResults.map((r) => ({ sessionId: r.sessionId, matchType: r.matchType, messageId: r.messageId })),
    ).toEqual([
      { sessionId: 'cur', matchType: 'title', messageId: undefined },
      { sessionId: 'cur', matchType: 'message', messageId: 'm1' },
    ]);
  });
});

describe('Chat_Store runSearch — whitespace query yields empty results (Req 2.2)', () => {
  it('clears results and isSearching for a whitespace-only query without assembling a corpus', async () => {
    // A db that throws on read so we can prove no corpus assembly happens for empty queries.
    const guardDb: ChatDb = {
      async init() {},
      async getAllSessions() {
        throw new Error('must not assemble corpus for empty query');
      },
      async getMessages() {
        throw new Error('must not assemble corpus for empty query');
      },
      async saveSession() {},
      async saveMessage() {},
      async deleteSession() {},
      async deleteMessage() {},
      async truncateMessagesAfter() {},
    };
    setChatDbForTesting(guardDb);

    useUIStore.setState({
      isPersistent: true,
      sessions: [makeSession('s', 'Apple', '2024-04-01T00:00:00.000Z')],
      currentSessionId: 's',
      messages: [{ id: 'x', role: 'user', content: 'apple' }],
      // Seed a stale non-empty result to prove it gets cleared.
      searchResults: [
        {
          sessionId: 's',
          sessionTitle: 'Apple',
          updatedAt: '2024-04-01T00:00:00.000Z',
          matchType: 'title',
          snippet: 'Apple',
          highlights: [{ start: 0, length: 5 }],
        },
      ],
      isSearching: true,
      searchQuery: '   ',
    });

    await expect(useUIStore.getState().runSearch()).resolves.toBeUndefined();

    const { searchResults, isSearching } = useUIStore.getState();
    expect(searchResults).toEqual([]);
    expect(isSearching).toBe(false);
  });
});
