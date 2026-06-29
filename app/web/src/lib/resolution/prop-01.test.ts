// Feature: agent-tool-resolution, Property 1: 解析划分完备且不相交
/**
 * Property 1: resolveAgentTools partitions the agent's (de-duplicated) bound
 * Tool_Ids into resolved and unresolved, with the two sets disjoint and their
 * union equal to the set of bound Tool_Ids.
 *
 * **Validates: Requirements 3.2, 3.3**
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';

import { resolveAgentTools } from './resolve';
import { arbitraryToolRegistryAndAgent } from './arbitraries';

describe('Property 1: 解析划分完备且不相交', () => {
  it('resolved 与 unresolved 不相交，且二者之并等于绑定 toolId 集合（去重后）', () => {
    fc.assert(
      fc.property(arbitraryToolRegistryAndAgent, ({ toolRegistry, agent }) => {
        const res = resolveAgentTools(agent, toolRegistry);

        const resolvedIds = res.resolved.map((r) => r.toolId);
        const resolvedSet = new Set(resolvedIds);
        const unresolvedSet = new Set(res.unresolved);

        // Disjoint: no Tool_Id appears in both partitions.
        for (const id of resolvedSet) {
          if (unresolvedSet.has(id)) return false;
        }

        // Union equals the de-duplicated set of bound Tool_Ids.
        const boundSet = new Set(agent.tools.map((b) => b.toolId));
        const union = new Set<string>([...resolvedSet, ...unresolvedSet]);

        if (union.size !== boundSet.size) return false;
        for (const id of boundSet) {
          if (!union.has(id)) return false;
        }

        return true;
      }),
      { numRuns: 100 },
    );
  });
});
