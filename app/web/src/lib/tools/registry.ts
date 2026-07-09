// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-system
/**
 * Agent tool system — immutable tool registry operations.
 *
 * Pure functions only: no I/O, no React, no network, no mutable global state.
 * Every mutating operation copies the underlying Map before applying a single
 * point change and never mutates its inputs in place (immutable writes).
 */

import type {
  ToolDefinition,
  ToolRegistry,
  ToolRegistryResult,
  ToolIndex,
} from './types';
import { ToolErrorCode } from './types';

// ---------------------------------------------------------------------------
// Construction & queries (Task 4.1)
// ---------------------------------------------------------------------------

/** Create an empty registry (R4.2). */
export function emptyRegistry(): ToolRegistry {
  return { tools: new Map() };
}

/** Number of tools held by the registry (R4.5). */
export function size(registry: ToolRegistry): number {
  return registry.tools.size;
}

/** Look up a tool by id; returns undefined when absent (never throws) (R8.1). */
export function getTool(
  registry: ToolRegistry,
  toolId: string,
): ToolDefinition | undefined {
  return registry.tools.get(toolId);
}

/** List all tools in ascending UTF-16 lexicographic Tool_Id order (R8.2). */
export function listTools(registry: ToolRegistry): readonly ToolDefinition[] {
  return [...registry.tools.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

/** List tools whose Tag_Set includes the given tag, preserving listing order (R8.3). */
export function listByTag(
  registry: ToolRegistry,
  tag: string,
): readonly ToolDefinition[] {
  return listTools(registry).filter((t) => t.tags.includes(tag));
}

// ---------------------------------------------------------------------------
// Immutable writes — Algorithm 4 (Task 4.2)
// ---------------------------------------------------------------------------

/**
 * Add a tool. Fails with TOOL_DUPLICATE_ID when the id already exists, leaving
 * the original registry unchanged; otherwise returns a new registry (R5).
 */
export function addTool(
  registry: ToolRegistry,
  tool: ToolDefinition,
): ToolRegistryResult {
  if (registry.tools.has(tool.id)) {
    return {
      ok: false,
      error: {
        code: ToolErrorCode.TOOL_DUPLICATE_ID,
        message: `A tool with id "${tool.id}" already exists in the registry.`,
        location: { toolId: tool.id },
      },
    };
  }
  const tools = new Map(registry.tools);
  tools.set(tool.id, tool);
  return { ok: true, registry: { tools } };
}

/**
 * Remove a tool by id. Fails with TOOL_NOT_FOUND when absent; otherwise returns
 * a new registry without that tool (R6).
 */
export function removeTool(
  registry: ToolRegistry,
  toolId: string,
): ToolRegistryResult {
  if (!registry.tools.has(toolId)) {
    return {
      ok: false,
      error: {
        code: ToolErrorCode.TOOL_NOT_FOUND,
        message: `No tool with id "${toolId}" exists in the registry.`,
        location: { toolId },
      },
    };
  }
  const tools = new Map(registry.tools);
  tools.delete(toolId);
  return { ok: true, registry: { tools } };
}

/**
 * Update (replace) an existing tool. Fails with TOOL_NOT_FOUND when absent;
 * otherwise returns a new registry with the replacement, preserving the key set (R7).
 */
export function updateTool(
  registry: ToolRegistry,
  tool: ToolDefinition,
): ToolRegistryResult {
  if (!registry.tools.has(tool.id)) {
    return {
      ok: false,
      error: {
        code: ToolErrorCode.TOOL_NOT_FOUND,
        message: `No tool with id "${tool.id}" exists in the registry.`,
        location: { toolId: tool.id },
      },
    };
  }
  const tools = new Map(registry.tools);
  tools.set(tool.id, tool);
  return { ok: true, registry: { tools } };
}

// ---------------------------------------------------------------------------
// Tag index (Task 4.3)
// ---------------------------------------------------------------------------

/**
 * Build a deterministic tag index mapping each Tag to the set of Tool_Ids that
 * hold that Tag (R16.1, R16.3).
 */
export function buildToolIndex(registry: ToolRegistry): ToolIndex {
  const index = new Map<string, Set<string>>();
  for (const tool of listTools(registry)) {
    for (const tag of tool.tags) {
      const ids = index.get(tag);
      if (ids === undefined) {
        index.set(tag, new Set([tool.id]));
      } else {
        ids.add(tool.id);
      }
    }
  }
  return index;
}
