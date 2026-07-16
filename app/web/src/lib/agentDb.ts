// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import type { Agent } from '@/store/types';

export interface AgentDb {
  init(): Promise<void>;
  getAllAgents(): Promise<Agent[]>;
  saveAgent(agent: Agent): Promise<void>;
  deleteAgent(agentId: string): Promise<void>;
}

const DB_NAME = 'nuwa-agent';
const DB_VERSION = 1;
const STORE_AGENTS = 'agents';

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function createAgentDb(factory?: IDBFactory): AgentDb {
  let db: IDBDatabase | null = null;

  function getFactory(): IDBFactory | undefined {
    return factory ?? globalThis.indexedDB;
  }

  function requireDb(): IDBDatabase {
    if (!db) throw new Error('Agent_DB not initialized: call init() first');
    return db;
  }

  async function init(): Promise<void> {
    if (db) return;
    const idb = getFactory();
    if (!idb) throw new Error('IndexedDB is not available in this environment');
    db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = idb.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const database = req.result;
        if (!database.objectStoreNames.contains(STORE_AGENTS)) {
          database.createObjectStore(STORE_AGENTS, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Agent_DB open blocked'));
    });
  }

  async function getAllAgents(): Promise<Agent[]> {
    const database = requireDb();
    const tx = database.transaction(STORE_AGENTS, 'readonly');
    const result = await requestToPromise(tx.objectStore(STORE_AGENTS).getAll());
    return result as Agent[];
  }

  async function saveAgent(agent: Agent): Promise<void> {
    const database = requireDb();
    const tx = database.transaction(STORE_AGENTS, 'readwrite');
    tx.objectStore(STORE_AGENTS).put(agent);
    await txDone(tx);
  }

  async function deleteAgent(agentId: string): Promise<void> {
    const database = requireDb();
    const tx = database.transaction(STORE_AGENTS, 'readwrite');
    tx.objectStore(STORE_AGENTS).delete(agentId);
    await txDone(tx);
  }

  return { init, getAllAgents, saveAgent, deleteAgent };
}
