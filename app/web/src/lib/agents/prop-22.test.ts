// Feature: agent-definition-registry, Property 22: 绑定结果满足 Llm_Config 数值约束
/**
 * Property 22 — Bound result satisfies LlmConfig numeric constraints.
 *
 * For any AgentDefinition `a` that has passed validateAgent (generated via
 * arbitraryValidAgentDefinition) and any LlmConfig-shaped `nodeConfig`:
 *   - bindAgentToNodeConfig(a, nodeConfig).temperature ∈ [0, 2]
 *   - bindAgentToNodeConfig(a, nodeConfig).maxTokens is an integer ≥ 1
 *
 * Validates: Requirements 16.7
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { LlmConfig } from '../workflow/nodeTypes/configTypes';
import { bindAgentToNodeConfig } from './bind';
import { arbitraryValidAgentDefinition } from './arbitraries';

/** LlmConfig-shaped node config spanning legal & out-of-range numeric values. */
const arbitraryLlmConfig: fc.Arbitrary<LlmConfig> = fc.record({
  kind: fc.constant('llm' as const),
  modelId: fc.string(),
  systemPrompt: fc.string(),
  temperature: fc.double({ min: -1, max: 3, noNaN: false }),
  maxTokens: fc.integer({ min: -5, max: 100000 }),
});

describe('Property 22: 绑定结果满足 Llm_Config 数值约束', () => {
  it('对已通过校验的 agent，绑定结果 temperature∈[0,2] 且 maxTokens 为 ≥1 整数', () => {
    fc.assert(
      fc.property(arbitraryValidAgentDefinition, arbitraryLlmConfig, (a, nodeConfig) => {
        const bound = bindAgentToNodeConfig(a, nodeConfig);

        // temperature within the legal closed interval [0, 2] (R16.7).
        expect(bound.temperature).toBeGreaterThanOrEqual(0);
        expect(bound.temperature).toBeLessThanOrEqual(2);

        // maxTokens is an integer ≥ 1 (R16.7).
        expect(Number.isInteger(bound.maxTokens)).toBe(true);
        expect(bound.maxTokens).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 100 }
    );
  });
});
