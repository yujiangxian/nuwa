import type { ChatSession, ChatMessage } from '@/store/uiStore';

/**
 * Persisted message record: adds ownership (sessionId) and ordering (seq)
 * fields on top of the runtime ChatMessage shape.
 */
export interface PersistedMessage extends ChatMessage {
  sessionId: string; // foreign key: owning session id
  seq: number; // monotonically increasing sort key, preserves append order
}

/** Chat_DB public interface. All methods are async and reject on failure. */
export interface ChatDb {
  /** Open/upgrade the database and create object stores + indexes. */
  init(): Promise<void>;
  /** Read all sessions (unordered; caller sorts by updatedAt). */
  getAllSessions(): Promise<ChatSession[]>;
  /** Read all messages of a session, returned sorted by seq ascending. */
  getMessages(sessionId: string): Promise<ChatMessage[]>;
  /** Insert or update a session (put, idempotent by id). */
  saveSession(session: ChatSession): Promise<void>;
  /** Insert or update a message (put, idempotent by id; requires sessionId + seq). */
  saveMessage(message: PersistedMessage): Promise<void>;
  /** Delete a session and all of its messages within a single transaction. */
  deleteSession(sessionId: string): Promise<void>;

  /** Delete a single Chat_Message by id (Req 6.1). No-op when the id is absent. */
  deleteMessage(messageId: string): Promise<void>;

  /**
   * Delete every message of a session whose seq is strictly greater than
   * `afterSeq` (Req 6.2), supporting Message_Truncation. Runs in a single
   * read-write transaction over the by-session index cursor, mirroring the
   * deleteSession cursor-delete pattern for atomicity.
   */
  truncateMessagesAfter(sessionId: string, afterSeq: number): Promise<void>;
}

const DB_NAME = 'nuwa-chat';
const DB_VERSION = 1;
const STORE_SESSIONS = 'sessions';
const STORE_MESSAGES = 'messages';
const INDEX_BY_SESSION = 'by-session';

/** Wrap an IDBRequest into a Promise. */
function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Wrap a transaction completion into a Promise. */
function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Create a Chat_DB instance.
 * @param factory optional injected IDBFactory (e.g. fake-indexeddb in tests);
 *                defaults to globalThis.indexedDB. Does not throw at construction.
 */
export function createChatDb(factory?: IDBFactory): ChatDb {
  let db: IDBDatabase | null = null;

  function getFactory(): IDBFactory | undefined {
    return factory ?? globalThis.indexedDB;
  }

  function requireDb(): IDBDatabase {
    if (!db) {
      throw new Error('Chat_DB not initialized: call init() first');
    }
    return db;
  }

  async function init(): Promise<void> {
    if (db) return;
    const idb = getFactory();
    if (!idb) {
      throw new Error('IndexedDB is not available in this environment');
    }
    db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = idb.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const database = req.result;
        if (!database.objectStoreNames.contains(STORE_SESSIONS)) {
          database.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(STORE_MESSAGES)) {
          const messages = database.createObjectStore(STORE_MESSAGES, { keyPath: 'id' });
          messages.createIndex(INDEX_BY_SESSION, 'sessionId', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Chat_DB open blocked'));
    });
  }

  async function getAllSessions(): Promise<ChatSession[]> {
    const database = requireDb();
    const tx = database.transaction(STORE_SESSIONS, 'readonly');
    const result = await requestToPromise(tx.objectStore(STORE_SESSIONS).getAll());
    return result as ChatSession[];
  }

  async function getMessages(sessionId: string): Promise<ChatMessage[]> {
    const database = requireDb();
    const tx = database.transaction(STORE_MESSAGES, 'readonly');
    const index = tx.objectStore(STORE_MESSAGES).index(INDEX_BY_SESSION);
    const rows = (await requestToPromise(index.getAll(sessionId))) as PersistedMessage[];
    // Sort by seq ascending so messages restore in append order.
    rows.sort((a, b) => a.seq - b.seq);
    return rows;
  }

  async function saveSession(session: ChatSession): Promise<void> {
    const database = requireDb();
    const tx = database.transaction(STORE_SESSIONS, 'readwrite');
    tx.objectStore(STORE_SESSIONS).put(session);
    await txDone(tx);
  }

  async function saveMessage(message: PersistedMessage): Promise<void> {
    const database = requireDb();
    const tx = database.transaction(STORE_MESSAGES, 'readwrite');
    tx.objectStore(STORE_MESSAGES).put(message);
    await txDone(tx);
  }

  async function deleteSession(sessionId: string): Promise<void> {
    const database = requireDb();
    // Single read-write transaction over both stores keeps the delete atomic.
    const tx = database.transaction([STORE_SESSIONS, STORE_MESSAGES], 'readwrite');
    tx.objectStore(STORE_SESSIONS).delete(sessionId);
    const index = tx.objectStore(STORE_MESSAGES).index(INDEX_BY_SESSION);
    const cursorReq = index.openCursor(IDBKeyRange.only(sessionId));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    await txDone(tx);
  }

  async function deleteMessage(messageId: string): Promise<void> {
    const database = requireDb();
    // Single read-write transaction; delete by primary key. Deleting a missing
    // key is a no-op in IndexedDB, so absent ids simply complete the tx.
    const tx = database.transaction(STORE_MESSAGES, 'readwrite');
    tx.objectStore(STORE_MESSAGES).delete(messageId);
    await txDone(tx);
  }

  async function truncateMessagesAfter(sessionId: string, afterSeq: number): Promise<void> {
    const database = requireDb();
    // Single read-write transaction + by-session index cursor: delete only the
    // records whose seq > afterSeq, mirroring deleteSession's cursor-delete
    // pattern so the truncation stays atomic and scoped to this session.
    const tx = database.transaction(STORE_MESSAGES, 'readwrite');
    const index = tx.objectStore(STORE_MESSAGES).index(INDEX_BY_SESSION);
    const cursorReq = index.openCursor(IDBKeyRange.only(sessionId));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        const row = cursor.value as PersistedMessage;
        if (row.seq > afterSeq) {
          cursor.delete();
        }
        cursor.continue();
      }
    };
    await txDone(tx);
  }

  return {
    init,
    getAllSessions,
    getMessages,
    saveSession,
    saveMessage,
    deleteSession,
    deleteMessage,
    truncateMessagesAfter,
  };
}
