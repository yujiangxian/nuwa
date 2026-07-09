// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-system, Property 1: 添加成功——size 加一且原注册表不变
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

import { addTool, getTool, size } from './registry';
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

describe('Property 1: 添加成功——size 加一且原注册表不变', () => {
  it('addTool succeeds, new registry size+1, getTool returns the tool, original unchanged', () => {
    fc.assert(
      fc.property(
        arbitraryRegistry,
        arbitraryValidToolDefinition,
        (r, body) => {
          const id = freshId(r, body.id);
          const tool = { ...body, id };

          const originalSize = size(r);
          const originalEntries = [...r.tools.entries()];

          const result = addTool(r, tool);

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          // New registry: size+1 and the added tool is retrievable and equal.
          expect(size(result.registry)).toBe(originalSize + 1);
          const fetched = getTool(result.registry, id);
          expect(fetched).toBeDefined();
          expect(toolEquals(fetched!, tool)).toBe(true);

          // Original registry unchanged: size and every entry preserved.
          expect(size(r)).toBe(originalSize);
          expect([...r.tools.entries()]).toEqual(originalEntries);
        },
      ),
      { numRuns: 100 },
    );
  });
});
