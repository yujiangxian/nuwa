import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
// fake-indexeddb/auto installs the global IndexedDB constructors (indexedDB,
// IDBKeyRange, ...) that jsdom lacks. We still inject a fresh IDBFactory per
// test/run for isolation.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createCharacterDb } from './characterDb';
import type { Character } from '@/store/uiStore';

// ---------------------------------------------------------------------------
// Helpers & arbitraries
// ---------------------------------------------------------------------------

/** Create a Character_DB backed by a brand-new (empty) in-memory IndexedDB. */
async function freshDb() {
  const db = createCharacterDb(new IDBFactory());
  await db.init();
  return db;
}

const gradientArb = fc.constantFrom(
  'linear-gradient(135deg, #48CAE4, #0096C7)',
  'linear-gradient(135deg, #FF6B9D, #D44D7A)',
  'linear-gradient(135deg, #52B788, #40916C)',
  'linear-gradient(135deg, #7B82E1, #5A61C9)',
);

/** Arbitrary Character with a caller-supplied id. */
function characterArb(id: string): fc.Arbitrary<Character> {
  return fc.record({
    id: fc.constant(id),
    name: fc.string(),
    avatar: gradientArb,
    systemPrompt: fc.string(),
    voiceId: fc.oneof(fc.constant(''), fc.string()),
    description: fc.string(),
  });
}

/** Sort characters by id for order-independent comparison. */
function byId(chars: Character[]): Character[] {
  return [...chars].sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Task 2.2 - schema & interface existence (Req 1.1, 1.5)
// ---------------------------------------------------------------------------

describe('Character_DB schema & interface', () => {
  beforeEach(() => {
    // reset the global default store between cases for hygiene
    globalThis.indexedDB = new IDBFactory();
  });

  it('exposes all CharacterDb interface methods', () => {
    const db = createCharacterDb(new IDBFactory());
    expect(typeof db.init).toBe('function');
    expect(typeof db.getAllCharacters).toBe('function');
    expect(typeof db.saveCharacter).toBe('function');
    expect(typeof db.deleteCharacter).toBe('function');
  });

  it('creates the characters store with keyPath id after init()', async () => {
    const factory = new IDBFactory();
    const db = createCharacterDb(factory);
    await db.init();

    // Open a second connection to inspect the resulting schema.
    const inspected = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open('nuwa-character');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    expect(inspected.objectStoreNames.contains('characters')).toBe(true);
    const tx = inspected.transaction('characters', 'readonly');
    const store = tx.objectStore('characters');
    expect(store.keyPath).toBe('id');
    inspected.close();
  });

  it('init() rejects when IndexedDB is unavailable', async () => {
    const original = globalThis.indexedDB;
    // @ts-expect-error simulate missing IndexedDB
    globalThis.indexedDB = undefined;
    try {
      const db = createCharacterDb(); // no factory -> falls back to global (undefined)
      await expect(db.init()).rejects.toThrow();
    } finally {
      globalThis.indexedDB = original;
    }
  });
});

// ---------------------------------------------------------------------------
// Task 2.3 - Property 1: character round-trip
// ---------------------------------------------------------------------------

describe('Character_DB character round-trip (Property 1)', () => {
  // Feature: character-persona-management, Property 1: 角色持久化往返
  it('saveCharacter then getAllCharacters is id-equivalent; re-saving same id yields latest', async () => {
    await fc.assert(
      fc.asyncProperty(
        // unique ids -> one character per id
        fc.uniqueArray(fc.string({ minLength: 1 }), { minLength: 0, maxLength: 8 }).chain((ids) =>
          fc.tuple(...ids.map((id) => characterArb(id))),
        ),
        async (characters) => {
          const db = await freshDb();
          for (const c of characters) {
            await db.saveCharacter(c);
          }
          const stored = await db.getAllCharacters();
          // not lost, not added; all six fields equal by id
          expect(byId(stored)).toEqual(byId(characters));

          // Re-save the same id with a mutated value (edited) -> read back latest.
          if (characters.length > 0) {
            const target = characters[0];
            const updated: Character = {
              ...target,
              name: target.name + '#edited',
              systemPrompt: target.systemPrompt + '!',
              description: target.description + '~',
              voiceId: target.voiceId === 'narrator' ? 'jyy' : 'narrator',
            };
            await db.saveCharacter(updated);
            const after = await db.getAllCharacters();
            const found = after.find((c) => c.id === target.id);
            expect(found).toEqual(updated);
            // count unchanged (put is idempotent by id)
            expect(after.length).toBe(characters.length);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Task 2.4 - Property 7: delete semantics (data layer part)
// ---------------------------------------------------------------------------

describe('Character_DB delete character (Property 7, data layer)', () => {
  // Feature: character-persona-management, Property 7: 删除语义（数据层部分）
  it('deleteCharacter removes only the target, leaving others intact', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .uniqueArray(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 6 })
          .chain((ids) =>
            fc.tuple(
              fc.tuple(...ids.map((id) => characterArb(id))),
              // index of the character to delete
              fc.integer({ min: 0, max: ids.length - 1 }),
            ),
          ),
        async ([characters, deleteIdx]) => {
          const db = await freshDb();
          for (const c of characters) await db.saveCharacter(c);

          const deleted = characters[deleteIdx];
          await db.deleteCharacter(deleted.id);

          const remaining = await db.getAllCharacters();
          // Deleted character is gone.
          expect(remaining.find((c) => c.id === deleted.id)).toBeUndefined();
          // Length decreased by exactly one.
          expect(remaining.length).toBe(characters.length - 1);
          // Every other character is unchanged.
          const expected = characters.filter((c) => c.id !== deleted.id);
          expect(byId(remaining)).toEqual(byId(expected));
        },
      ),
      { numRuns: 100 },
    );
  });
});
