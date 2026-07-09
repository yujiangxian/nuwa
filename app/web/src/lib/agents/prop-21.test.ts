// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-definition-registry, Property 21: 模型绑定解析与节点绑定
/**
 * Property 21 — Model binding resolution & node binding.
 *
 * For any AgentDefinition `a` and any LlmConfig-shaped `nodeConfig`:
 *   - resolveModelBinding(a) faithfully returns a.model.modelId and a.model.params.
 *   - bindAgentToNodeConfig(a, nodeConfig) projects the four agent-derived fields
 *     (modelId/systemPrompt/temperature/maxTokens) onto the LlmConfig.
 *   - the input nodeConfig is never mutated.
 *   - the transform is deterministic (two calls are deep-equal).
 *
 * Validates: Requirements 16.2, 16.4, 16.5, 16.6
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { LlmConfig } from '../workflow/nodeTypes/configTypes';
import { resolveModelBinding, bindAgentToNodeConfig } from './bind';
import { arbitraryAgentDefinition } from './arbitraries';

/** LlmConfig-shaped node config spanning legal & out-of-range numeric values. */
const arbitraryLlmConfig: fc.Arbitrary<LlmConfig> = fc.record({
  kind: fc.constant('llm' as const),
  modelId: fc.string(),
  systemPrompt: fc.string(),
  temperature: fc.double({ min: -1, max: 3, noNaN: false }),
  maxTokens: fc.integer({ min: -5, max: 100000 }),
});

/** Same-value comparison that treats NaN as equal to NaN (Object.is semantics). */
function sameNumber(x: number, y: number): boolean {
  return Object.is(x, y);
}

describe('Property 21: 模型绑定解析与节点绑定', () => {
  it('resolveModelBinding 忠实于源；bindAgentToNodeConfig 投影四字段、不修改输入、确定', () => {
    fc.assert(
      fc.property(arbitraryAgentDefinition, arbitraryLlmConfig, (a, nodeConfig) => {
        // —— resolveModelBinding faithfulness (R16.2) ——
        const resolution = resolveModelBinding(a);
        expect(resolution.modelId).toBe(a.model.modelId);
        // params deep-equal a.model.params, with NaN-aware field comparison.
        expect(sameNumber(resolution.params.temperature, a.model.params.temperature)).toBe(true);
        expect(sameNumber(resolution.params.maxTokens, a.model.params.maxTokens)).toBe(true);
        expect(sameNumber(resolution.params.topP, a.model.params.topP)).toBe(true);

        // Snapshot the input nodeConfig to detect mutation (R16.4).
        const before = { ...nodeConfig };

        const bound = bindAgentToNodeConfig(a, nodeConfig);

        // —— Projected fields equal the agent's corresponding values (R16.5) ——
        expect(bound.modelId).toBe(a.model.modelId);
        expect(bound.systemPrompt).toBe(a.systemPrompt);
        expect(sameNumber(bound.temperature, a.model.params.temperature)).toBe(true);
        expect(sameNumber(bound.maxTokens, a.model.params.maxTokens)).toBe(true);
        expect(bound.kind).toBe('llm');

        // —— Input nodeConfig is not mutated (R16.4) ——
        expect(nodeConfig).toStrictEqual(before);

        // —— Determinism: two calls produce deep-equal results (R16.6) ——
        const bound2 = bindAgentToNodeConfig(a, nodeConfig);
        expect(bound2).toStrictEqual(bound);
      }),
      { numRuns: 100 }
    );
  });
});
