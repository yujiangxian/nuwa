import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
// fake-indexeddb/auto installs the global IndexedDB constructors jsdom lacks.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  useUIStore,
  setPresetDbForTesting,
  type PromptPreset,
} from '@/store/uiStore';
import { createPresetDb } from '@/lib/promptPresetDb';
import { buildInsertedText, INPUT_MAX_LENGTH } from '@/lib/promptPreset';

/**
 * Property-based tests for the Preset_Store actions in `uiStore.ts` (task 4.2).
 * A real Preset_DB backed by a fresh fake-indexeddb IDBFactory is injected per
 * iteration so the store actions exercise their real persistence logic, with an
 * independent database and a clean preset slice for every example.
 */

/** Arbitrary PromptPreset with a caller-supplied id. */
function presetArb(id: string): fc.Arbitrary<PromptPreset> {
  return fc.record({
    id: fc.constant(id),
    title: fc.string({ minLength: 1, maxLength: 20 }).map((s) => s.trim() || 'title'),
    content: fc.string({ minLength: 1, maxLength: 40 }).map((s) => s.trim() || 'content'),
  });
}

/** A collection of presets with unique ids. */
function presetsArb(opts?: { minLength?: number }): fc.Arbitrary<PromptPreset[]> {
  return fc
    .uniqueArray(fc.string({ minLength: 1, maxLength: 10 }).map((s) => `p_${s}`), {
      minLength: opts?.minLength ?? 0,
      maxLength: 6,
    })
    .chain((ids) => fc.tuple(...ids.map((id) => presetArb(id))));
}

/**
 * A raw title/content pair that passes validatePreset: each trims to a
 * non-empty value, while still allowing surrounding whitespace in the raw form.
 */
function validRawFieldArb(): fc.Arbitrary<string> {
  const pad = fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\u3000'), { maxLength: 3 });
  const core = fc.string({ minLength: 1, maxLength: 20 }).map((s) => s.trim() || 'x');
  return fc.tuple(pad, core, pad).map(([a, c, b]) => `${a}${c}${b}`);
}

/** Create + init a fresh Preset_DB on an independent database, seed it, inject it. */
async function injectFreshDb(seed: PromptPreset[] = []) {
  const db = createPresetDb(new IDBFactory());
  await db.init();
  for (const p of seed) await db.savePreset(p);
  setPresetDbForTesting(db);
  return db;
}

