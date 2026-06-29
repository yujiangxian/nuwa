import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { parseActiveModelMap, resolveActiveModelId } from '@/lib/activeModel';
import { MODEL_TYPES } from '@/lib/modelTypes';
import type { ModelConfigView, InstalledModel } from '@/lib/modelTypes';

const NUM_RUNS = 200;

/** id 值：有效 id、空字符串、null、undefined。 */
const maybeIdArb = fc.oneof(
  fc.string({ minLength: 1, maxLength: 6 }),
  fc.constant(''),
  fc.constant(null),
  fc.constant(undefined),
);

const configArb: fc.Arbitrary<ModelConfigView> = fc.record(
  {
    current_asr_model: maybeIdArb,
    current_tts_model: maybeIdArb,
    current_llm_model: maybeIdArb,
    current_models: fc.dictionary(
      fc.constantFrom(...MODEL_TYPES),
      fc.oneof(fc.string({ minLength: 1, maxLength: 6 }), fc.constant('')),
      { maxKeys: 5 },
    ),
  },
  { requiredKeys: [] },
);

describe('activeModel', () => {
  // Feature: model-management, Property 6: 活跃模型映射解析的有效性、优先级与唯一性
  // Validates: Requirements 2.1, 2.2, 2.3, 2.4
  it('parseActiveModelMap yields valid ids, prefers current_models, excludes empties', () => {
    fc.assert(
      fc.property(configArb, (config) => {
        const map = parseActiveModelMap(config as ModelConfigView);
        const currentMap = (config.current_models ?? {}) as Record<string, string>;
        const legacy: Record<string, string | null | undefined> = {
          asr: config.current_asr_model,
          tts: config.current_tts_model,
          llm: config.current_llm_model,
        };
        for (const type of MODEL_TYPES) {
          const v = map[type];
          if (v !== undefined) {
            // 值都是非空字符串
            expect(typeof v).toBe('string');
            expect(v.length).toBeGreaterThan(0);
            // 优先级：current_models 有效则以它为准
            const fromMap = currentMap[type];
            if (typeof fromMap === 'string' && fromMap.length > 0) {
              expect(v).toBe(fromMap);
            } else if (type === 'asr' || type === 'tts' || type === 'llm') {
              expect(v).toBe(legacy[type]);
            }
          } else {
            // 不在结果中 → 两个来源都无有效值
            const fromMap = currentMap[type];
            const fromLegacy = legacy[type as keyof typeof legacy];
            const mapValid = typeof fromMap === 'string' && fromMap.length > 0;
            const legacyValid = typeof fromLegacy === 'string' && fromLegacy.length > 0;
            expect(mapValid || legacyValid).toBe(false);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // 单元边界用例
  it('prefers current_models over legacy fields on conflict', () => {
    const cfg: ModelConfigView = {
      current_asr_model: 'legacy-asr',
      current_models: { asr: 'map-asr' },
    };
    expect(parseActiveModelMap(cfg).asr).toBe('map-asr');
  });

  it('falls back to legacy when current_models lacks the type', () => {
    const cfg: ModelConfigView = { current_tts_model: 'legacy-tts', current_models: {} };
    expect(parseActiveModelMap(cfg).tts).toBe('legacy-tts');
  });

  it('excludes null / empty values', () => {
    const cfg: ModelConfigView = {
      current_asr_model: '',
      current_tts_model: null,
      current_models: { llm: '' },
    };
    expect(parseActiveModelMap(cfg)).toEqual({});
  });

  it('returns empty map for undefined config', () => {
    expect(parseActiveModelMap(undefined)).toEqual({});
  });

  it('resolveActiveModelId returns id only if present in models', () => {
    const models: InstalledModel[] = [
      { id: 'm1', name: 'M1', model_type: 'asr', path: '', size_mb: 1, files: 0, main_files: [], description: '', version: '', quant: '', source: 'local' },
    ];
    expect(resolveActiveModelId({ asr: 'm1' }, 'asr', models)).toBe('m1');
    expect(resolveActiveModelId({ asr: 'ghost' }, 'asr', models)).toBeNull();
    expect(resolveActiveModelId({}, 'asr', models)).toBeNull();
  });
});
