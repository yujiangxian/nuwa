// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-resolution
/**
 * Capability derivation — total, pure functions over resolved agent tools.
 *
 * Pure functions only: no I/O, no React, no network, no mutable global state,
 * no time or randomness. Capabilities are derived from the Tag_Sets of an
 * agent's resolved tools; both functions are deterministic and never mutate
 * their inputs.
 */

import type { AgentDefinition, AgentRegistry } from '../agents/types';
import type { ToolRegistry } from '../tools/types';
import type { CapabilityIndex } from './types';
import { resolveAgentTools } from './resolve';
import { listAgents } from '../agents/registry';

/**
 * Derive an agent's capability set (R8.1, Algorithm 5).
 *
 * Collects the union of Tag_Sets across the agent's resolved tools, then
 * de-duplicates and orders the result ascending lexicographically (UTF-16).
 * Unresolved tool bindings contribute nothing. Total function: never throws,
 * deterministic, does not mutate its inputs.
 */
export function agentCapabilities(
  agent: AgentDefinition,
  toolRegistry: ToolRegistry,
): readonly string[] {
  const caps = new Set<string>();
  for (const rb of resolveAgentTools(agent, toolRegistry).resolved) {
    for (const tag of rb.tool.tags) {
      caps.add(tag);
    }
  }
  // De-duplicated by the Set; ordered ascending UTF-16 for determinism.
  return [...caps].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Build the capability index (R8.3, Algorithm 5).
 *
 * Maps each Capability(Tag) to the set of Agent_Ids that hold it, aggregated
 * across all agents in the registry. Total function: never throws,
 * deterministic, does not mutate its inputs.
 */
export function buildCapabilityIndex(
  agentRegistry: AgentRegistry,
  toolRegistry: ToolRegistry,
): CapabilityIndex {
  const index = new Map<string, Set<string>>();
  for (const agent of listAgents(agentRegistry)) {
    for (const cap of agentCapabilities(agent, toolRegistry)) {
      const ids = index.get(cap);
      if (ids !== undefined) {
        ids.add(agent.id);
      } else {
        index.set(cap, new Set([agent.id]));
      }
    }
  }
  return index;
}
