import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { filterInstalledByType, filterPresets } from '@/lib/modelFilter';
import { MODEL_TYPES } from '@/lib/modelTypes';
import type { InstalledModel, PresetModel, ModelType, ModelTypeFilter } from '@/lib/modelTypes';

const NUM_RUNS = 200;

/** 任意 Model_Type（枚举内）。 */
const modelTypeArb = fc.constantFrom<ModelType>(...MODEL_TYPES);

/** 类型字符串：枚举内或刻意混入枚举外字符串。 */
const typeStringArb = fc.oneof(
  modelTypeArb,
  fc.constantFrom('weird_type', 'OTHER', '', 'asr '),
);

const installedModelArb: fc.Arbitrary<InstalledModel> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 8 }),
  name: fc.string({ maxLength: 12 }),
  model_type: typeStringArb,
  path: fc.string({ maxLength: 8 }),
  size_mb: fc.double({ min: 0, max: 1e6, noNaN: true }),
  files: fc.nat({ max: 50 }),
  main_files: fc.array(fc.string({ maxLength: 6 }), { maxLength: 3 }),
  description: fc.string({ maxLength: 12 }),
  version: fc.string({ maxLength: 4 }),
  quant: fc.string({ maxLength: 4 }),
  source: fc.constantFrom('local', 'ollama', 'huggingface', ''),
});

const presetModelArb: fc.Arbitrary<PresetModel> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 8 }),
  name: fc.string({ maxLength: 12 }),
  model_type: typeStringArb,
  description: fc.string({ maxLength: 16 }),
  size_mb: fc.double({ min: 0, max: 1e6, noNaN: true }),
  source: fc.constantFrom('hf', 'ms', 'ollama'),
  repo_id: fc.string({ maxLength: 8 }),
  dest_dir: fc.string({ maxLength: 8 }),
  note: fc.option(fc.string({ maxLength: 12 }), { nil: undefined }),
  is_downloaded: fc.option(fc.boolean(), { nil: undefined }),
  installed_model_id: fc.option(fc.string({ maxLength: 8 }), { nil: null }),
});

const filterArb: fc.Arbitrary<ModelTypeFilter> = fc.oneof(
  fc.constant<ModelTypeFilter>('all'),
  modelTypeArb,
);

describe('modelFilter', () => {
  // Feature: model-management, Property 1: 已安装模型按类型筛选为类型匹配子集，且「全部」恒等
  // Validates: Requirements 1.3, 1.4, 1.8
  it('filterInstalledByType returns a type-matching subset; "all" is identity', () => {
    fc.assert(
      fc.property(fc.array(installedModelArb, { maxLength: 30 }), filterArb, (models, filter) => {
        const out = filterInstalledByType(models, filter);
        // 输出是输入的多重子集（按引用计数不超过输入）
        for (const m of out) {
          expect(models).toContain(m);
        }
        expect(out.length).toBeLessThanOrEqual(models.length);
        if (filter === 'all') {
          expect(out).toEqual(models);
        } else {
          for (const m of out) expect(m.model_type).toBe(filter);
          // 匹配元素一个不漏
          const expected = models.filter((m) => m.model_type === filter);
          expect(out.length).toBe(expected.length);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: model-management, Property 3: 预设搜索为命中子集且空关键词不过滤
  // Validates: Requirements 3.2, 3.3, 3.4
  it('filterPresets returns matching subset; empty query keeps all (by type)', () => {
    fc.assert(
      fc.property(
        fc.array(presetModelArb, { maxLength: 30 }),
        fc.string({ maxLength: 6 }),
        filterArb,
        (presets, query, typeFilter) => {
          const out = filterPresets(presets, query, typeFilter);
          expect(out.length).toBeLessThanOrEqual(presets.length);
          const q = query.toLowerCase();
          for (const p of out) {
            expect(presets).toContain(p);
            if (q) {
              const hit =
                p.name.toLowerCase().includes(q) ||
                p.description.toLowerCase().includes(q) ||
                (!!p.note && p.note.toLowerCase().includes(q));
              expect(hit).toBe(true);
            }
            if (typeFilter !== 'all') {
              expect(p.model_type).toBe(typeFilter);
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // 单元边界用例
  it('filterPresets is case-insensitive and handles missing note', () => {
    const presets: PresetModel[] = [
      { id: '1', name: 'Whisper', model_type: 'asr', description: 'Speech', size_mb: 100, source: 'hf', repo_id: 'r', dest_dir: 'd' },
      { id: '2', name: 'Other', model_type: 'tts', description: 'x', size_mb: 1, source: 'hf', repo_id: 'r', dest_dir: 'd', note: 'COOL note' },
    ];
    expect(filterPresets(presets, 'whisper', 'all').map((p) => p.id)).toEqual(['1']);
    expect(filterPresets(presets, 'cool', 'all').map((p) => p.id)).toEqual(['2']);
    expect(filterPresets(presets, '', 'all')).toEqual(presets);
    expect(filterPresets(presets, '', 'asr').map((p) => p.id)).toEqual(['1']);
  });

  it('filterInstalledByType "all" returns element-equal list and empty input stays empty', () => {
    expect(filterInstalledByType([], 'all')).toEqual([]);
    expect(filterInstalledByType([], 'asr')).toEqual([]);
    const models: InstalledModel[] = [
      { id: 'a', name: 'A', model_type: 'asr', path: '', size_mb: 1, files: 1, main_files: [], description: '', version: '', quant: '', source: 'local' },
    ];
    expect(filterInstalledByType(models, 'all')).toEqual(models);
    expect(filterInstalledByType(models, 'tts')).toEqual([]);
  });
});
