import type { Character } from '@/store/uiStore';

/** Character_DB public interface. All methods are async and reject on failure. */
export interface CharacterDb {
  /** Open/upgrade the database and create the object store. */
  init(): Promise<void>;
  /** Read all characters (unordered; caller preserves/derives ordering). */
  getAllCharacters(): Promise<Character[]>;
  /** Insert or update a character (put, idempotent by id). */
  saveCharacter(character: Character): Promise<void>;
  /** Delete a single character by id. */
  deleteCharacter(characterId: string): Promise<void>;
}

const DB_NAME = 'nuwa-character';
const DB_VERSION = 1;
const STORE_CHARACTERS = 'characters';

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
 * Create a Character_DB instance.
 * @param factory optional injected IDBFactory (e.g. fake-indexeddb in tests);
 *                defaults to globalThis.indexedDB. Does not throw at construction.
 */
export function createCharacterDb(factory?: IDBFactory): CharacterDb {
  let db: IDBDatabase | null = null;

  function getFactory(): IDBFactory | undefined {
    return factory ?? globalThis.indexedDB;
  }

  function requireDb(): IDBDatabase {
    if (!db) {
      throw new Error('Character_DB not initialized: call init() first');
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
        if (!database.objectStoreNames.contains(STORE_CHARACTERS)) {
          database.createObjectStore(STORE_CHARACTERS, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Character_DB open blocked'));
    });
  }

  async function getAllCharacters(): Promise<Character[]> {
    const database = requireDb();
    const tx = database.transaction(STORE_CHARACTERS, 'readonly');
    const result = await requestToPromise(tx.objectStore(STORE_CHARACTERS).getAll());
    return result as Character[];
  }

  async function saveCharacter(character: Character): Promise<void> {
    const database = requireDb();
    const tx = database.transaction(STORE_CHARACTERS, 'readwrite');
    tx.objectStore(STORE_CHARACTERS).put(character);
    await txDone(tx);
  }

  async function deleteCharacter(characterId: string): Promise<void> {
    const database = requireDb();
    const tx = database.transaction(STORE_CHARACTERS, 'readwrite');
    tx.objectStore(STORE_CHARACTERS).delete(characterId);
    await txDone(tx);
  }

  return {
    init,
    getAllCharacters,
    saveCharacter,
    deleteCharacter,
  };
}
