// Feature: agent-definition-registry, Property 15: normalizeAgent 幂等与不动点
//
// 对任意 AgentDefinition a，normalizeAgent(normalizeAgent(a)) 与 normalizeAgent(a)
// 经 agentEquals 相等（幂等）；由于 normalizeAgent(a) 已是规范形式（Canonical_Agent），
// 再施加 normalizeAgent 不变，故同一断言也覆盖了"规范形式为规范化的不动点"。
//
// Validates: Requirements 13.3, 13.5

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { normalizeAgent, agentEquals } from './normalize';
import { arbitraryAgentDefinition } from './arbitraries';

describe('Property 15: normalizeAgent idempotence and canonical fixed point', () => {
  it('normalizing the canonical form again yields an agentEquals result', () => {
    fc.assert(
      fc.property(arbitraryAgentDefinition, (a) => {
        const once = normalizeAgent(a);
        const twice = normalizeAgent(once);

        // Idempotence (R13.3) and canonical fixed point (R13.5): once is already
        // in canonical form, so re-normalizing leaves it agentEquals-unchanged.
        expect(agentEquals(twice, once)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});