/** Reset the store's preset slice to a clean pre-load state. */
function resetStore() {
  useUIStore.setState({
    presets: [],
    presetsLoading: true,
    presetsPersistent: true,
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  resetStore();
});

// ---------------------------------------------------------------------------
// Task 4.2 - Property 4: create/update field fidelity & isolation
// ---------------------------------------------------------------------------

describe('Preset_Store create/update fidelity (Property 4)', () => {
  it('creates/updates with trimmed input fields, keeping id stable and others intact', async () => {
    // Feature: prompt-preset-management, Property 4: 新建/编辑字段保真且隔离
    await fc.assert(
      fc.asyncProperty(
        presetsArb({ minLength: 1 }),
        fc.nat(),
        validRawFieldArb(),
        validRawFieldArb(),
        validRawFieldArb(),
        validRawFieldArb(),
        async (initial, targetIdx, createTitle, createContent, updateTitle, updateContent) => {
          await injectFreshDb(initial);
          resetStore();
          await useUIStore.getState().loadPresets();

          const basePresets = useUIStore.getState().presets;
          const beforeCount = basePresets.length;

          // createPreset: new preset's title/content equal the trimmed inputs.
          await useUIStore.getState().createPreset(createTitle, createContent);
          const afterCreate = useUIStore.getState().presets;
          expect(afterCreate.length).toBe(beforeCount + 1);
          const created = afterCreate[afterCreate.length - 1];
          expect(created.title).toBe(createTitle.trim());
          expect(created.content).toBe(createContent.trim());

          // updatePreset: target updated to trimmed inputs, id stable, others intact.
          const target = afterCreate[targetIdx % afterCreate.length];
          const others = afterCreate.filter((p) => p.id !== target.id);
          await useUIStore.getState().updatePreset(target.id, updateTitle, updateContent);
          const afterUpdate = useUIStore.getState().presets;

          const updated = afterUpdate.find((p) => p.id === target.id);
          expect(updated).toBeDefined();
          expect(updated!.id).toBe(target.id);
          expect(updated!.title).toBe(updateTitle.trim());
          expect(updated!.content).toBe(updateContent.trim());

          // Every other preset remains unchanged.
          for (const o of others) {
            const still = afterUpdate.find((p) => p.id === o.id);
            expect(still).toEqual(o);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Task 4.3 - Property 5: delete semantics
// ---------------------------------------------------------------------------

describe('Preset_Store delete semantics (Property 5)', () => {
  it('removes the targeted preset from presets and from the persisted store, leaving others intact', async () => {
    // Feature: prompt-preset-management, Property 5: 删除语义 —— deletePreset(id) 后 presets 不再包含该预设、其余预设保持不变，且其持久化记录被删除
    await fc.assert(
      fc.asyncProperty(
        presetsArb({ minLength: 1 }),
        fc.nat(),
        async (initial, targetIdx) => {
          const db = await injectFreshDb(initial);
          resetStore();
          await useUIStore.getState().loadPresets();

          const before = useUIStore.getState().presets;
          // loadPresets restores from persistence (unordered), so derive the
          // target from the actual in-memory collection.
          const target = before[targetIdx % before.length];
          const others = before.filter((p) => p.id !== target.id);

          await useUIStore.getState().deletePreset(target.id);

          // In-memory: target removed, others unchanged (same fields, same order among themselves).
          const after = useUIStore.getState().presets;
          expect(after.find((p) => p.id === target.id)).toBeUndefined();
          expect(after.length).toBe(before.length - 1);
          for (const o of others) {
            const still = after.find((p) => p.id === o.id);
            expect(still).toEqual(o);
          }

          // Persisted: the target id is no longer returned by getAllPresets,
          // while every other id is still present (in persistent mode).
          const persisted = await db.getAllPresets();
          expect(persisted.find((p) => p.id === target.id)).toBeUndefined();
          for (const o of others) {
            expect(persisted.find((p) => p.id === o.id)).toBeDefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Task 4.4 - Property 7: insert never mutates the preset collection
// ---------------------------------------------------------------------------

/**
 * Input_Field text covering the empty / whitespace-only / normal cases as well
 * as boundary-long values that push `prev + '\n' + content` past
 * Input_Max_Length, so both the ok and the over-length branches are exercised.
 */
function inputTextArb(): fc.Arbitrary<string> {
  return fc.oneof(
    fc.constant(''),
    fc.constant('   '),
    fc.constant('\t\n  '),
    fc.string({ maxLength: 50 }),
    fc.integer({ min: 1990, max: 2100 }).map((n) => 'x'.repeat(n)),
  );
}

describe('Preset_Store insert is read-only over presets (Property 7)', () => {
  it('keeps presets unchanged across insertPresetIntoInput and writes inputText only when within the limit', () => {
    // Feature: prompt-preset-management, Property 7: 插入不修改预设集合 —— insertPresetIntoInput(id) 执行前后 presets 保持不变（不增、不删、不改）
    fc.assert(
      fc.property(
        presetsArb({ minLength: 1 }),
        fc.nat(),
        fc.boolean(),
        inputTextArb(),
        (presets, targetIdx, useMissingId, inputText) => {
          // Seed the store directly; insert is a pure in-memory read of presets,
          // so no Preset_DB interaction is needed.
          useUIStore.setState({ presets, inputText });

          // Either a real id from the collection or a guaranteed-missing one
          // (the collection uses the `p_` prefix, so this never collides).
          const targetPreset = presets[targetIdx % presets.length];
          const id = useMissingId ? '__missing_id__' : targetPreset.id;

          // Deep snapshot to detect any add / remove / mutate of presets.
          const presetsBefore = JSON.parse(JSON.stringify(presets)) as PromptPreset[];
          const inputTextBefore = inputText;

          const ok = useUIStore.getState().insertPresetIntoInput(id);

          // presets must be byte-for-byte identical before and after the call.
          expect(useUIStore.getState().presets).toEqual(presetsBefore);

          const afterInput = useUIStore.getState().inputText;
          const matched = presets.find((p) => p.id === id);
          if (!matched) {
            // Missing id: no-op, inputText unchanged, returns false.
            expect(ok).toBe(false);
            expect(afterInput).toBe(inputTextBefore);
            return;
          }

          const result = buildInsertedText(inputTextBefore, matched.content, INPUT_MAX_LENGTH);
          expect(ok).toBe(result.ok);
          if (result.ok) {
            // Within the limit: inputText written to the target text.
            expect(afterInput).toBe(result.text);
          } else {
            // Over the limit: inputText left unchanged.
            expect(afterInput).toBe(inputTextBefore);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
