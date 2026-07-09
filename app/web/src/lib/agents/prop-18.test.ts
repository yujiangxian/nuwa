// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-definition-registry, Property 18: 序列化往返恒等
//
// 对任意 AgentRegistry r，deserializeRegistry(serializeRegistry(r)) 返回成功结果，
// 其注册表与"对 r 每个 AgentDefinition 施加 normalizeAgent 后的注册表"语义相等：
// 键集合相同，且对每个键，反序列化结果中的定义 agentEquals normalizeAgent(原定义)。
//
// Validates: Requirements 15.3, 15.7

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { serializeRegistry, deserializeRegistry } from './serialize';
import { normalizeAgent, agentEquals } from './normalize';
import { listAgents } from './registry';
import { arbitraryRegistry } from './arbitraries';

describe('Property 18: serialize/deserialize roundtrip is identity up to normalization', () => {
  it('deserialize(serialize(r)) succeeds and equals the per-agent normalized registry', () => {
    fc.assert(
      fc.property(arbitraryRegistry, (r) => {
        const res = deserializeRegistry(serializeRegistry(r));

        expect(res.ok).toBe(true);
        if (!res.ok) return;

        // Expected: each agent of r normalized, ordered canonically (by id).
        const expected = listAgents(r).map(normalizeAgent);
        const actual = listAgents(res.registry);

        // Same key set (and order, since both are listAgents-ordered by id).
        expect(actual.length).toBe(expected.length);
        const actualIds = actual.map((a) => a.id);
        const expectedIds = expected.map((a) => a.id);
        expect(actualIds).toEqual(expectedIds);

        // For every key, the restored definition equals the normalized original.
        for (let i = 0; i < expected.length; i++) {
          expect(agentEquals(actual[i], expected[i])).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });
});
