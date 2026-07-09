// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-resolution, Property 2: 解析忠实于注册表
/**
 * Property 2: every ResolvedToolBinding carries the ToolDefinition returned by
 * getTool for its toolId (compared with toolEquals), and every unresolved
 * toolId is genuinely absent from the registry (getTool returns undefined).
 *
 * **Validates: Requirements 3.4**
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';

import { resolveAgentTools } from './resolve';
import { getTool } from '../tools/registry';
import { toolEquals } from '../tools/normalize';
import { arbitraryToolRegistryAndAgent } from './arbitraries';

describe('Property 2: 解析忠实于注册表', () => {
  it('resolved 的工具等于 getTool 返回；unresolved 的 toolId 在注册表中不存在', () => {
    fc.assert(
      fc.property(arbitraryToolRegistryAndAgent, ({ toolRegistry, agent }) => {
        const res = resolveAgentTools(agent, toolRegistry);

        for (const rb of res.resolved) {
          const found = getTool(toolRegistry, rb.toolId);
          if (found === undefined) return false;
          if (!toolEquals(rb.tool, found)) return false;
        }

        for (const toolId of res.unresolved) {
          if (getTool(toolRegistry, toolId) !== undefined) return false;
        }

        return true;
      }),
      { numRuns: 100 },
    );
  });
});
