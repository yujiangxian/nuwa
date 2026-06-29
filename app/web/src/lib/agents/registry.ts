// Feature: agent-definition-registry
/**
 * Registry module for the agent definition registry.
 *
 * Provides pure construction, query and immutable-write operations over an
 * `AgentRegistry`. Every write operation copies the underlying `Map`, applies a
 * single-point change, and wraps the result in a new `{ agents }` object — the
 * input registry and input agent are never mutated in place (R1.4, R5.4).
 *
 * Listing order is deterministic: agents are ordered by Agent_Id in ascending
 * UTF-16 code-unit lexicographic order (design algorithm 1).
 */

import { AgentErrorCode } from './types';
import type {
  AgentDefinition,
  AgentRegistry,
  RegistryResult,
  TagIndex,
} from './types';

/**
 * Compare two Agent_Ids by ascending UTF-16 code-unit lexicographic order.
 * Returns a stable total order over distinct ids.
 */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// —— Construction & query ——

/** Empty registry (R5.2). */
export function emptyRegistry(): AgentRegistry {
  return { agents: new Map() };
}

/** Number of agents in the registry (R5.5). */
export function size(registry: AgentRegistry): number {
  return registry.agents.size;
}

/** Query by id (R9.1). Returns the definition if present, otherwise undefined (never throws). */
export function getAgent(
  registry: AgentRegistry,
  agentId: string
): AgentDefinition | undefined {
  return registry.agents.get(agentId);
}

/** List all agents in Listing_Order (Agent_Id ascending lexicographic) (R9.2, algorithm 1). */
export function listAgents(registry: AgentRegistry): readonly AgentDefinition[] {
  return [...registry.agents.values()].sort((a, b) => compareIds(a.id, b.id));
}

/** List all agents whose Tag_Set contains tag, in Listing_Order (R9.3, R17.5). */
export function listByTag(
  registry: AgentRegistry,
  tag: string
): readonly AgentDefinition[] {
  return listAgents(registry).filter((a) => a.tags.includes(tag));
}

/** List all agents whose Tool_Binding_List contains toolId, in Listing_Order (R9.4, R17.4). */
export function findByTool(
  registry: AgentRegistry,
  toolId: string
): readonly AgentDefinition[] {
  return listAgents(registry).filter((a) =>
    a.tools.some((t) => t.toolId === toolId)
  );
}

// —— Immutable writes (algorithm 4) ——

/**
 * Add an agent (R6.1). If the id already exists, fail with AGENT_DUPLICATE_ID and
 * leave the input registry unchanged (R6.3, R6.4); otherwise copy the underlying
 * Map, set the new entry, and return the new registry (size + 1) (R6.2, R6.5).
 */
export function addAgent(
  registry: AgentRegistry,
  agent: AgentDefinition
): RegistryResult {
  if (registry.agents.has(agent.id)) {
    return {
      ok: false,
      error: {
        code: AgentErrorCode.AGENT_DUPLICATE_ID,
        message: `Agent with id "${agent.id}" already exists in the registry`,
        location: { agentId: agent.id },
      },
    };
  }
  const next = new Map(registry.agents);
  next.set(agent.id, agent);
  return { ok: true, registry: { agents: next } };
}

/**
 * Remove an agent (R7.1). If the id does not exist, fail with AGENT_NOT_FOUND
 * (R7.3); otherwise copy the underlying Map, delete the entry, and return the new
 * registry (size - 1) (R7.2, R7.5).
 */
export function removeAgent(
  registry: AgentRegistry,
  agentId: string
): RegistryResult {
  if (!registry.agents.has(agentId)) {
    return {
      ok: false,
      error: {
        code: AgentErrorCode.AGENT_NOT_FOUND,
        message: `Agent with id "${agentId}" was not found in the registry`,
        location: { agentId },
      },
    };
  }
  const next = new Map(registry.agents);
  next.delete(agentId);
  return { ok: true, registry: { agents: next } };
}

/**
 * Update an agent (R8.1). If agent.id does not exist, fail with AGENT_NOT_FOUND
 * (R8.3); otherwise copy the underlying Map and replace the entry, leaving the
 * key set and size unchanged (R8.2, R8.4, R8.5).
 */
export function updateAgent(
  registry: AgentRegistry,
  agent: AgentDefinition
): RegistryResult {
  if (!registry.agents.has(agent.id)) {
    return {
      ok: false,
      error: {
        code: AgentErrorCode.AGENT_NOT_FOUND,
        message: `Agent with id "${agent.id}" was not found in the registry`,
        location: { agentId: agent.id },
      },
    };
  }
  const next = new Map(registry.agents);
  next.set(agent.id, agent);
  return { ok: true, registry: { agents: next } };
}

// —— Tag index ——

/**
 * Build the tag index (R17.1): Tag -> set of Agent_Ids that hold that tag.
 * Deterministic: built by iterating listAgents in Listing_Order (R17.3).
 */
export function buildTagIndex(registry: AgentRegistry): TagIndex {
  const index = new Map<string, Set<string>>();
  for (const agent of listAgents(registry)) {
    for (const tag of agent.tags) {
      let ids = index.get(tag);
      if (ids === undefined) {
        ids = new Set<string>();
        index.set(tag, ids);
      }
      ids.add(agent.id);
    }
  }
  return index;
}
