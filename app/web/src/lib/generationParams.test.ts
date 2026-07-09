// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';

import {
  PARAM_SPECS,
  DEFAULT_CHAT_GEN_PARAMS,
  CHAT_PARAM_KEYS,
  CHAT_GEN_PARAMS_STORAGE_KEY,
  clampParam,
  buildRequestFragment,
  loadChatGenParams,
  saveChatGenParams,
  type ChatParamKey,
  type ChatGenParams,
} from '@/lib/generationParams';

const NUM_RUNS = 200;

/** 任意有限数值（含越界 / 小数 / 负数）。 */
const finiteNumberArb = fc.double({
  min: -100000,
  max: 100000,
  noNaN: true,
});

/** 任意参数 key。 */
const keyArb = fc.constantFrom<ChatParamKey>(...CHAT_PARAM_KEYS);

/** 任意合法 ChatParamState（value 已落在规格范围）。 */
function paramStateArb(key: ChatParamKey) {
  const spec = PARAM_SPECS[key];
  const valueArb = spec.integer
    ? fc.integer({ min: spec.min, max: spec.max })
    : fc.double({ min: spec.min, max: spec.max, noNaN: true });
  const choices = spec.allowUnlimited ? [valueArb, fc.constant(-1)] : [valueArb];
  return fc.record({
    active: fc.boolean(),
    value: fc.oneof(...choices),
  });
}

/** 任意合法 ChatGenParams 状态。 */
const chatGenParamsArb: fc.Arbitrary<ChatGenParams> = fc.record({
  temperature: paramStateArb('temperature'),
  topP: paramStateArb('topP'),
  numPredict: paramStateArb('numPredict'),
  topK: paramStateArb('topK'),
  repeatPenalty: paramStateArb('repeatPenalty'),
});

