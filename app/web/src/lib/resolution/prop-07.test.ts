// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-resolution, Property 7: 注册表一致性聚合
/**
 * Property 7 (Validates: Requirements 5.2, 5.3, 5.4):
 * For any agent registry `ar` and tool registry `r`, the errors of
 * validateRegistriesConsistency(ar, r) equal the union (in stable order) of the
 * validateAgentToolRefs errors of every agent in listAgents(ar), and `valid` is
 * true iff no agent has any dangling reference.
 */

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

import {
  validateAgentToolRefs,
  validateRegistriesConsistency,
  compareResolutionErrors,
} from './validate';
import type { ResolutionError } from './types';
import { listAgents } from '../agents/registry';
import { arbitraryAgentRegistry, arbitraryToolRegistry } from './arbitraries';

describe('Property 7: registry consistency aggregation', () => {
  it('aggregates per-agent dangling-reference errors in stable order', () => {
    fc.assert(
      fc.property(
        fc.tuple(arbitraryAgentRegistry, arbitraryToolRegistry),
        ([agentRegistry, toolRegistry]) => {
          const cr = validateRegistriesConsistency(agentRegistry, toolRegistry);

          // Expected: union of every agent's validateAgentToolRefs errors,
          // collected in listAgents order, then stably sorted.
          const expected: ResolutionError[] = [];
          for (const agent of listAgents(agentRegistry)) {
            expected.push(...validateAgentToolRefs(agent, toolRegistry).errors);
          }
          expected.sort(compareResolutionErrors);

          expect(cr.errors).toEqual(expected);
          expect(cr.valid).toBe(expected.length === 0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
