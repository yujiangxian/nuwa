// Feature: agent-definition-registry, Property 4: 添加/移除往返恒等
//
// 对任意 AgentRegistry r 与 Agent_Id 不在 r 中的 AgentDefinition a，先 addAgent(r, a)
// 成功得到 r'，再 removeAgent(r', a.id) 成功，且其结果注册表与 r 语义相等（键集合相同
// 且对应 AgentDefinition 逐个 agentEquals）。
//
// Validates: Requirements 7.4, 7.5

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { addAgent, removeAgent } from './registry';
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

describe('Property 4: add then remove round-trips to a semantically equal registry', () => {
  it('addAgent then removeAgent restores the original key set and entries', () => {
    fc.assert(
      fc.property(
        arbitraryRegistry,
        arbitraryValidAgentDefinition,
        (r, body) => {
          const a: AgentDefinition = { ...body, id: freshId(r, body.id) };

          const added = addAgent(r, a);
          expect(added.ok).toBe(true);
          if (!added.ok) return;

          const removed = removeAgent(added.registry, a.id);
          expect(removed.ok).toBe(true);
          if (!removed.ok) return;

          // Key sets are equal.
          const keysOriginal = [...r.agents.keys()].sort();
          const keysRoundTrip = [...removed.registry.agents.keys()].sort();
          expect(keysRoundTrip).toEqual(keysOriginal);

          // Each entry is agentEquals to the original.
          for (const key of keysOriginal) {
            const original = r.agents.get(key);
            const roundTrip = removed.registry.agents.get(key);
            expect(original).toBeDefined();
            expect(roundTrip).toBeDefined();
            expect(
              original !== undefined &&
                roundTrip !== undefined &&
                agentEquals(original, roundTrip)
            ).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
