// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-system
/**
 * Bridge helpers between the tool layer and the prior workflow / agent layers.
 *
 * These are pure functions: they read from their inputs only, never mutate
 * them, and return the same result for the same input. They reference the
 * prior layers' `ToolConfig` and `AgentDefinition` purely as types.
 */

import type { ToolDefinition } from './types';
import type { ToolConfig } from '../workflow/nodeTypes/configTypes';
import type { AgentDefinition } from '../agents/types';

/**
 * Return `toolConfig.toolName`, the key used to look a tool up in a
 * ToolRegistry (R15.1).
 */
export function toolConfigToToolName(toolConfig: ToolConfig): string {
  return toolConfig.toolName;
}

/**
 * Whether the agent's Tool_Binding_List contains a binding whose `toolId`
 * equals `tool.id` (R15.2).
 */
export function isToolReferencedBy(tool: ToolDefinition, agent: AgentDefinition): boolean {
  return agent.tools.some((b) => b.toolId === tool.id);
}
