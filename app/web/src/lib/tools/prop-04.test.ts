// Feature: agent-tool-system, Property 4: 添加/移除往返恒等
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

import { addTool, removeTool } from './registry';
import { toolEquals } from './normalize';
import type { ToolRegistry } from './types';
import { arbitraryRegistry, arbitraryValidToolDefinition } from './arbitraries';

/** Produce an id deterministically absent from the registry by appending '_'. */
function freshId(r: ToolRegistry, seed: string): string {
  let id = seed;
  while (r.tools.has(id)) {
    id += '_';
  }
  return id;
}

describe('Property 4: 添加/移除往返恒等', () => {
  it('addTool then removeTool restores a registry semantically equal to r', () => {
    fc.assert(
      fc.property(
        arbitraryRegistry,
        arbitraryValidToolDefinition,
        (r, body) => {
          const id = freshId(r, body.id);
          const tool = { ...body, id };

          const added = addTool(r, tool);
          expect(added.ok).toBe(true);
          if (!added.ok) return;

          const removed = removeTool(added.registry, id);
          expect(removed.ok).toBe(true);
          if (!removed.ok) return;

          // Semantic equality: same key set and each definition toolEquals.
          const result = removed.registry;
          expect([...result.tools.keys()].sort()).toEqual(
            [...r.tools.keys()].sort(),
          );
          for (const [key, original] of r.tools) {
            const round = result.tools.get(key);
            expect(round).toBeDefined();
            expect(toolEquals(round!, original)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
