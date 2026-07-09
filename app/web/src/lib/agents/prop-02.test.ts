// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-definition-registry, Property 2: 添加重复 id 失败
//
// 对任意非空 AgentRegistry r 与一个 Agent_Id 取自 r 已有键的 AgentDefinition a，
// addAgent(r, a) 返回失败结果，其 AgentError 的 code 为 AGENT_DUPLICATE_ID 且定位该
// Agent_Id，且 r 保持不变。
//
// Validates: Requirements 6.3, 6.4

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { addAgent, size } from './registry';
import { agentEquals } from './normalize';
import { arbitraryRegistry, arbitraryValidAgentDefinition } from './arbitraries';
import { AgentErrorCode } from './types';

describe('Property 2: addAgent with a duplicate id fails and leaves the registry unchanged', () => {
  it('adding an agent whose id is an existing key fails with AGENT_DUPLICATE_ID', () => {
    fc.assert(
      fc.property(
        // Non-empty registry, an index to pick an existing key, and a body.
        arbitraryRegistry
          .filter((r) => r.agents.size > 0)
          .chain((r) => {
            const keys = [...r.agents.keys()];
            return fc.record({
              r: fc.constant(r),
              idx: fc.nat({ max: keys.length - 1 }),
              body: arbitraryValidAgentDefinition,
            });
          }),
        ({ r, idx, body }) => {
          const existingId = [...r.agents.keys()][idx];
          const a = { ...body, id: existingId };

          const sizeBefore = size(r);
          const entriesBefore = [...r.agents.entries()];

          const result = addAgent(r, a);

          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.error.code).toBe(AgentErrorCode.AGENT_DUPLICATE_ID);
          expect(result.error.location.agentId).toBe(existingId);

          // Registry unchanged.
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
