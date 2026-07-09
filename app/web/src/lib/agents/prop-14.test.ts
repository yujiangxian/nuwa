// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-definition-registry, Property 14: clampGenerationParams 幂等、区间内不变与收敛后落区间
//
// 对任意 Generation_Params p（含越界取值），clampGenerationParams(clampGenerationParams(p))
// 等于 clampGenerationParams(p)（幂等），且其结果满足 temperature ∈ [0,2]、topP ∈ [0,1]、
// maxTokens 为 ≥1 整数（收敛后落区间）；进一步，对任意全部数值字段已在合法区间内的 p，
// clampGenerationParams(p) 等于 p（区间内不变）。
//
// Validates: Requirements 14.2, 14.3, 14.4

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { clampGenerationParams } from './normalize';
import { arbitraryGenerationParams, arbitraryValidGenerationParams } from './arbitraries';

describe('Property 14: clampGenerationParams idempotence, in-range identity, and range convergence', () => {
  it('is idempotent and the result always lands inside the legal range', () => {
    fc.assert(
      fc.property(arbitraryGenerationParams, (p) => {
        const once = clampGenerationParams(p);
        const twice = clampGenerationParams(once);

        // Idempotence (R14.2): a second clamp leaves the result unchanged.
        expect(twice).toEqual(once);

        // Range convergence (R14.4): result is always within the legal bands.
        expect(once.temperature).toBeGreaterThanOrEqual(0);
        expect(once.temperature).toBeLessThanOrEqual(2);
        expect(once.topP).toBeGreaterThanOrEqual(0);
        expect(once.topP).toBeLessThanOrEqual(1);
        expect(Number.isInteger(once.maxTokens)).toBe(true);
        expect(once.maxTokens).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 100 }
    );
  });

  it('is the identity on params whose fields are already in range', () => {
    fc.assert(
      fc.property(arbitraryValidGenerationParams, (p) => {
        // In-range identity (R14.3): legal params are returned unchanged.
        expect(clampGenerationParams(p)).toEqual(p);
      }),
      { numRuns: 100 }
    );
  });
});
