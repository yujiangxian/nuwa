// Feature: agent-tool-system, Property 14: normalizeTool 幂等与不动点
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

import { normalizeTool, toolEquals } from './normalize';
import { arbitraryToolDefinition } from './arbitraries';

/**
 * Validates: Requirements 12.3, 12.5
 *
 * For any ToolDefinition t, normalizing the already-normalized form yields a
 * value toolEquals to it: normalizeTool is idempotent and its canonical output
 * is a fixed point.
 */
describe('Property 14: normalizeTool 幂等与不动点', () => {
  it('normalizeTool(normalizeTool(t)) toolEquals normalizeTool(t)', () => {
    fc.assert(
      fc.property(arbitraryToolDefinition, (t) => {
        const once = normalizeTool(t);
        const twice = normalizeTool(once);
        expect(toolEquals(twice, once)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
