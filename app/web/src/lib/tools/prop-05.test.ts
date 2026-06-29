// Feature: agent-tool-system, Property 5: 更新保持 id 与键集合
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

import { updateTool, getTool, size } from './registry';
import { toolEquals } from './normalize';
import { arbitraryRegistry, arbitraryValidToolDefinition } from './arbitraries';

describe('Property 5: 更新保持 id 与键集合', () => {
  it('updateTool succeeds, replaces at id, leaves others and key set unchanged', () => {
    fc.assert(
      fc.property(
        arbitraryRegistry
          .filter((r) => r.tools.size > 0)
          .chain((r) =>
            fc.record({
              r: fc.constant(r),
              idx: fc.nat({ max: r.tools.size - 1 }),
              body: arbitraryValidToolDefinition,
            }),
          ),
        ({ r, idx, body }) => {
          const id = [...r.tools.keys()][idx];
          const tool = { ...body, id };

          const originalSize = size(r);
          const originalKeys = [...r.tools.keys()].sort();

          const result = updateTool(r, tool);

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          const next = result.registry;

          // The updated entry equals the replacement, id preserved.
          const updated = getTool(next, id);
          expect(updated).toBeDefined();
          expect(updated!.id).toBe(id);
          expect(toolEquals(updated!, tool)).toBe(true);

          // Key set and size unchanged.
          expect(size(next)).toBe(originalSize);
          expect([...next.tools.keys()].sort()).toEqual(originalKeys);

          // All other entries unchanged.
          for (const [key, original] of r.tools) {
            if (key === id) continue;
            const other = next.tools.get(key);
            expect(other).toBeDefined();
            expect(toolEquals(other!, original)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
