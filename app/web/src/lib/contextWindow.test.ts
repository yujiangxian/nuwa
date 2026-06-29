import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { DEFAULT_CONTEXT_LENGTH, resolveContextLength } from '@/lib/contextWindow';

const NUM_RUNS = 200;

describe('contextWindow.resolveContextLength', () => {
  // Feature: context-window-management, Property 3: 上下文长度解析与回退
  // Validates: Requirements 2.1, 2.2, 2.3, 2.4
  it('returns positive integer candidate as-is (not estimated), else falls back to default (estimated)', () => {
    const candidateArb = fc.oneof(
      fc.integer({ min: 1, max: 1_000_000 }), // 正整数
      fc.constantFrom<number | null | undefined>(undefined, null),
      fc.integer({ min: -1000, max: 0 }), // 非正整数
      fc.integer({ min: 1, max: 1000 }).map((n) => n + 0.5), // 正小数
      fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
    );

    fc.assert(
      fc.property(candidateArb, (candidate) => {
        const res = resolveContextLength(candidate as number | null | undefined);
        // 任何情形下 contextLength 恒为正整数
        expect(res.contextLength).toBeGreaterThan(0);

        if (
          typeof candidate === 'number' &&
          Number.isInteger(candidate) &&
          candidate > 0
        ) {
          expect(res.contextLength).toBe(candidate);
          expect(res.isEstimated).toBe(false);
        } else {
          expect(res.contextLength).toBe(DEFAULT_CONTEXT_LENGTH);
          expect(res.isEstimated).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('explicit fallback examples', () => {
    expect(resolveContextLength(undefined)).toEqual({
      contextLength: DEFAULT_CONTEXT_LENGTH,
      isEstimated: true,
    });
    expect(resolveContextLength(8192)).toEqual({
      contextLength: 8192,
      isEstimated: false,
    });
    expect(resolveContextLength(0)).toEqual({
      contextLength: DEFAULT_CONTEXT_LENGTH,
      isEstimated: true,
    });
    expect(resolveContextLength(2.5)).toEqual({
      contextLength: DEFAULT_CONTEXT_LENGTH,
      isEstimated: true,
    });
  });
});
