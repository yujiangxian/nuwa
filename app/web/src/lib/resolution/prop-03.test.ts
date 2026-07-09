// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-resolution, Property 3: 解析稳定排序与去重
/**
 * Property 3: the resolved toolId sequence is strictly ascending (sorted and
 * de-duplicated), the unresolved sequence is strictly ascending, and the
 * result's agentId equals the input agent's id.
 *
 * **Validates: Requirements 3.5, 9.2**
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';

import { resolveAgentTools } from './resolve';
import { arbitraryToolRegistryAndAgent } from './arbitraries';

describe('Property 3: 解析稳定排序与去重', () => {
  it('resolved/unresolved 的 toolId 严格升序，agentId 等于 agent.id', () => {
    fc.assert(
      fc.property(arbitraryToolRegistryAndAgent, ({ toolRegistry, agent }) => {
        const res = resolveAgentTools(agent, toolRegistry);

        const resolvedIds = res.resolved.map((r) => r.toolId);
        for (let i = 1; i < resolvedIds.length; i++) {
          if (!(resolvedIds[i - 1] < resolvedIds[i])) return false;
        }

        for (let i = 1; i < res.unresolved.length; i++) {
          if (!(res.unresolved[i - 1] < res.unresolved[i])) return false;
        }

        if (res.agentId !== agent.id) return false;

        return true;
      }),
      { numRuns: 100 },
    );
  });
});
