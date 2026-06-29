import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
// fake-indexeddb/auto installs the global IndexedDB constructors jsdom lacks.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  useUIStore,
  defaultCharacters,
  setCharacterDbForTesting,
  type Character,
  type CharacterInput,
} from '@/store/uiStore';
import { createCharacterDb } from '@/lib/characterDb';

/**
 * Property-based tests for the Character_Store actions in `uiStore.ts`
 * (tasks 4.2 / 4.3 / 4.4 / 4.5). A real Character_DB backed by a fresh
 * fake-indexeddb IDBFactory is injected per iteration so the store actions
 * exercise their real persistence logic.
 */

const DEFAULT_IDS = new Set(defaultCharacters.map((c) => c.id));

const gradientArb = fc.constantFrom(
  'linear-gradient(135deg, #48CAE4, #0096C7)',
  'linear-gradient(135deg, #FF6B9D, #D44D7A)',
  'linear-gradient(135deg, #52B788, #40916C)',
  'linear-gradient(135deg, #7B82E1, #5A60C0)',
);

/** Arbitrary Character with a caller-supplied id (ids never collide with defaults). */
function characterArb(id: string): fc.Arbitrary<Character> {
  return fc.record({
    id: fc.constant(id),
    name: fc.string({ minLength: 1, maxLength: 20 }).map((s) => s.trim() || 'x'),
    avatar: gradientArb,
    systemPrompt: fc.string({ maxLength: 40 }),
    voiceId: fc.oneof(fc.constant(''), fc.string({ maxLength: 8 })),
    description: fc.string({ maxLength: 40 }),
  });
}

/** A collection of characters with unique non-default ids. */
function persistedCharactersArb(opts?: { minLength?: number }): fc.Arbitrary<Character[]> {
  return fc
    .uniqueArray(fc.string({ minLength: 1, maxLength: 10 }).map((s) => `c_${s}`), {
      minLength: opts?.minLength ?? 0,
      maxLength: 6,
    })
    .chain((ids) => fc.tuple(...ids.map((id) => characterArb(id))));
}

/** A valid CharacterInput (name trims to a non-empty value). */
function characterInputArb(): fc.Arbitrary<CharacterInput> {
  return fc.record({
    name: fc.string({ minLength: 1, maxLength: 20 }).map((s) => s.trim() || 'name'),
    systemPrompt: fc.string({ maxLength: 40 }),
    description: fc.string({ maxLength: 40 }),
    avatar: gradientArb,
    voiceId: fc.oneof(fc.constant(''), fc.string({ maxLength: 8 })),
  });
}

function byId<T extends { id: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => a.id.localeCompare(b.id));
}

/** Create + init a fresh Character_DB, optionally pre-seeded, and inject it. */
async function injectFreshDb(seed: Character[] = []) {
  const db = createCharacterDb(new IDBFactory());
  await db.init();
  for (const c of seed) await db.saveCharacter(c);
  setCharacterDbForTesting(db);
  return db;
}

/** Reset the store's character slice to a clean pre-load state. */
function resetStore() {
  useUIStore.setState({
    characters: [],
    currentCharacterId: 'assistant',
    charactersLoading: true,
    charactersPersistent: true,
  });
}

beforeEach(() => {
  resetStore();
});

// ---------------------------------------------------------------------------
// Task 4.2 - Property 2: seed initialization idempotency
// ---------------------------------------------------------------------------

