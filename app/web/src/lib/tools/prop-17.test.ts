// Feature: agent-tool-system, Property 17: 规范字符串往返与规范输出唯一
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

import { serializeRegistry, deserializeRegistry } from './serialize';
import { listTools, emptyRegistry, addTool } from './registry';
import type { ToolRegistry, ToolDefinition } from './types';
import { arbitraryRegistry, arbitraryReorderedTool } from './arbitraries';

/** Accumulate tools into a fresh registry via addTool (ids are unique). */
function registryFromTools(tools: readonly ToolDefinition[]): ToolRegistry {
  return tools.reduce<ToolRegistry>((reg, tool) => {
    const result = addTool(reg, tool);
    return result.ok ? result.registry : reg;
  }, emptyRegistry());
}

/**
 * Validates: Requirements 13.4, 13.5
 *
 * Let j = serializeRegistry(r). Then deserializeRegistry(j) succeeds and
 * re-serializing its registry yields exactly j (canonical round-trip). Also,
 * any semantically-equivalent variant r' (each tool reordered) serializes to
 * the byte-identical string j (canonical output uniqueness).
 */
describe('Property 17: 规范字符串往返与规范输出唯一', () => {
  it('canonical string round-trips and is unique across semantic variants', () => {
    fc.assert(
      fc.property(
        arbitraryRegistry.chain((r) => {
          const tools = listTools(r);
          const reorderedArbs = tools.map((t) => arbitraryReorderedTool(t));
          const variant =
            reorderedArbs.length === 0
              ? fc.constant<ToolDefinition[]>([])
              : fc.tuple(...reorderedArbs);
          return fc.tuple(fc.constant(r), variant);
        }),
        ([r, reorderedTools]) => {
          const j = serializeRegistry(r);

          // Canonical round-trip: deserialize then re-serialize is identical.
          const result = deserializeRegistry(j);
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(serializeRegistry(result.registry)).toBe(j);

          // Canonical uniqueness: a reordered variant serializes identically.
          const rPrime = registryFromTools(reorderedTools);
          expect(serializeRegistry(rPrime)).toBe(j);
        },
      ),
      { numRuns: 100 },
    );
  });
});
