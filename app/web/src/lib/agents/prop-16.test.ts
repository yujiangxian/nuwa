// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-definition-registry, Property 16: normalizeAgent 语义等价唯一且保持关键字段
//
// 对任意 AgentDefinition base 与其语义等价重排版本 a'（仅 tags/tools 顺序不同），
// normalizeAgent(base) 与 normalizeAgent(a') 经 agentEquals 相等（规范形式唯一）；
// 且 normalizeAgent(base) 的 id/name/role/systemPrompt/model.modelId 等于 base 对应值、
// voice 语义相等（规范化保持关键字段）。
//
// Validates: Requirements 13.4, 13.6

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { normalizeAgent, agentEquals } from './normalize';
import { arbitraryAgentDefinition, arbitraryReorderedAgent } from './arbitraries';

describe('Property 16: normalizeAgent canonical uniqueness and key-field preservation', () => {
  it('maps semantically equivalent (reordered) agents to an agentEquals canonical form and preserves key fields', () => {
    fc.assert(
      fc.property(
        arbitraryAgentDefinition.chain((base) =>
          fc.tuple(fc.constant(base), arbitraryReorderedAgent(base))
        ),
        ([base, reordered]) => {
          const canonicalBase = normalizeAgent(base);
          const canonicalReordered = normalizeAgent(reordered);

          // Canonical uniqueness (R13.4): reordering tags/tools does not change
          // the canonical form.
          expect(agentEquals(canonicalBase, canonicalReordered)).toBe(true);

          // Key-field preservation (R13.6): id/name/role/systemPrompt/modelId
          // keep their semantic content through normalization.
          expect(canonicalBase.id).toBe(base.id);
          expect(canonicalBase.name).toBe(base.name);
          expect(canonicalBase.role).toBe(base.role);
          expect(canonicalBase.systemPrompt).toBe(base.systemPrompt);
          expect(canonicalBase.model.modelId).toBe(base.model.modelId);

          // voice is preserved semantically (both null, or equal voiceId).
          if (base.voice === null) {
            expect(canonicalBase.voice).toBeNull();
          } else {
            expect(canonicalBase.voice).not.toBeNull();
            expect(canonicalBase.voice?.voiceId).toBe(base.voice.voiceId);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
