// Feature: agent-definition-registry
//
// Normalization module: pure functions that converge an AgentDefinition to its
// unique Canonical_Agent form (numeric clamping, tag/tool dedup + ordering) and
// provide structural / semantic equality. No I/O, no React, no mutable global
// state, no time/random dependency; inputs are never mutated in place.

import type { AgentDefinition, GenerationParams, ToolBinding } from './types';

/**
 * Generation params range convergence (R14.1, algorithm 5).
 *   temperature -> min(2, max(0, t))
 *   topP        -> min(1, max(0, p))
 *   maxTokens   -> Number.isFinite(m) ? max(1, floor(m)) : 1
 *
 * Note: Math.max(0, NaN) yields NaN, so temperature/topP must special-case
 * non-finite inputs by converging to their nearest legal lower bound (0), so
 * that every field of the result is guaranteed to be a legal finite value.
 *
 * Idempotent (R14.2); identity on in-range inputs (R14.3); the result always
 * lands inside the legal range (R14.4).
 */
export function clampGenerationParams(params: GenerationParams): GenerationParams {
  const t = Math.min(2, Math.max(0, params.temperature));
  const p = Math.min(1, Math.max(0, params.topP));
  return {
    // Guard against NaN: collapse non-finite results to the legal lower bound.
    temperature: Number.isFinite(t) ? t : 0,
    maxTokens: Number.isFinite(params.maxTokens) ? Math.max(1, Math.floor(params.maxTokens)) : 1,
    topP: Number.isFinite(p) ? p : 0,
  };
}

/** Default UTF-16 code-unit lexicographic comparator (deterministic total order). */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Normalize an AgentDefinition to its Canonical_Agent form (R13.1, algorithm 6):
 *   1. model.params converged via clampGenerationParams;
 *   2. tags deduplicated and sorted ascending in UTF-16 code-unit order;
 *   3. tools deduplicated by toolId (first occurrence kept) and sorted by toolId.
 * id/name/role/systemPrompt/model.modelId/voice keep their semantic content (R13.6).
 *
 * Idempotent (R13.3); canonical form is a fixed point (R13.5); unique for
 * semantically equivalent inputs (R13.4).
 */
export function normalizeAgent(agent: AgentDefinition): AgentDefinition {
  const params = clampGenerationParams(agent.model.params);

  // Dedup tags then sort ascending by UTF-16 code units.
  const tags = [...new Set(agent.tags)].sort(cmp);

  // Dedup tools by toolId keeping first occurrence, then sort by toolId.
  const seen = new Set<string>();
  const tools: ToolBinding[] = [];
  for (const tool of agent.tools) {
    if (!seen.has(tool.toolId)) {
      seen.add(tool.toolId);
      tools.push(tool);
    }
  }
  tools.sort((x, y) => cmp(x.toolId, y.toolId));

  return {
    ...agent,
    model: { modelId: agent.model.modelId, params },
    tags,
    tools,
  };
}

/**
 * Structural field-by-field equality. tools/tags are compared element-by-element
 * in their current order. model.params are compared with Object.is so that NaN
 * compares equal to NaN.
 */
export function agentEquals(a: AgentDefinition, b: AgentDefinition): boolean {
  if (
    a.id !== b.id ||
    a.name !== b.name ||
    a.role !== b.role ||
    a.systemPrompt !== b.systemPrompt ||
    a.model.modelId !== b.model.modelId
  ) {
    return false;
  }

  // Compare the three numeric params with Object.is to handle NaN correctly.
  if (
    !Object.is(a.model.params.temperature, b.model.params.temperature) ||
    !Object.is(a.model.params.maxTokens, b.model.params.maxTokens) ||
    !Object.is(a.model.params.topP, b.model.params.topP)
  ) {
    return false;
  }

  // voice: both null, or both non-null with equal voiceId.
  if (a.voice === null || b.voice === null) {
    if (a.voice !== b.voice) {
      return false;
    }
  } else if (a.voice.voiceId !== b.voice.voiceId) {
    return false;
  }

  // tools: element-by-element by toolId in current order.
  if (a.tools.length !== b.tools.length) {
    return false;
  }
  for (let i = 0; i < a.tools.length; i++) {
    if (a.tools[i].toolId !== b.tools[i].toolId) {
      return false;
    }
  }

  // tags: element-by-element in current order.
  if (a.tags.length !== b.tags.length) {
    return false;
  }
  for (let i = 0; i < a.tags.length; i++) {
    if (a.tags[i] !== b.tags[i]) {
      return false;
    }
  }

  return true;
}

/**
 * Semantic equality: normalizeAgent(a) and normalizeAgent(b) are agentEquals
 * (ignores tag/tool ordering and numeric-convergence differences) (R2.5, R13.4).
 */
export function agentSemanticEquals(a: AgentDefinition, b: AgentDefinition): boolean {
  return agentEquals(normalizeAgent(a), normalizeAgent(b));
}
