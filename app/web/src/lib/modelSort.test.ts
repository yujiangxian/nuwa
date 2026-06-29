import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { sortInstalled, sortPresets } from '@/lib/modelSort';
import type { InstalledSortBy, PresetSortBy } from '@/lib/modelSort';
import { filterPresets } from '@/lib/modelFilter';
import { MODEL_TYPES } from '@/lib/modelTypes';
import type { InstalledModel, PresetModel, ModelMetaMap, ModelType, ModelTypeFilter } from '@/lib/modelTypes';

const NUM_RUNS = 200;

const modelTypeArb = fc.constantFrom<ModelType>(...MODEL_TYPES);

const installedModelArb: fc.Arbitrary<InstalledModel> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 6 }),
  name: fc.string({ maxLength: 10 }),
  model_type: modelTypeArb,
  path: fc.constant(''),
  size_mb: fc.double({ min: 0, max: 1e5, noNaN: true }),
  files: fc.nat({ max: 10 }),
  main_files: fc.constant<string[]>([]),
  description: fc.constant(''),
  version: fc.constant(''),
  quant: fc.constant(''),
  source: fc.constantFrom('local', 'ollama'),
});

const presetModelArb: fc.Arbitrary<PresetModel> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 6 }),
  name: fc.string({ maxLength: 10 }),
  model_type: modelTypeArb,
  description: fc.constant(''),
  size_mb: fc.double({ min: 0, max: 1e5, noNaN: true }),
  source: fc.constant('hf'),
  repo_id: fc.constant('r'),
  dest_dir: fc.constant('d'),
  note: fc.option(fc.string({ maxLength: 6 }), { nil: undefined }),
  is_downloaded: fc.option(fc.boolean(), { nil: undefined }),
  installed_model_id: fc.constant(null),
});

/** 多重集相等：按 id 计数比较（id 在生成器内唯一性不保证，故用排序后的引用序列）。 */
function sameMultiset<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  const ca = new Set(a);
  for (const x of a) if (!b.includes(x)) return false;
  return ca.size <= a.length && b.every((y) => a.includes(y));
}

describe('modelSort', () => {
  // Feature: model-management, Property 2: 已安装模型排序为输入排列且按所选键有序
  // Validates: Requirements 1.5, 1.6, 1.7, 1.8
  it('sortInstalled is a permutation of input and ordered by selected key', () => {
    const sortByArb = fc.constantFrom<InstalledSortBy>('recent', 'name', 'size_desc', 'size_asc');
    fc.assert(
      fc.property(
        fc.array(installedModelArb, { maxLength: 25 }),
        sortByArb,
        (models, sortBy) => {
          // meta：部分模型有 last_used
          const meta: ModelMetaMap = {};
          for (const m of models) {
            if (Math.random() < 0.5) meta[m.id] = { notes: '', tags: [], last_used: Math.floor(Math.random() * 1e6) };
          }
          const out = sortInstalled(models, sortBy, meta);
          expect(out.length).toBe(models.length);
          expect(sameMultiset(out, models)).toBe(true);
          // 入参不被修改
          for (let i = 0; i < out.length - 1; i++) {
            const a = out[i];
            const b = out[i + 1];
            if (sortBy === 'size_desc') expect(a.size_mb).toBeGreaterThanOrEqual(b.size_mb);
            else if (sortBy === 'size_asc') expect(a.size_mb).toBeLessThanOrEqual(b.size_mb);
            else if (sortBy === 'name') expect(a.name.localeCompare(b.name)).toBeLessThanOrEqual(0);
            else {
              // recent：last_used 降序（缺失记 0），tie 按 name 升序
              const ta = meta[a.id]?.last_used || 0;
              const tb = meta[b.id]?.last_used || 0;
              if (ta === tb) expect(a.name.localeCompare(b.name)).toBeLessThanOrEqual(0);
              else expect(ta).toBeGreaterThanOrEqual(tb);
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: model-management, Property 4: 预设排序为输入排列且各模式有序
  // Validates: Requirements 3.5, 3.6
  it('sortPresets is a permutation and ordered per mode', () => {
    const sortByArb = fc.constantFrom<PresetSortBy>('installed', 'size_desc', 'size_asc', 'name');
    fc.assert(
      fc.property(fc.array(presetModelArb, { maxLength: 25 }), sortByArb, (presets, sortBy) => {
        const out = sortPresets(presets, sortBy);
        expect(out.length).toBe(presets.length);
        expect(sameMultiset(out, presets)).toBe(true);
        for (let i = 0; i < out.length - 1; i++) {
          const a = out[i];
          const b = out[i + 1];
          if (sortBy === 'size_desc') expect(a.size_mb).toBeGreaterThanOrEqual(b.size_mb);
          else if (sortBy === 'size_asc') expect(a.size_mb).toBeLessThanOrEqual(b.size_mb);
          else if (sortBy === 'name') expect(a.name.localeCompare(b.name)).toBeLessThanOrEqual(0);
          else {
            // installed：downloaded 在前
            if (!!a.is_downloaded !== !!b.is_downloaded) {
              expect(!!a.is_downloaded).toBe(true);
            } else {
              expect(a.name.localeCompare(b.name)).toBeLessThanOrEqual(0);
            }
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: model-management, Property 5: 预设「搜索 + 筛选 + 排序」组合管线的子集不变式
  // Validates: Requirements 3.7
  it('sortPresets(filterPresets(...)) output count <= input and is a subset', () => {
    const sortByArb = fc.constantFrom<PresetSortBy>('installed', 'size_desc', 'size_asc', 'name');
    const filterArb: fc.Arbitrary<ModelTypeFilter> = fc.oneof(fc.constant<ModelTypeFilter>('all'), modelTypeArb);
    fc.assert(
      fc.property(
        fc.array(presetModelArb, { maxLength: 25 }),
        fc.string({ maxLength: 5 }),
        filterArb,
        sortByArb,
        (presets, query, typeFilter, sortBy) => {
          const out = sortPresets(filterPresets(presets, query, typeFilter), sortBy);
          expect(out.length).toBeLessThanOrEqual(presets.length);
          for (const p of out) expect(presets).toContain(p);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // 单元边界用例
  it('sortInstalled with all last_used missing degrades to name ordering', () => {
    const models: InstalledModel[] = [
      { id: 'b', name: 'Beta', model_type: 'asr', path: '', size_mb: 1, files: 0, main_files: [], description: '', version: '', quant: '', source: 'local' },
      { id: 'a', name: 'Alpha', model_type: 'asr', path: '', size_mb: 1, files: 0, main_files: [], description: '', version: '', quant: '', source: 'local' },
    ];
    expect(sortInstalled(models, 'recent', {}).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('sortInstalled does not mutate input', () => {
    const models: InstalledModel[] = [
      { id: 'b', name: 'B', model_type: 'asr', path: '', size_mb: 2, files: 0, main_files: [], description: '', version: '', quant: '', source: 'local' },
      { id: 'a', name: 'A', model_type: 'asr', path: '', size_mb: 1, files: 0, main_files: [], description: '', version: '', quant: '', source: 'local' },
    ];
    const snapshot = [...models];
    sortInstalled(models, 'size_desc', {});
    expect(models).toEqual(snapshot);
  });

  it('empty lists sort to empty', () => {
    expect(sortInstalled([], 'recent', {})).toEqual([]);
    expect(sortPresets([], 'installed')).toEqual([]);
  });
});
