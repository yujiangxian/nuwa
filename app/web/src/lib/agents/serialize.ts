// Feature: agent-definition-registry
/**
 * Serialization module for the agent definition registry.
 *
 * Provides the canonical Registry_Json serializer and a strict, total
 * deserializer. Both are pure functions: no I/O, no React, no network, no
 * mutable global state, no time/random dependency.
 *
 * `serializeRegistry` reuses the prior layers' "normalize-first, fixed field
 * order, JSON.stringify" paradigm so that semantically-equivalent registries
 * produce a character-for-character identical string (R15.1, R15.5, algorithm 7).
 *
 * `deserializeRegistry` performs strict structural validation and never builds a
 * partial registry: any structural mismatch returns an AGENT_MALFORMED_JSON
 * failure result (R15.2, R15.6, R15.7, algorithm 7).
 */

import { AgentErrorCode } from './types';
import type {
  AgentDefinition,
  AgentRegistry,
  GenerationParams,
  ModelBinding,
  RegistryDeserializeResult,
  ToolBinding,
  VoiceBinding,
} from './types';
import { normalizeAgent } from './normalize';
import { listAgents } from './registry';

// —— Serialization (R15.1, R15.5) ——

/**
 * Plain-object shape with a fixed key order, mirroring the Registry_Json entry
 * structure. Building these objects with literal key order guarantees a stable,
 * deterministic JSON.stringify output.
 */
function agentToPlain(a: AgentDefinition): unknown {
  // Fixed key order: id, name, role, systemPrompt, model(modelId, params),
  // tools, voice, tags.
  return {
    id: a.id,
    name: a.name,
    role: a.role,
    systemPrompt: a.systemPrompt,
    model: {
      modelId: a.model.modelId,
      params: {
        temperature: a.model.params.temperature,
        maxTokens: a.model.params.maxTokens,
        topP: a.model.params.topP,
      },
    },
    tools: a.tools.map((t) => ({ toolId: t.toolId })),
    voice: a.voice ? { voiceId: a.voice.voiceId } : null,
    tags: [...a.tags],
  };
}

/**
 * Serialize a registry to its canonical Registry_Json string (R15.1, algorithm 7).
 * Each agent is normalized and entries are ordered by Agent_Id (via listAgents),
 * then emitted as a fixed-field-order plain object and JSON.stringify'd without
 * indentation, so semantically-equivalent registries yield identical strings (R15.5).
 */
export function serializeRegistry(registry: AgentRegistry): string {
  const entries = listAgents(registry).map(normalizeAgent);
  const plain = { version: 1, agents: entries.map(agentToPlain) };
  return JSON.stringify(plain);
}

// —— Deserialization (R15.2, R15.6, R15.7) ——

/** Sentinel error thrown internally by the structural validators; never escapes this module. */
class MalformedJsonError extends Error {}

/** True for plain (non-null, non-array) objects. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Assert a condition, throwing the sentinel error on failure. */
function check(condition: boolean): asserts condition {
  if (!condition) {
    throw new MalformedJsonError();
  }
}

/** Validate and rebuild a GenerationParams from an untrusted value. */
function restoreParams(value: unknown): GenerationParams {
  check(isPlainObject(value));
  const { temperature, maxTokens, topP } = value;
  check(typeof temperature === 'number');
  check(typeof maxTokens === 'number');
  check(typeof topP === 'number');
  return { temperature, maxTokens, topP };
}

/** Validate and rebuild a ModelBinding from an untrusted value. */
function restoreModel(value: unknown): ModelBinding {
  check(isPlainObject(value));
  check(typeof value.modelId === 'string');
  return { modelId: value.modelId, params: restoreParams(value.params) };
}

/** Validate and rebuild the ToolBinding list from an untrusted value. */
function restoreTools(value: unknown): ToolBinding[] {
  check(Array.isArray(value));
  return value.map((entry) => {
    check(isPlainObject(entry));
    check(typeof entry.toolId === 'string');
    return { toolId: entry.toolId };
  });
}

/** Validate and rebuild a nullable VoiceBinding from an untrusted value. */
function restoreVoice(value: unknown): VoiceBinding | null {
  if (value === null) {
    return null;
  }
  check(isPlainObject(value));
  check(typeof value.voiceId === 'string');
  return { voiceId: value.voiceId };
}

/** Validate and rebuild the tag list from an untrusted value. */
function restoreTags(value: unknown): string[] {
  check(Array.isArray(value));
  return value.map((tag) => {
    check(typeof tag === 'string');
    return tag;
  });
}

/**
 * Validate and rebuild a clean AgentDefinition from an untrusted value,
 * preserving every component faithfully (R15.7). The values are restored exactly
 * as found in the JSON — no normalization is applied here.
 */
function restoreAgent(value: unknown): AgentDefinition {
  check(isPlainObject(value));
  check(typeof value.id === 'string');
  check(typeof value.name === 'string');
  check(typeof value.role === 'string');
  check(typeof value.systemPrompt === 'string');
  return {
    id: value.id,
    name: value.name,
    role: value.role,
    systemPrompt: value.systemPrompt,
    model: restoreModel(value.model),
    tools: restoreTools(value.tools),
    voice: restoreVoice(value.voice),
    tags: restoreTags(value.tags),
  };
}

/**
 * Restore a registry from a canonical Registry_Json string (R15.2, algorithm 7).
 * JSON.parse failure or any structural mismatch returns an AGENT_MALFORMED_JSON
 * failure result; the registry is never partially constructed (R15.6). On
 * success every agent component is preserved (R15.7).
 */
export function deserializeRegistry(json: string): RegistryDeserializeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return {
      ok: false,
      error: {
        code: AgentErrorCode.AGENT_MALFORMED_JSON,
        message: `Failed to parse Registry_Json: ${e instanceof Error ? e.message : String(e)}`,
        location: {},
      },
    };
  }

  try {
    // Top-level must be a plain object with version === 1 and an agents array.
    check(isPlainObject(parsed));
    check(typeof parsed.version === 'number' && parsed.version === 1);
    check(Array.isArray(parsed.agents));

    const agents = new Map<string, AgentDefinition>();
    for (const entry of parsed.agents) {
      const agent = restoreAgent(entry);
      agents.set(agent.id, agent);
    }
    return { ok: true, registry: { agents } };
  } catch (e) {
    // The sentinel MalformedJsonError never escapes: it is mapped to a failure
    // result here. Any other unexpected error is treated the same way.
    void e;
    return {
      ok: false,
      error: {
        code: AgentErrorCode.AGENT_MALFORMED_JSON,
        message: 'Registry_Json does not conform to the expected registry structure',
        location: {},
      },
    };
  }
}
