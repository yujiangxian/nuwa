// Feature: agent-definition-registry, Property 6: 更新不存在的智能体失败
//
// 对任意 AgentRegistry r 与 Agent_Id 不在 r 中的 AgentDefinition a，updateAgent(r, a)
// 返回失败结果，其 AgentError 的 code 为 AGENT_NOT_FOUND 且定位该 Agent_Id。
//
// Validates: Requirements 8.3

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { updateAgent } from './registry';
import { arbitraryRegistry, arbitraryValidAgentDefinition } from './arbitraries';
import { AgentErrorCode } from './types';
import type { AgentRegistry, AgentDefinition } from './types';

/** Produce an id guaranteed not to be present in the registry (deterministic, terminates). */
function freshId(registry: AgentRegistry, seed: string): string {
  let id = seed;
  while (registry.agents.has(id)) {
    id = `${id}_`;
  }
  return id;
}

describe('Property 6: updateAgent on a missing id fails with AGENT_NOT_FOUND', () => {
  it('updating an agent whose id is absent fails and locates that id', () => {
    fc.assert(
      fc.property(
        arbitraryRegistry,
        arbitraryValidAgentDefinition,
        (r, body) => {
          const a: AgentDefinition = { ...body, id: freshId(r, body.id) };

          const result = updateAgent(r, a);

          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.error.code).toBe(AgentErrorCode.AGENT_NOT_FOUND);
          expect(result.error.location.agentId).toBe(a.id);
        }
      ),
      { numRuns: 100 }
    );
  });
});
