/**
 * In-memory fake Chat_DB for store-level tests.
 *
 * Implements the same async contract as the real IndexedDB-backed Chat_DB but
 * stores everything in plain Maps, so Chat_Store property tests can run fast
 * and deterministically without a real (or faked) IndexedDB.
 *
 * This file is test-only support (no `.test.ts` suffix so Vitest's `include`
 * glob does not treat it as a suite).
 */
import type { ChatDb, PersistedMessage } from '@/lib/chatDb';
import type { ChatSession, ChatMessage } from '@/store/uiStore';

export interface FakeChatDb extends ChatDb {
  /** Direct access to the persisted sessions (by id) for assertions. */
  readonly sessionStore: Map<string, ChatSession>;
  /** Direct access to the persisted messages (by id) for assertions. */
  readonly messageStore: Map<string, PersistedMessage>;
  /** Number of saveMessage calls (for persistence assertions). */
  saveMessageCalls: number;
  /** Number of saveSession calls (for persistence assertions). */
  saveSessionCalls: number;
  /** Number of deleteMessage calls (for persistence assertions). */
  deleteMessageCalls: number;
  /** Number of truncateMessagesAfter calls (for persistence assertions). */
  truncateMessagesAfterCalls: number;
}

export function createFakeChatDb(): FakeChatDb {
  const sessionStore = new Map<string, ChatSession>();
  const messageStore = new Map<string, PersistedMessage>();

  const db: FakeChatDb = {
    sessionStore,
    messageStore,
    saveMessageCalls: 0,
    saveSessionCalls: 0,
    deleteMessageCalls: 0,
    truncateMessagesAfterCalls: 0,

    async init() {
      /* no-op for the in-memory fake */
    },
    async getAllSessions() {
      return Array.from(sessionStore.values());
    },
    async getMessages(sessionId) {
      const rows = Array.from(messageStore.values()).filter((m) => m.sessionId === sessionId);
      rows.sort((a, b) => a.seq - b.seq);
      // Strip the persistence-only fields to mirror the real getMessages return.
      return rows.map(({ sessionId: _s, seq: _q, ...rest }) => rest as ChatMessage);
    },
    async saveSession(session) {
      db.saveSessionCalls += 1;
      sessionStore.set(session.id, { ...session });
    },
    async saveMessage(message) {
      db.saveMessageCalls += 1;
      messageStore.set(message.id, { ...message });
    },
    async deleteSession(sessionId) {
      sessionStore.delete(sessionId);
      for (const [id, m] of messageStore) {
        if (m.sessionId === sessionId) messageStore.delete(id);
      }
    },
    async deleteMessage(messageId) {
      db.deleteMessageCalls += 1;
      messageStore.delete(messageId);
    },
    async truncateMessagesAfter(sessionId, afterSeq) {
      db.truncateMessagesAfterCalls += 1;
      for (const [id, m] of messageStore) {
        if (m.sessionId === sessionId && m.seq > afterSeq) messageStore.delete(id);
      }
    },
  };

  return db;
}
