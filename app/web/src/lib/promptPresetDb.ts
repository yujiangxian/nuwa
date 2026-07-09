// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import type { PromptPreset } from '@/store/uiStore';

/** Preset_DB public interface. All methods are async and reject on failure. */
export interface PresetDb {
  /** Open/upgrade the database and create the object store. */
  init(): Promise<void>;
  /** Read all presets (unordered; caller preserves/derives ordering). */
  getAllPresets(): Promise<PromptPreset[]>;
  /** Insert or update a preset (put, idempotent by id). */
  savePreset(preset: PromptPreset): Promise<void>;
  /** Delete a single preset by id. */
  deletePreset(presetId: string): Promise<void>;
}

const DB_NAME = 'nuwa-prompt-preset';
const DB_VERSION = 1;
const STORE_PRESETS = 'presets';

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
 * Create a Preset_DB instance.
 * @param factory optional injected IDBFactory (e.g. fake-indexeddb in tests);
 *                defaults to globalThis.indexedDB. Does not throw at construction.
 */
export function createPresetDb(factory?: IDBFactory): PresetDb {
  let db: IDBDatabase | null = null;

  function getFactory(): IDBFactory | undefined {
    return factory ?? globalThis.indexedDB;
  }

  function requireDb(): IDBDatabase {
    if (!db) {
      throw new Error('Preset_DB not initialized: call init() first');
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
        if (!database.objectStoreNames.contains(STORE_PRESETS)) {
          database.createObjectStore(STORE_PRESETS, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Preset_DB open blocked'));
    });
  }

  async function getAllPresets(): Promise<PromptPreset[]> {
    const database = requireDb();
    const tx = database.transaction(STORE_PRESETS, 'readonly');
    const result = await requestToPromise(tx.objectStore(STORE_PRESETS).getAll());
    return result as PromptPreset[];
  }

  async function savePreset(preset: PromptPreset): Promise<void> {
    const database = requireDb();
    const tx = database.transaction(STORE_PRESETS, 'readwrite');
    tx.objectStore(STORE_PRESETS).put(preset);
    await txDone(tx);
  }

  async function deletePreset(presetId: string): Promise<void> {
    const database = requireDb();
    const tx = database.transaction(STORE_PRESETS, 'readwrite');
    tx.objectStore(STORE_PRESETS).delete(presetId);
    await txDone(tx);
  }

  return {
    init,
    getAllPresets,
    savePreset,
    deletePreset,
  };
}
