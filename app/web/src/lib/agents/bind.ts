// Feature: agent-definition-registry
/**
 * Binding module for the agent definition registry.
 *
 * Provides pure, deterministic data transforms that resolve an agent's model
 * reference and project an agent's derived fields onto an `LlmConfig`-shaped
 * value. This module performs no I/O, no execution and never mutates its
 * inputs — it only reads from the supplied `AgentDefinition` / `LlmConfig` and
 * returns fresh values (see design "算法 8", R16).
 *
 * The prior layer's `LlmConfig` is referenced as a type only; it is not
 * re-defined or modified here (R1.2, R16).
 */

import type { AgentDefinition, ModelBindingResolution } from './types';
import type { LlmConfig } from '../workflow/nodeTypes/configTypes'; // type-only reference, not re-defined

/**
 * Resolve an agent's model binding (R16.1): faithfully return the agent's
 * Model_Id and Generation_Params exactly as held on the source agent (R16.2).
 */
export function resolveModelBinding(agent: AgentDefinition): ModelBindingResolution {
  return { modelId: agent.model.modelId, params: agent.model.params };
}

/**
 * Project the agent's derived modelId/systemPrompt/temperature/maxTokens onto
 * the corresponding fields of an `LlmConfig`-shaped value (R16.3, R16.5).
 *
 * This is a pure data transform: it spreads `nodeConfig` into a fresh object
 * and overwrites the four agent-derived fields, never mutating the input
 * `nodeConfig` (R16.4) and yielding the same result for the same inputs
 * (R16.6). No normalize/clamp is applied — the agent's original numeric values
 * are copied faithfully so that binding is field-for-field equal to the source.
 */
export function bindAgentToNodeConfig(agent: AgentDefinition, nodeConfig: LlmConfig): LlmConfig {
  return {
    ...nodeConfig,
    kind: 'llm',
    modelId: agent.model.modelId,
    systemPrompt: agent.systemPrompt,
    temperature: agent.model.params.temperature,
    maxTokens: agent.model.params.maxTokens,
  };
}
