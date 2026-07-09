// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-definition-registry
/**
 * Custom fast-check arbitraries for the agent definition registry test suite.
 *
 * These generators are the shared input space for the layer's property tests.
 * They deliberately produce BOTH legal and out-of-range data (for clamp /
 * normalize / validation properties) as well as guaranteed-valid data (for the
 * "valid base + single-point injection" properties and binding constraints).
 *
 * This module is test-support code only: it contains no production logic, no
 * I/O, no React and no mutable global state — only pure arbitrary definitions
 * built on `fast-check`.
 */

import fc from 'fast-check';
import { SYSTEM_PROMPT_MAX_LENGTH } from './types';
import type {
  AgentDefinition,
  AgentRegistry,
  GenerationParams,
  ToolBinding,
  VoiceBinding,
} from './types';
import { emptyRegistry, addAgent } from './registry';

// —— Generation params ——

/**
 * Generation params spanning legal and out-of-range values.
 *
 * temperature crosses the [0, 2] legal band via [-1, 3]; topP crosses the
 * [0, 1] legal band via [-0.5, 1.5]; maxTokens mixes small integers (incl.
 * negatives and 0), arbitrary doubles (non-integer / Infinity), explicit NaN
 * and 0 — exercising clamp, normalize and validation logic.
 */
export const arbitraryGenerationParams: fc.Arbitrary<GenerationParams> = fc.record({
  temperature: fc.double({ min: -1, max: 3, noNaN: false }),
  topP: fc.double({ min: -0.5, max: 1.5 }),
  maxTokens: fc.oneof(
    fc.integer({ min: -5, max: 5 }),
    fc.double(),
    fc.constant(NaN),
    fc.constant(0)
  ),
});

/**
 * Generation params constrained to the legal space: temperature ∈ [0, 2],
 * topP ∈ [0, 1] (both finite, non-NaN) and maxTokens an integer ≥ 1.
 */
export const arbitraryValidGenerationParams: fc.Arbitrary<GenerationParams> = fc.record({
  temperature: fc.double({ min: 0, max: 2, noNaN: true, noDefaultInfinity: true }),
  topP: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
  maxTokens: fc.integer({ min: 1, max: 100000 }),
});

// —— Tool & voice bindings ——

/** A tool binding carrying a non-empty toolId. */
export const arbitraryToolBinding: fc.Arbitrary<ToolBinding> = fc.record({
  toolId: fc.string({ minLength: 1 }),
});

/** A voice binding carrying a non-empty voiceId. */
export const arbitraryVoiceBinding: fc.Arbitrary<VoiceBinding> = fc.record({
  voiceId: fc.string({ minLength: 1 }),
});

// —— System prompt helpers ——

/**
 * System prompt spanning both sides of the SYSTEM_PROMPT_MAX_LENGTH boundary.
 * The over-length branch is built by padding a short seed to length+1 to keep
 * generation cheap while still exceeding the legal upper bound.
 */
const arbitrarySystemPrompt: fc.Arbitrary<string> = fc.oneof(
  fc.string({ maxLength: 64 }),
  fc
    .string({ minLength: 1, maxLength: 8 })
    .map((s) => s.padEnd(SYSTEM_PROMPT_MAX_LENGTH + 1, 'x'))
);

// —— Agent definitions ——

/**
 * An agent definition exercising the full input space: tags may contain
 * duplicates, empty strings and arbitrary ordering; tools may contain duplicate
 * toolIds and arbitrary ordering; systemPrompt straddles the length bound;
 * voice may be null; id/name may be empty or non-empty; model.params spans the
 * out-of-range generator.
 */
export const arbitraryAgentDefinition: fc.Arbitrary<AgentDefinition> = fc.record({
  id: fc.string(),
  name: fc.string(),
  role: fc.string(),
  systemPrompt: arbitrarySystemPrompt,
  model: fc.record({
    modelId: fc.string(),
    params: arbitraryGenerationParams,
  }),
  tools: fc.array(arbitraryToolBinding),
  voice: fc.oneof(fc.constant(null), arbitraryVoiceBinding),
  tags: fc.array(fc.string()),
});

/**
 * An agent definition guaranteed to pass validateAgent: non-empty id/name,
 * non-empty modelId, legal generation params, unique tool bindings, a
 * within-bound systemPrompt and non-empty tags.
 */