describe('generationParams pure functions', () => {
  // Feature: chat-generation-parameters, Property 1: Param_Validator 钳制正确性与幂等（前端侧）
  // Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
  it('clampParam clamps into spec range, rounds integers, preserves -1, and is idempotent', () => {
    fc.assert(
      fc.property(keyArb, finiteNumberArb, (key, raw) => {
        const spec = PARAM_SPECS[key];
        const v = clampParam(key, raw);

        if (spec.allowUnlimited && raw === -1) {
          expect(v).toBe(-1);
          return;
        }
        // 落在闭区间范围内
        expect(v).toBeGreaterThanOrEqual(spec.min);
        expect(v).toBeLessThanOrEqual(spec.max);
        // 整型参数为整数
        if (spec.integer) {
          expect(Number.isInteger(v)).toBe(true);
        }
        // 幂等
        expect(clampParam(key, v)).toBe(v);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('clampParam keeps numPredict=-1 as Unlimited_Length and otherwise lands in [1,8192]', () => {
    fc.assert(
      fc.property(finiteNumberArb, (raw) => {
        const v = clampParam('numPredict', raw);
        if (raw === -1) {
          expect(v).toBe(-1);
        } else {
          expect(v).toBeGreaterThanOrEqual(1);
          expect(v).toBeLessThanOrEqual(8192);
          expect(Number.isInteger(v)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: chat-generation-parameters, Property 3: 请求片段保真（Active 子集、键名、钳制值、缺省为空、既有字段不变）
  // Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 6.3
  it('buildRequestFragment yields exactly the active ollama keys with clamped values and never messages/system', () => {
    fc.assert(
      fc.property(chatGenParamsArb, (params) => {
        const fragment = buildRequestFragment(params);
        const fragmentKeys = Object.keys(fragment).sort();

        // 期望键集合：Active 成员的 ollamaKey
        const expectedKeys = CHAT_PARAM_KEYS.filter((k) => params[k].active)
          .map((k) => PARAM_SPECS[k].ollamaKey)
          .sort();
        expect(fragmentKeys).toEqual(expectedKeys);

        // 每个值等于对应 clampParam 结果；Inactive 成员不出现
        for (const key of CHAT_PARAM_KEYS) {
          const ollamaKey = PARAM_SPECS[key].ollamaKey;
          if (params[key].active) {
            expect(fragment[ollamaKey]).toBe(clampParam(key, params[key].value));
          }
        }

        // 绝不包含 messages/system
        expect(Object.prototype.hasOwnProperty.call(fragment, 'messages')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(fragment, 'system')).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('buildRequestFragment returns {} for Default_State', () => {
    expect(buildRequestFragment(DEFAULT_CHAT_GEN_PARAMS)).toEqual({});
  });

  // Feature: chat-generation-parameters, Property 2: Generation_Params 持久化 round-trip
  // Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.6
  describe('persistence round-trip', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('save then load yields an equal object', () => {
      fc.assert(
        fc.property(chatGenParamsArb, (params) => {
          localStorage.clear();
          saveChatGenParams(params);
          const loaded = loadChatGenParams();
          // value 已在范围内，故 normalize 后的 clampParam 不改变它
          for (const key of CHAT_PARAM_KEYS) {
            expect(loaded[key].active).toBe(params[key].active);
            expect(loaded[key].value).toBe(clampParam(key, params[key].value));
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it('returns DEFAULT_CHAT_GEN_PARAMS when storage is empty', () => {
      localStorage.clear();
      expect(loadChatGenParams()).toEqual(DEFAULT_CHAT_GEN_PARAMS);
    });

    it('returns DEFAULT_CHAT_GEN_PARAMS when storage is corrupt', () => {
      localStorage.setItem(CHAT_GEN_PARAMS_STORAGE_KEY, '{not valid json');
      expect(loadChatGenParams()).toEqual(DEFAULT_CHAT_GEN_PARAMS);
    });

    it('merges missing keys with defaults', () => {
      localStorage.setItem(
        CHAT_GEN_PARAMS_STORAGE_KEY,
        JSON.stringify({ temperature: { active: true, value: 1.5 } }),
      );
      const loaded = loadChatGenParams();
      expect(loaded.temperature).toEqual({ active: true, value: 1.5 });
      expect(loaded.topP).toEqual(DEFAULT_CHAT_GEN_PARAMS.topP);
      expect(loaded.numPredict).toEqual(DEFAULT_CHAT_GEN_PARAMS.numPredict);
    });
  });
});

// Feature: chat-generation-parameters, Property 4: 前后端钳制等价（Param_Validator 侧）
// Validates: Requirements 5.2
// 与后端 chat.rs 的 shared_clamp_vectors() 保持完全一致的 (key, raw, expected) 三元组，
// 前后端各自断言「自侧钳制结果 == 期望值」，从而间接保证两侧相等。
interface ClampCase {
  key: ChatParamKey;
  raw: number;
  expected: number;
}

const SHARED_CLAMP_VECTORS: ClampCase[] = [
  // temperature [0, 2]
  { key: 'temperature', raw: -5, expected: 0 },
  { key: 'temperature', raw: 0, expected: 0 },
  { key: 'temperature', raw: 1.3, expected: 1.3 },
  { key: 'temperature', raw: 2, expected: 2 },
  { key: 'temperature', raw: 9, expected: 2 },
  // topP [0, 1]
  { key: 'topP', raw: -1, expected: 0 },
  { key: 'topP', raw: 0.5, expected: 0.5 },
  { key: 'topP', raw: 1, expected: 1 },
  { key: 'topP', raw: 3, expected: 1 },
  // repeatPenalty [0, 2]
  { key: 'repeatPenalty', raw: -2, expected: 0 },
  { key: 'repeatPenalty', raw: 1.1, expected: 1.1 },
  { key: 'repeatPenalty', raw: 5, expected: 2 },
  // topK [0, 100] 整型
  { key: 'topK', raw: -10, expected: 0 },
  { key: 'topK', raw: 3.7, expected: 4 },
  { key: 'topK', raw: 40, expected: 40 },
  { key: 'topK', raw: 250, expected: 100 },
  // numPredict: -1 逃逸 + [1, 8192] 整型
  { key: 'numPredict', raw: -1, expected: -1 },
  { key: 'numPredict', raw: 0, expected: 1 },
  { key: 'numPredict', raw: 512.4, expected: 512 },
  { key: 'numPredict', raw: 99999, expected: 8192 },
];

describe('front/back clamp equivalence (Property 4)', () => {
  it('clampParam matches shared test vectors (note: topP raw=-1 is not numPredict escape)', () => {
    for (const c of SHARED_CLAMP_VECTORS) {
      // topP 的 raw=-1 不是 Unlimited 逃逸，应钳制到 0
      expect(clampParam(c.key, c.raw)).toBe(c.expected);
    }
  });

  it('random inputs always land in range (range recheck)', () => {
    fc.assert(
      fc.property(keyArb, finiteNumberArb, (key, raw) => {
        const spec = PARAM_SPECS[key];
        const v = clampParam(key, raw);
        if (!(spec.allowUnlimited && raw === -1)) {
          expect(v).toBeGreaterThanOrEqual(spec.min);
          expect(v).toBeLessThanOrEqual(spec.max);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
