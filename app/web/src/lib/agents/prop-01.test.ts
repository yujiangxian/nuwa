// Feature: agent-definition-registry, Property 1: 添加成功——size 加一且原注册表不变
//
// 对任意 AgentRegistry r 与 Agent_Id 不在 r 中的 AgentDefinition a，addAgent(r, a)
// 返回成功结果，其新注册表满足 size === size(r) + 1 且 getAgent(新表, a.id) 等于 a；
// 同时输入 r 在调用后 size 与全部条目保持不变（不可变写）。
//
// Validates: Requirements 6.2, 6.5, 5.5, 1.4

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { addAgent, getAgent, size } from './registry';
import { agentEquals } from './normalize';
import { arbitraryRegistry, arbitraryValidAgentDefinition } from './arbitraries';
import type { AgentRegistry, AgentDefinition } from './types';

/** Produce an id guaranteed not to be present in the registry (deterministic, terminates). */
function freshId(registry: AgentRegistry, seed: string): string {
  let id = seed;
  while (registry.agents.has(id)) {
    id = `${id}_`;
  }
  return id;
}

describe('Property 1: addAgent success increments size and leaves the input registry unchanged', () => {
  it('adds a non-conflicting agent: ok, size+1, getAgent matches, original registry intact', () => {
    fc.assert(
      fc.property(
        arbitraryRegistry,
        arbitraryValidAgentDefinition,
        (r, body) => {
          // Force the agent's id to be absent from r (robust against collisions).
          const a: AgentDefinition = { ...body, id: freshId(r, body.id) };

          // Snapshot the original registry to assert immutability after the call.
          const sizeBefore = size(r);
          const entriesBefore = [...r.agents.entries()];

          const result = addAgent(r, a);

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          // New registry: size + 1, and the added agent is retrievable and equal.
          expect(size(result.registry)).toBe(sizeBefore + 1);
          const fetched = getAgent(result.registry, a.id);
          expect(fetched).toBeDefined();
          expect(fetched !== undefined && agentEquals(fetched, a)).toBe(true);

          // Original registry unchanged: same size and same entries.
          expect(size(r)).toBe(sizeBefore);
          const entriesAfter = [...r.agents.entries()];
          expect(entriesAfter.length).toBe(entriesBefore.length);
          for (let i = 0; i < entriesBefore.length; i++) {
            expect(entriesAfter[i][0]).toBe(entriesBefore[i][0]);
            expect(agentEquals(entriesAfter[i][1], entriesBefore[i][1])).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