export const arbitraryValidAgentDefinition: fc.Arbitrary<AgentDefinition> = fc.record({
  id: fc.string({ minLength: 1 }),
  name: fc.string({ minLength: 1 }),
  role: fc.string(),
  systemPrompt: fc.string({ maxLength: 200 }),
  model: fc.record({
    modelId: fc.string({ minLength: 1 }),
    params: arbitraryValidGenerationParams,
  }),
  tools: fc.uniqueArray(arbitraryToolBinding, { selector: (t) => t.toolId }),
  voice: fc.oneof(fc.constant(null), arbitraryVoiceBinding),
  tags: fc.array(fc.string({ minLength: 1 })),
});

/**
 * Given a base agent, produce a semantically equivalent reordered variant: the
 * tags and tools arrays are permuted (same multiset, possibly different order)
 * while every other field — including the numeric model params — is preserved
 * exactly. Used for normalize uniqueness (Property 16) and canonical-output
 * uniqueness (Property 19).
 */
export function arbitraryReorderedAgent(
  base: AgentDefinition
): fc.Arbitrary<AgentDefinition> {
  const tagsPerm = fc.shuffledSubarray([...base.tags], {
    minLength: base.tags.length,
    maxLength: base.tags.length,
  });
  const toolsPerm = fc.shuffledSubarray([...base.tools], {
    minLength: base.tools.length,
    maxLength: base.tools.length,
  });
  return fc.record({ tags: tagsPerm, tools: toolsPerm }).map(({ tags, tools }) => ({
    ...base,
    tags,
    tools,
  }));
}

// —— Registries ——

/**
 * A registry built from a set of id-unique valid agents accumulated through
 * addAgent. Since the agents are id-unique, every addAgent succeeds; any
 * (unexpected) failure result is skipped, preserving the accumulator.
 */
export const arbitraryRegistry: fc.Arbitrary<AgentRegistry> = fc
  .uniqueArray(arbitraryValidAgentDefinition, { selector: (a) => a.id })
  .map((agents) =>
    agents.reduce<AgentRegistry>((acc, agent) => {
      const result = addAgent(acc, agent);
      return result.ok ? result.registry : acc;
    }, emptyRegistry())
  );

/**
 * A registry whose value set contains two entries sharing the same `.id`.
 *
 * A Map cannot hold two identical keys, so we deliberately store the two agents
 * under DIFFERENT placeholder keys while their `.id` fields collide. Iterating
 * `agents.values()` then yields a duplicated id, which validateRegistry must
 * report as AGENT_DUPLICATE_ID (R11.3). This models hand-built / deserialized
 * inconsistency that the key-uniqueness invariant would otherwise hide.
 */
export const arbitraryDuplicateIdRegistryValues: fc.Arbitrary<AgentRegistry> = fc
  .record({
    sharedId: fc.string({ minLength: 1 }),
    a: arbitraryValidAgentDefinition,
    b: arbitraryValidAgentDefinition,
  })
  .map(({ sharedId, a, b }) => {
    const first: AgentDefinition = { ...a, id: sharedId };
    // Make the second entry differ in content (name) while sharing the id.
    const second: AgentDefinition = { ...b, id: sharedId, name: `${b.name}#dup` };
    const agents = new Map<string, AgentDefinition>([
      ['k1', first],
      ['k2', second],
    ]);
    return { agents };
  });

// —— Malformed JSON ——

/**
 * Malformed registry JSON: a mix of non-JSON garbage strings, structurally
 * valid JSON of the wrong shape, and structurally valid registry-like JSON with
 * missing required fields. All must be rejected by deserializeRegistry with
 * AGENT_MALFORMED_JSON (R15.6).
 */
export const arbitraryMalformedRegistryJson: fc.Arbitrary<string> = fc.oneof(
  // Random strings that do not happen to parse as JSON.
  fc.string().filter((s) => {
    try {
      JSON.parse(s);
      return false;
    } catch {
      return true;
    }
  }),
  // Valid JSON but the wrong top-level shape.
  fc.constantFrom(
    '{"agents":1}',
    '{"version":1}',
    '[]',
    'null',
    'true',
    '42',
    '"a string"',
    '{}'
  ),
  // Valid JSON shaped like a registry but with entries missing required fields.
  fc.constantFrom(
    '{"version":1,"agents":[{"id":"a","name":"n","role":"","systemPrompt":""}]}',
    '{"version":1,"agents":[{"id":"a"}]}',
    '{"version":1,"agents":[{"name":"n","role":"","systemPrompt":"","model":{"modelId":"m","params":{"temperature":1,"maxTokens":1,"topP":1}},"tools":[],"voice":null,"tags":[]}]}'
  )
);
