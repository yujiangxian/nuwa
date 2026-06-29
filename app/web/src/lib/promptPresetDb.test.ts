import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
// fake-indexeddb/auto installs the global IndexedDB constructors (indexedDB,
// IDBKeyRange, ...) that jsdom lacks. We still inject a fresh IDBFactory per
// test/run for isolation.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createPresetDb } from './promptPresetDb';
import type { PromptPreset } from '@/store/uiStore';

// ---------------------------------------------------------------------------
// Task 2.2 - schema & interface existence (Req 1.1, 1.5)
// ---------------------------------------------------------------------------

describe('Preset_DB schema & interface', () => {
  beforeEach(() => {
    // reset the global default store between cases for hygiene
    globalThis.indexedDB = new IDBFactory();
  });

  it('exposes all PresetDb interface methods', () => {
    const db = createPresetDb(new IDBFactory());
    expect(typeof db.init).toBe('function');
    expect(typeof db.getAllPresets).toBe('function');
    expect(typeof db.savePreset).toBe('function');
    expect(typeof db.deletePreset).toBe('function');
  });

  it('creates the presets store with keyPath id after init()', async () => {
    const factory = new IDBFactory();
    const db = createPresetDb(factory);
    await db.init();

    // Open a second connection to inspect the resulting schema.
    const inspected = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open('nuwa-prompt-preset');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    expect(inspected.objectStoreNames.contains('presets')).toBe(true);
    const tx = inspected.transaction('presets', 'readonly');
    const store = tx.objectStore('presets');
    expect(store.keyPath).toBe('id');
    inspected.close();
  });

  it('init() rejects when IndexedDB is unavailable', async () => {
    const original = globalThis.indexedDB;
    // @ts-expect-error simulate missing IndexedDB
    globalThis.indexedDB = undefined;
    try {
      const db = createPresetDb(); // no factory -> falls back to global (undefined)
      await expect(db.init()).rejects.toThrow();
    } finally {
      globalThis.indexedDB = original;
    }
  });
});

// ---------------------------------------------------------------------------
// Helpers & arbitraries (Task 2.3)
// ---------------------------------------------------------------------------

/** Create a Preset_DB backed by a brand-new (empty) in-memory IndexedDB. */
async function freshDb() {
  // Each iteration uses an isolated IDBFactory instance (independent database
  // namespace) so runs never share persisted state.
  const db = createPresetDb(new IDBFactory());
  await db.init();
  return db;
}

/** Arbitrary PromptPreset with a caller-supplied id. */
function presetArb(id: string): fc.Arbitrary<PromptPreset> {
  return fc.record({
    id: fc.constant(id),
    title: fc.string(),
    content: fc.string(),
  });
}

/** Sort presets by id for order-independent comparison. */
function byId(presets: PromptPreset[]): PromptPreset[] {
  return [...presets].sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Task 2.3 - Property 1: preset persistence round-trip
// ---------------------------------------------------------------------------

describe('Preset_DB preset round-trip (Property 1)', () => {
  // Feature: prompt-preset-management, Property 1: 预设持久化往返 - 将每条预设依次
  // savePreset 后，getAllPresets 返回的集合按 id 比较与输入等价（id/title/content
  // 三字段逐一相等、不丢不增）；对同一 id 再次 savePreset（编辑后）后读取得到最新值；
  // deletePreset 后该 id 不再被 getAllPresets 返回。
  // Validates: Requirements 1.2, 1.3, 1.4, 3.4, 4.2
  it('savePreset round-trips by id, re-save yields latest, delete removes the id', async () => {
    await fc.assert(
      fc.asyncProperty(
        // unique ids -> one preset per id
        fc
          .uniqueArray(fc.string({ minLength: 1 }), { minLength: 0, maxLength: 8 })
          .chain((ids) => fc.tuple(...ids.map((id) => presetArb(id)))),
        async (presets) => {
          const db = await freshDb();
          for (const p of presets) {
            await db.savePreset(p);
          }

          // Round-trip: not lost, not added; all three fields equal by id.
          const stored = await db.getAllPresets();
          expect(byId(stored)).toEqual(byId(presets));

          if (presets.length > 0) {
            const target = presets[0];

            // Re-save the same id with mutated values (edited) -> read back latest.
            const updated: PromptPreset = {
              ...target,
              title: target.title + '#edited',
              content: target.content + '~changed',
            };
            await db.savePreset(updated);
            const afterEdit = await db.getAllPresets();
            const found = afterEdit.find((p) => p.id === target.id);
            expect(found).toEqual(updated);
            // count unchanged (put is idempotent by id)
            expect(afterEdit.length).toBe(presets.length);

            // deletePreset -> the id is no longer returned by getAllPresets.
            await db.deletePreset(target.id);
            const afterDelete = await db.getAllPresets();
            expect(afterDelete.find((p) => p.id === target.id)).toBeUndefined();
            expect(afterDelete.length).toBe(presets.length - 1);
            // every other preset remains intact
            const expected = presets.filter((p) => p.id !== target.id);
            expect(byId(afterDelete)).toEqual(byId(expected));
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
