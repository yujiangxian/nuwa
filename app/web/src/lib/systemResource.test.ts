// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { totalInstalledSizeMb, usageLevel } from '@/lib/systemResource';
import { MODEL_TYPES } from '@/lib/modelTypes';
import type { InstalledModel, ModelType } from '@/lib/modelTypes';

const NUM_RUNS = 200;

const modelTypeArb = fc.constantFrom<ModelType>(...MODEL_TYPES);

const installedModelArb: fc.Arbitrary<InstalledModel> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 6 }),
  name: fc.string({ maxLength: 8 }),
  model_type: modelTypeArb,
  path: fc.constant(''),
  size_mb: fc.double({ min: 0, max: 1e5, noNaN: true }),
  files: fc.nat({ max: 10 }),
  main_files: fc.constant<string[]>([]),
  description: fc.constant(''),
  version: fc.constant(''),
  quant: fc.constant(''),
  source: fc.constant('local'),
});

describe('systemResource', () => {
  // Feature: model-management, Property 13: 已安装模型总占用等于各 size_mb 之和
  // Validates: Requirements 7.2, 7.3
  it('totalInstalledSizeMb equals the sum of size_mb (0 for empty)', () => {
    fc.assert(
      fc.property(fc.array(installedModelArb, { maxLength: 40 }), (models) => {
        const expected = models.reduce((s, m) => s + m.size_mb, 0);
        expect(totalInstalledSizeMb(models)).toBeCloseTo(expected, 6);
      }),
      { numRuns: NUM_RUNS },
    );
    expect(totalInstalledSizeMb([])).toBe(0);
  });

  // Feature: model-management, Property 14: 资源占用等级分级
  // Validates: Requirements 7.4
  it('usageLevel classifies by threshold', () => {
    fc.assert(
      fc.property(fc.double({ min: -10, max: 200, noNaN: true }), (p) => {
        const level = usageLevel(p);
        if (p > 90) expect(level).toBe('high');
        else if (p > 75) expect(level).toBe('medium');
        else expect(level).toBe('normal');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // 单元边界用例
  it('usageLevel boundary values', () => {
    expect(usageLevel(75)).toBe('normal');
    expect(usageLevel(75.0001)).toBe('medium');
    expect(usageLevel(90)).toBe('medium');
    expect(usageLevel(90.0001)).toBe('high');
    expect(usageLevel(0)).toBe('normal');
    expect(usageLevel(100)).toBe('high');
  });
});
