// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-definition-registry, Property 3: 移除不存在的智能体失败
//
// 对任意 AgentRegistry r 与不存在于 r 的 Agent_Id id，removeAgent(r, id) 返回失败
// 结果，其 AgentError 的 code 为 AGENT_NOT_FOUND 且定位该 Agent_Id。
//
// Validates: Requirements 7.3

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { removeAgent } from './registry';
import { arbitraryRegistry } from './arbitraries';
import { AgentErrorCode } from './types';
import type { AgentRegistry } from './types';

/** Produce an id guaranteed not to be present in the registry (deterministic, terminates). */
function freshId(registry: AgentRegistry, seed: string): string {
  let id = seed;
  while (registry.agents.has(id)) {
    id = `${id}_`;
  }
  return id;
}

describe('Property 3: removeAgent on a missing id fails with AGENT_NOT_FOUND', () => {
  it('removing an absent id fails and locates that id', () => {
    fc.assert(
      fc.property(arbitraryRegistry, fc.string(), (r, seed) => {
        const id = freshId(r, seed);

        const result = removeAgent(r, id);

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe(AgentErrorCode.AGENT_NOT_FOUND);
        expect(result.error.location.agentId).toBe(id);
      }),
      { numRuns: 100 }
    );
  });
});
