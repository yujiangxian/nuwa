// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-resolution, Property 5: 悬空引用校验对应 unresolved
/**
 * Property 5: validateAgentToolRefs emits exactly one RESOLUTION_TOOL_NOT_FOUND
 * per unresolved toolId (located at the agent and that toolId), and valid is
 * true iff there are no unresolved references.
 *
 * **Validates: Requirements 4.2, 4.3, 4.5**
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';

import { resolveAgentTools } from './resolve';
import { validateAgentToolRefs } from './validate';
import { ResolutionErrorCode } from './types';
import { arbitraryToolRegistryAndAgent } from './arbitraries';

describe('Property 5: 悬空引用校验对应 unresolved', () => {
  it('每条错误为 RESOLUTION_TOOL_NOT_FOUND，定位 toolId 集合等于 unresolved，valid ⇔ 无悬空', () => {
    fc.assert(
      fc.property(arbitraryToolRegistryAndAgent, ({ toolRegistry, agent }) => {
        const res = resolveAgentTools(agent, toolRegistry);
        const vr = validateAgentToolRefs(agent, toolRegistry);

        // Every error is RESOLUTION_TOOL_NOT_FOUND located at this agent.
        for (const err of vr.errors) {
          if (err.code !== ResolutionErrorCode.RESOLUTION_TOOL_NOT_FOUND) return false;
          if (err.location.agentId !== agent.id) return false;
        }

        // The located toolIds equal the set of unresolved toolIds.
        const locatedSet = new Set(vr.errors.map((e) => e.location.toolId));
        const unresolvedSet = new Set(res.unresolved);
        if (locatedSet.size !== unresolvedSet.size) return false;
        for (const id of unresolvedSet) {
          if (!locatedSet.has(id)) return false;
        }

        // valid iff there are no unresolved references.
        if (vr.valid !== (res.unresolved.length === 0)) return false;

        return true;
      }),
      { numRuns: 100 },
    );
  });
});
