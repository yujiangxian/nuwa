// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { isOllamaModel, canDeleteModel } from '@/lib/installedModel';
import { MODEL_TYPES } from '@/lib/modelTypes';
import type { InstalledModel, ModelType } from '@/lib/modelTypes';

const NUM_RUNS = 200;

const modelTypeArb = fc.constantFrom<ModelType>(...MODEL_TYPES);

const installedModelArb: fc.Arbitrary<InstalledModel> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 6 }),
  name: fc.string({ maxLength: 8 }),
  model_type: modelTypeArb,
  path: fc.constant(''),
  size_mb: fc.double({ min: 0, max: 1e4, noNaN: true }),
  files: fc.nat({ max: 5 }),
  main_files: fc.constant<string[]>([]),
  description: fc.constant(''),
  version: fc.constant(''),
  quant: fc.constant(''),
  source: fc.constantFrom('local', 'ollama', 'huggingface', 'modelscope', ''),
});

describe('installedModel', () => {
  // Feature: model-management, Property 11: 删除资格当且仅当非 Ollama 模型
  // Validates: Requirements 5.1
  it('canDeleteModel is true iff source !== "ollama"', () => {
    fc.assert(
      fc.property(installedModelArb, (model) => {
        expect(canDeleteModel(model)).toBe(model.source !== 'ollama');
        expect(isOllamaModel(model)).toBe(model.source === 'ollama');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // 单元边界用例
  it('classifies known sources', () => {
    const base: Omit<InstalledModel, 'source'> = {
      id: 'a', name: 'A', model_type: 'asr', path: '', size_mb: 1, files: 0, main_files: [], description: '', version: '', quant: '',
    };
    expect(canDeleteModel({ ...base, source: 'ollama' })).toBe(false);
    expect(canDeleteModel({ ...base, source: 'huggingface' })).toBe(true);
    expect(canDeleteModel({ ...base, source: '' })).toBe(true);
  });
});
