// Feature: agent-tool-system, Property 16: 序列化往返恒等
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

import { serializeRegistry, deserializeRegistry } from './serialize';
import { normalizeTool, toolEquals } from './normalize';
import { listTools } from './registry';
import { arbitraryRegistry } from './arbitraries';

/**
 * Validates: Requirements 13.3, 13.7
 *
 * For any ToolRegistry r, deserializeRegistry(serializeRegistry(r)) succeeds and
 * its registry is semantically equal to "r with normalizeTool applied to every
 * definition": same key set and element-wise toolEquals in listing order.
 */
describe('Property 16: 序列化往返恒等', () => {
  it('round-trips a registry to its normalized form', () => {
    fc.assert(
      fc.property(arbitraryRegistry, (r) => {
        const result = deserializeRegistry(serializeRegistry(r));
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const expected = listTools(r).map(normalizeTool);
        const actual = listTools(result.registry);

        // Same number of tools and same (sorted) key set.
        expect(actual.length).toBe(expected.length);
        expect(actual.map((t) => t.id)).toEqual(expected.map((t) => t.id));

        // Element-wise semantic equality.
        for (let i = 0; i < expected.length; i++) {
          expect(toolEquals(actual[i], expected[i])).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
