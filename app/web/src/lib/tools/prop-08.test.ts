// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-system, Property 8: 列举顺序、长度与确定性
/**
 * Property 8: listing order, length and determinism.
 *
 * For any ToolRegistry r, listTools(r) yields a Tool_Id sequence in
 * non-descending lexicographic order with pairwise-distinct ids, whose length
 * equals size(r); two calls are element-wise equal (toolEquals).
 *
 * Validates: Requirements 8.2, 8.4, 8.5
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { listTools, size } from './registry';
import { toolEquals } from './normalize';
import { arbitraryRegistry } from './arbitraries';

describe('Property 8: listing order, length and determinism', () => {
  it('lists ids strictly ascending, with correct length, and deterministically', () => {
    fc.assert(
      fc.property(arbitraryRegistry, (r) => {
        const first = listTools(r);
        const second = listTools(r);

        // Length equals size(r).
        expect(first.length).toBe(size(r));

        // Tool_Id sequence is strictly ascending: pairwise distinct and
        // non-descending in UTF-16 lexicographic order.
        for (let i = 1; i < first.length; i++) {
          const prev = first[i - 1].id;
          const curr = first[i].id;
          expect(prev < curr).toBe(true);
        }

        // Two calls are element-wise equal.
        expect(second.length).toBe(first.length);
        for (let i = 0; i < first.length; i++) {
          expect(toolEquals(first[i], second[i])).toBe(true);
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });
});
