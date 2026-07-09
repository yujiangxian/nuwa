// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-resolution, Property 11: 工具节点校验完整报告、确定与稳定排序
/**
 * Property 11 (Validates: Requirements 6.7):
 * For any ToolConfig `c` whose toolName exists in `r`,
 * resolveToolNodeArguments(c, r) returns deeply-equal results across two calls,
 * and its errors are stably sorted by compareResolutionErrors.
 */

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

import type { ToolDefinition, ToolRegistry } from '../tools/types';
import { resolveToolNodeArguments, compareResolutionErrors } from './validate';
import { arbitraryValidToolDefinition, arbitraryToolConfigFor } from './arbitraries';

// A tool in a single-tool registry paired with an arbitrary ToolConfig for it
// (spanning missing / unknown / type-mismatch / duplicate / aligned cases).
const arbitraryToolAndConfig = arbitraryValidToolDefinition.chain((tool: ToolDefinition) =>
  arbitraryToolConfigFor(tool).map((toolConfig) => {
    const registry: ToolRegistry = { tools: new Map([[tool.id, tool]]) };
    return { registry, toolConfig };
  }),
);

describe('Property 11: tool node — full report, determinism & stable ordering', () => {
  it('is deterministic across two calls and stably sorted', () => {
    fc.assert(
      fc.property(arbitraryToolAndConfig, ({ registry, toolConfig }) => {
        const r1 = resolveToolNodeArguments(toolConfig, registry);
        const r2 = resolveToolNodeArguments(toolConfig, registry);

        // Determinism: two calls are deeply equal.
        expect(r2).toEqual(r1);

        // Stable ordering: adjacent errors are in non-decreasing comparator order.
        for (let i = 0; i + 1 < r1.errors.length; i++) {
          expect(
            compareResolutionErrors(r1.errors[i], r1.errors[i + 1]),
          ).toBeLessThanOrEqual(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
