// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-resolution, Property 6: 悬空引用校验完整报告与确定性
/**
 * Property 6 (Validates: Requirements 4.4):
 * For any agent `a` and tool registry `r`, validateAgentToolRefs reports every
 * dangling reference (its error count equals the unresolved count), two calls
 * return deeply-equal results, and the errors are stably sorted by
 * compareResolutionErrors.
 */

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

import { resolveAgentTools } from './resolve';
import { validateAgentToolRefs, compareResolutionErrors } from './validate';
import { arbitraryToolRegistryAndAgent } from './arbitraries';

describe('Property 6: dangling-reference validation — full report & determinism', () => {
  it('reports all unresolved refs, is deterministic, and is stably sorted', () => {
    fc.assert(
      fc.property(arbitraryToolRegistryAndAgent, ({ toolRegistry, agent }) => {
        const vr = validateAgentToolRefs(agent, toolRegistry);
        const { unresolved } = resolveAgentTools(agent, toolRegistry);

        // Completeness: one error per dangling Tool_Id.
        expect(vr.errors.length).toBe(unresolved.length);

        // Determinism: two calls are deeply equal.
        const vr2 = validateAgentToolRefs(agent, toolRegistry);
        expect(vr2).toEqual(vr);

        // Stable ordering: adjacent errors are in non-decreasing comparator order.
        for (let i = 0; i + 1 < vr.errors.length; i++) {
          expect(
            compareResolutionErrors(vr.errors[i], vr.errors[i + 1]),
          ).toBeLessThanOrEqual(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
