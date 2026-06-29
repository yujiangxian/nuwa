// Feature: agent-tool-system, Property 2: 添加重复 id 失败
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

import { addTool, size } from './registry';
import { ToolErrorCode } from './types';
import { arbitraryRegistry, arbitraryValidToolDefinition } from './arbitraries';

describe('Property 2: 添加重复 id 失败', () => {
  it('addTool with an existing id fails with TOOL_DUPLICATE_ID and leaves r unchanged', () => {
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
          const originalEntries = [...r.tools.entries()];

          const result = addTool(r, tool);

          expect(result.ok).toBe(false);
          if (result.ok) return;

          expect(result.error.code).toBe(ToolErrorCode.TOOL_DUPLICATE_ID);
          expect(result.error.location.toolId).toBe(id);

          // r unchanged.
          expect(size(r)).toBe(originalSize);
          expect([...r.tools.entries()]).toEqual(originalEntries);
        },
      ),
      { numRuns: 100 },
    );
  });
});