describe('Character_Store seed initialization (Property 2)', () => {
  it('seeds defaults when empty, restores persisted when non-empty, and is idempotent', async () => {
    // Feature: character-persona-management, Property 2: 种子初始化幂等
    await fc.assert(
      fc.asyncProperty(persistedCharactersArb(), async (initial) => {
        const db = await injectFreshDb(initial);
        resetStore();

        await useUIStore.getState().loadCharacters();
        const chars = useUIStore.getState().characters;

        if (initial.length === 0) {
          // Empty persistent layer -> characters equal Default_Characters...
          expect(byId(chars)).toEqual(byId(defaultCharacters));
          // ...and every default has been persisted.
          const persisted = await db.getAllCharacters();
          expect(byId(persisted)).toEqual(byId(defaultCharacters));
        } else {
          // Non-empty persistent layer -> equals persisted content...
          expect(byId(chars)).toEqual(byId(initial));
          // ...with no Default_Characters mixed in.
          const mixed = chars.some((c) => DEFAULT_IDS.has(c.id));
          expect(mixed).toBe(false);
        }

        // Idempotent: a second load yields the same set (no duplicate appends).
        const before = byId(useUIStore.getState().characters);
        await useUIStore.getState().loadCharacters();
        expect(byId(useUIStore.getState().characters)).toEqual(before);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Task 4.3 - Property 6: create/update field fidelity & isolation
// ---------------------------------------------------------------------------

describe('Character_Store create/update fidelity (Property 6)', () => {
  it('creates/updates with input fields, keeping id stable and others intact', async () => {
    // Feature: character-persona-management, Property 6: 新建/编辑字段保真且隔离
    await fc.assert(
      fc.asyncProperty(
        persistedCharactersArb({ minLength: 1 }),
        fc.nat(),
        characterInputArb(),
        characterInputArb(),
        async (initial, targetIdx, createInput, updateInput) => {
          await injectFreshDb(initial);
          resetStore();
          await useUIStore.getState().loadCharacters();

          const baseChars = useUIStore.getState().characters;
          const beforeCount = baseChars.length;

          // createCharacter: new character matches input (name trimmed).
          await useUIStore.getState().createCharacter(createInput);
          const afterCreate = useUIStore.getState().characters;
          expect(afterCreate.length).toBe(beforeCount + 1);
          const created = afterCreate[afterCreate.length - 1];
          expect(created.name).toBe(createInput.name.trim());
          expect(created.systemPrompt).toBe(createInput.systemPrompt);
          expect(created.description).toBe(createInput.description);
          expect(created.avatar).toBe(createInput.avatar);
          expect(created.voiceId).toBe(createInput.voiceId);

          // updateCharacter: target updated, id stable, others unchanged.
          const target = afterCreate[targetIdx % afterCreate.length];
          const others = afterCreate.filter((c) => c.id !== target.id);
          await useUIStore.getState().updateCharacter(target.id, updateInput);
          const afterUpdate = useUIStore.getState().characters;

          const updated = afterUpdate.find((c) => c.id === target.id);
          expect(updated).toBeDefined();
          expect(updated!.id).toBe(target.id);
          expect(updated!.name).toBe(updateInput.name.trim());
          expect(updated!.systemPrompt).toBe(updateInput.systemPrompt);
          expect(updated!.description).toBe(updateInput.description);
          expect(updated!.avatar).toBe(updateInput.avatar);
          expect(updated!.voiceId).toBe(updateInput.voiceId);

          // Every other character remains unchanged.
          for (const o of others) {
            const still = afterUpdate.find((c) => c.id === o.id);
            expect(still).toEqual(o);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Task 4.4 - Property 4 (store part): empty-name create/update is a no-op
// ---------------------------------------------------------------------------

describe('Character_Store empty-name validation (Property 4, store part)', () => {
  it('whitespace-only name neither creates nor mutates the target', async () => {
    // Feature: character-persona-management, Property 4: 名称 trim 校验语义（store 部分）
    const blankNameArb = fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\u3000'), { maxLength: 6 });
    await fc.assert(
      fc.asyncProperty(
        persistedCharactersArb({ minLength: 1 }),
        fc.nat(),
        blankNameArb,
        characterInputArb(),
        async (initial, targetIdx, blankName, restInput) => {
          await injectFreshDb(initial);
          resetStore();
          await useUIStore.getState().loadCharacters();

          const before = useUIStore.getState().characters;
          const target = before[targetIdx % before.length];

          // createCharacter with blank name -> count unchanged.
          await useUIStore.getState().createCharacter({ ...restInput, name: blankName });
          expect(useUIStore.getState().characters.length).toBe(before.length);

          // updateCharacter with blank name -> target unchanged.
          await useUIStore.getState().updateCharacter(target.id, { ...restInput, name: blankName });
          const stillTarget = useUIStore.getState().characters.find((c) => c.id === target.id);
          expect(stillTarget).toEqual(target);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Task 4.5 - Property 7 (store part): delete semantics & keep-at-least-one
// ---------------------------------------------------------------------------

describe('Character_Store delete semantics (Property 7, store part)', () => {
  it('deletes the target when >=2, and refuses when exactly 1', async () => {
    // Feature: character-persona-management, Property 7: 删除语义与至少保留一个（store 部分）
    await fc.assert(
      fc.asyncProperty(
        persistedCharactersArb({ minLength: 2 }),
        fc.nat(),
        async (initial, delIdx) => {
          const db = await injectFreshDb(initial);
          resetStore();
          await useUIStore.getState().loadCharacters();

          const before = useUIStore.getState().characters;
          const target = before[delIdx % before.length];
          const others = before.filter((c) => c.id !== target.id);

          await useUIStore.getState().deleteCharacter(target.id);
          const after = useUIStore.getState().characters;

          // Target removed, length minus one, others intact.
          expect(after.find((c) => c.id === target.id)).toBeUndefined();
          expect(after.length).toBe(before.length - 1);
          expect(byId(after)).toEqual(byId(others));
          // Persistent record deleted too.
          const persisted = await db.getAllCharacters();
          expect(persisted.find((c) => c.id === target.id)).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('refuses to delete the only remaining character and never calls Character_DB delete', async () => {
    // Feature: character-persona-management, Property 7: 恰 1 条时不删除且不调 Character_DB
    await fc.assert(
      fc.asyncProperty(characterArb('only-one'), async (only) => {
        let deleteCalls = 0;
        const stub = {
          init: async () => {},
          getAllCharacters: async () => [only],
          saveCharacter: async () => {},
          deleteCharacter: async () => { deleteCalls += 1; },
        };
        setCharacterDbForTesting(stub);
        resetStore();
        await useUIStore.getState().loadCharacters();
        expect(useUIStore.getState().characters.length).toBe(1);

        await useUIStore.getState().deleteCharacter(only.id);
        // Character unchanged, DB delete never invoked.
        expect(useUIStore.getState().characters).toEqual([only]);
        expect(deleteCalls).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});
