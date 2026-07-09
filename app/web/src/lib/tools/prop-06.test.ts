// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-system, Property 6: 更新不存在的工具失败
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

import { updateTool } from './registry';
import { ToolErrorCode } from './types';
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

describe('Property 6: 更新不存在的工具失败', () => {
  it('updateTool with an absent id fails with TOOL_NOT_FOUND locating that id', () => {
    fc.assert(
      fc.property(
        arbitraryRegistry,
        arbitraryValidToolDefinition,
        (r, body) => {
          const id = freshId(r, body.id);
          const tool = { ...body, id };

          const result = updateTool(r, tool);

          expect(result.ok).toBe(false);
          if (result.ok) return;

          expect(result.error.code).toBe(ToolErrorCode.TOOL_NOT_FOUND);
          expect(result.error.location.toolId).toBe(id);
        },
      ),
      { numRuns: 100 },
    );
  });
});
