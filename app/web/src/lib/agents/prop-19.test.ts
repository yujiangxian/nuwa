// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-definition-registry, Property 19: 规范字符串往返与规范输出唯一
//
// 对任意 AgentRegistry r，令 j = serializeRegistry(r)：
//   - deserializeRegistry(j) 成功，且 serializeRegistry(其注册表) 逐字符等于 j（字符串不动点）。
//   - 对 r 的任意语义等价变体 r'（条目经 normalizeAgent 后相等，此处由打乱 tags/tools 顺序构造），
//     serializeRegistry(r') 逐字符等于 j（规范输出唯一）。
//
// Validates: Requirements 15.4, 15.5

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { serializeRegistry, deserializeRegistry } from './serialize';
import { listAgents, emptyRegistry, addAgent } from './registry';
import {
  arbitraryRegistry,
  arbitraryReorderedAgent,
} from './arbitraries';
import type { AgentRegistry, AgentDefinition } from './types';

/** Build a registry from a list of id-unique agents via addAgent accumulation. */
function registryFromAgents(agents: readonly AgentDefinition[]): AgentRegistry {
  return agents.reduce<AgentRegistry>((acc, agent) => {
    const result = addAgent(acc, agent);
    return result.ok ? result.registry : acc;
  }, emptyRegistry());
}

describe('Property 19: canonical-string fixed point and canonical-output uniqueness', () => {
  it('serialize is a string fixed point through deserialize, and equivalent variants serialize identically', () => {
    fc.assert(
      fc.property(
        // For each registry, also generate a semantically-equivalent variant by
        // reordering every agent's tags/tools (ids are preserved and unique).
        arbitraryRegistry.chain((r) => {
          const agents = listAgents(r);
          const reorderedArbs = agents.map((a) => arbitraryReorderedAgent(a));
          return fc.tuple(...reorderedArbs).map((reordered) => ({ r, reordered }));
        }),
        ({ r, reordered }) => {
          const j = serializeRegistry(r);

          // String fixed point: deserialize then re-serialize yields the same string.
          const res = deserializeRegistry(j);
          expect(res.ok).toBe(true);
          if (!res.ok) return;
          expect(serializeRegistry(res.registry)).toBe(j);

          // Canonical output uniqueness: a semantically-equivalent variant
          // (same agents with permuted tags/tools) serializes identically.
          const rPrime = registryFromAgents(reordered);
          expect(serializeRegistry(rPrime)).toBe(j);
        }
      ),
      { numRuns: 100 }
    );
  });
});
