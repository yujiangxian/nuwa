// Feature: agent-tool-resolution
/**
 * Agent tool resolution — total, pure resolution function.
 *
 * Pure functions only: no I/O, no React, no network, no mutable global state,
 * no time or randomness. resolveAgentTools partitions an agent's tool bindings
 * into resolved and unresolved sets; it never throws and never mutates its
 * inputs, and returns deterministically equal output for equal input.
 */

import type { AgentDefinition } from '../agents/types';
import type { ToolRegistry } from '../tools/types';
import type { AgentResolution, ResolvedToolBinding } from './types';
import { getTool } from '../tools/registry';

/**
 * Resolve a single agent's tool bindings (R3.1, Algorithm 1).
 *
 * Iterates agent.tools, de-duplicating Tool_Ids (each Tool_Id is processed at
 * most once). For each new Tool_Id, getTool determines membership: a hit is
 * collected into resolved, a miss into unresolved. resolved is ordered ascending
 * by toolId, unresolved ascending lexicographically (UTF-16). Total function:
 * never throws, deterministic, does not mutate its inputs.
 */
export function resolveAgentTools(
  agent: AgentDefinition,
  toolRegistry: ToolRegistry,
): AgentResolution {
  const seen = new Set<string>();
  const resolved: ResolvedToolBinding[] = [];
  const unresolved: string[] = [];

  for (const binding of agent.tools) {
    const toolId = binding.toolId;
    if (seen.has(toolId)) {
      continue; // de-duplicate: process each Tool_Id at most once
    }
    seen.add(toolId);

    const def = getTool(toolRegistry, toolId);
    if (def !== undefined) {
      resolved.push({ toolId, tool: def });
    } else {
      unresolved.push(toolId);
    }
  }

  // Stable ascending UTF-16 lexicographic ordering for determinism.
  resolved.sort((a, b) => (a.toolId < b.toolId ? -1 : a.toolId > b.toolId ? 1 : 0));
  unresolved.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  return { agentId: agent.id, resolved, unresolved };
}
