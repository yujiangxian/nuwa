// Feature: agent-tool-resolution, Property 14: 能力索引确定性与不变性
/**
 * Property 14: Two calls to buildCapabilityIndex on the same inputs return
 * equal indices, and the call does not mutate its agentRegistry or toolRegistry
 * inputs (compared by serialization before and after).
 *
 * **Validates: Requirements 8.5, 1.4**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { buildCapabilityIndex } from './capability';
import { arbitraryAgentRegistry, arbitraryToolRegistry } from './arbitraries';
import type { CapabilityIndex } from './types';

/** Normalize a CapabilityIndex into a comparable, order-independent structure. */
function normalize(idx: CapabilityIndex): [string, string[]][] {
  return [...idx]
    .map(([k, v]) => [k, [...v].sort()] as [string, string[]])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

describe('Property 14: 能力索引确定性与不变性', () => {
  it('两次构建索引相等，且调用不改变输入', () => {
    fc.assert(
      fc.property(
        fc.tuple(arbitraryAgentRegistry, arbitraryToolRegistry),
        ([agentRegistry, toolRegistry]) => {
          const arBefore = JSON.stringify(agentRegistry);
          const trBefore = JSON.stringify(toolRegistry);

          const first = buildCapabilityIndex(agentRegistry, toolRegistry);
          const second = buildCapabilityIndex(agentRegistry, toolRegistry);

          // Deterministic: both indices are deeply equal once normalized.
          expect(normalize(first)).toEqual(normalize(second));

          // Immutable: inputs are unchanged by the calls.
          expect(JSON.stringify(agentRegistry)).toEqual(arBefore);
          expect(JSON.stringify(toolRegistry)).toEqual(trBefore);
        },
      ),
      { numRuns: 100 },
    );
  });
});
