// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-system, Property 10: validateTool 完整报告、确定与稳定排序
/**
 * Property 10: complete reporting, determinism and stable ordering.
 *
 * For a ToolDefinition with k >= 2 independent injected violations (empty id +
 * empty name + empty tag), validateTool reports each corresponding code
 * (no short-circuit); two calls are deeply equal; and permuting the written
 * order of parameters/tags leaves the error sequence identical under the
 * sort key (code + location).
 *
 * Validates: Requirements 9.8, 9.9
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { validateTool } from './validate';
import { ToolErrorCode } from './types';
import type { ToolDefinition, ToolError } from './types';
import { arbitraryValidToolDefinition } from './arbitraries';

/** A stable string key combining the error code and its location fields. */
function errorKey(e: ToolError): string {
  const loc = e.location;
  return [
    e.code,
    loc.toolId ?? '',
    loc.field ?? '',
    loc.paramName ?? '',
    loc.tag ?? '',
  ].join('|');
}

describe('Property 10: complete reporting, determinism and stable ordering', () => {
  it('reports every violation, is deterministic, and is permutation-stable', () => {
    fc.assert(
      fc.property(arbitraryValidToolDefinition, (base) => {
        // Inject three independent violations: empty id, empty name, empty tag.
        const tool: ToolDefinition = {
          ...base,
          id: '',
          name: '',
          tags: ['', ...base.tags],
        };

        const result = validateTool(tool);
        const codes = new Set(result.errors.map((e) => e.code));

        // Complete reporting: each injected violation's code is present.
        expect(codes.has(ToolErrorCode.TOOL_EMPTY_ID)).toBe(true);
        expect(codes.has(ToolErrorCode.TOOL_EMPTY_NAME)).toBe(true);
        expect(codes.has(ToolErrorCode.TOOL_EMPTY_TAG)).toBe(true);

        // Determinism: two calls are deeply equal.
        expect(validateTool(tool)).toEqual(result);

        // Permutation stability: shuffling the write order of parameters/tags
        // yields the same error sequence under the sort key.
        const permuted: ToolDefinition = {
          ...tool,
          tags: [...tool.tags].reverse(),
          parameters: [...tool.parameters].reverse(),
        };
        const baseKeys = validateTool(tool).errors.map(errorKey);
        const permutedKeys = validateTool(permuted).errors.map(errorKey);
        expect(permutedKeys).toEqual(baseKeys);

        return true;
      }),
      { numRuns: 100 },
    );
  });
});
