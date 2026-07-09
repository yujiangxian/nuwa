// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-system, Property 3: 移除不存在的工具失败
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

import { removeTool } from './registry';
import { ToolErrorCode } from './types';
import type { ToolRegistry } from './types';
import { arbitraryRegistry } from './arbitraries';

/** Produce an id deterministically absent from the registry by appending '_'. */
function freshId(r: ToolRegistry, seed: string): string {
  let id = seed;
  while (r.tools.has(id)) {
    id += '_';
  }
  return id;
}

describe('Property 3: 移除不存在的工具失败', () => {
  it('removeTool with an absent id fails with TOOL_NOT_FOUND locating that id', () => {
    fc.assert(
      fc.property(arbitraryRegistry, fc.string(), (r, seed) => {
        const id = freshId(r, seed);

        const result = removeTool(r, id);

        expect(result.ok).toBe(false);
        if (result.ok) return;

        expect(result.error.code).toBe(ToolErrorCode.TOOL_NOT_FOUND);
        expect(result.error.location.toolId).toBe(id);
      }),
      { numRuns: 100 },
    );
  });
});
