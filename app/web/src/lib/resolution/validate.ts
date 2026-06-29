// Feature: agent-tool-resolution
/**
 * Agent tool resolution — cross-layer validation functions.
 *
 * Pure functions only: no I/O, no React, no network, no mutable global state,
 * no time or randomness. These functions resolve and cross-check agent tool
 * bindings and workflow tool-node argument bindings against the tool registry,
 * expressing every failure as a stable ResolutionError value. None of them
 * throw, all are deterministic, and none mutate their inputs.
 */

import type { AgentDefinition, AgentRegistry } from '../agents/types';
import type { ToolRegistry } from '../tools/types';
import type { ToolConfig } from '../workflow/nodeTypes/configTypes';
import type { PortType } from '../workflow/types';
import type { ResolutionValidationResult, ResolutionError } from './types';
import { ResolutionErrorCode } from './types';
import { resolveAgentTools } from './resolve';
import { listAgents } from '../agents/registry';
import { getTool } from '../tools/registry';
import { validateArguments } from '../tools/validate';
import type { ArgumentMap } from '../tools/types';

// ---------------------------------------------------------------------------
// Stable ordering (Algorithm — comparator)
// ---------------------------------------------------------------------------

/** Declaration order of ResolutionErrorCode values, used as the primary key. */
const ERROR_CODE_ORDER: readonly ResolutionErrorCode[] = Object.values(ResolutionErrorCode);

/**
 * Stable comparator (R4.4, R5.4, R6.7): first by ResolutionErrorCode
 * declaration order, then by location fields (agentId, toolId, toolName,
 * paramName, field) in UTF-16 lexicographic order, finally by message as a
 * tie-breaker.
 */
export function compareResolutionErrors(a: ResolutionError, b: ResolutionError): number {
  const codeDelta = ERROR_CODE_ORDER.indexOf(a.code) - ERROR_CODE_ORDER.indexOf(b.code);
  if (codeDelta !== 0) return codeDelta;

  const agentIdDelta = (a.location.agentId ?? '').localeCompare(b.location.agentId ?? '');
  if (agentIdDelta !== 0) return agentIdDelta;

  const toolIdDelta = (a.location.toolId ?? '').localeCompare(b.location.toolId ?? '');
  if (toolIdDelta !== 0) return toolIdDelta;

  const toolNameDelta = (a.location.toolName ?? '').localeCompare(b.location.toolName ?? '');
  if (toolNameDelta !== 0) return toolNameDelta;

  const paramNameDelta = (a.location.paramName ?? '').localeCompare(b.location.paramName ?? '');
  if (paramNameDelta !== 0) return paramNameDelta;

  const fieldDelta = (a.location.field ?? '').localeCompare(b.location.field ?? '');
  if (fieldDelta !== 0) return fieldDelta;

  return a.message.localeCompare(b.message);
}

// ---------------------------------------------------------------------------
// Dangling reference validation (Algorithm 2, R4)
// ---------------------------------------------------------------------------

/**
 * Validate an agent's tool references (R4). Produces one
 * RESOLUTION_TOOL_NOT_FOUND per dangling Tool_Id reported by
 * resolveAgentTools. valid is true iff there are no unresolved references.
 */
export function validateAgentToolRefs(
  agent: AgentDefinition,
  toolRegistry: ToolRegistry,
): ResolutionValidationResult {
  const { unresolved } = resolveAgentTools(agent, toolRegistry);

  const errors: ResolutionError[] = unresolved.map((toolId) => ({
    code: ResolutionErrorCode.RESOLUTION_TOOL_NOT_FOUND,
    message: `Tool "${toolId}" referenced by agent "${agent.id}" was not found in the registry.`,
    location: { agentId: agent.id, toolId },
  }));

  errors.sort(compareResolutionErrors);
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Registry consistency validation (Algorithm 3, R5)
// ---------------------------------------------------------------------------

/**
 * Validate registry consistency (R5): aggregate the dangling-reference errors
 * of every agent in agentRegistry (traversed in Listing_Order), then sort
 * stably. valid is true iff no agent has any dangling reference.
 */
export function validateRegistriesConsistency(
  agentRegistry: AgentRegistry,
  toolRegistry: ToolRegistry,
): ResolutionValidationResult {
  const errors: ResolutionError[] = [];

  for (const agent of listAgents(agentRegistry)) {
    errors.push(...validateAgentToolRefs(agent, toolRegistry).errors);
  }

  errors.sort(compareResolutionErrors);
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Tool-node argument resolution (Algorithm 4, R6)
// ---------------------------------------------------------------------------

/**
 * Validate a workflow tool node's argument bindings (R6). When Tool_Name is
 * absent the function short-circuits with a single RESOLUTION_TOOL_NOT_FOUND
 * (R6.2). Otherwise it detects duplicate argNames as RESOLUTION_DUPLICATE_ARGUMENT
 * (R6.6), then projects the bindings into an Argument_Map and delegates to
 * validateArguments, wrapping each resulting ToolError as
 * RESOLUTION_ARGUMENT_INVALID while preserving its paramName (R6.3, R6.4).
 */
export function resolveToolNodeArguments(
  toolConfig: ToolConfig,
  toolRegistry: ToolRegistry,
): ResolutionValidationResult {
  const tool = getTool(toolRegistry, toolConfig.toolName);
  if (tool === undefined) {
    // R6.2: missing tool short-circuits with a single error.
    return {
      valid: false,
      errors: [
        {
          code: ResolutionErrorCode.RESOLUTION_TOOL_NOT_FOUND,
          message: `Tool "${toolConfig.toolName}" referenced by the tool node was not found in the registry.`,
          location: { toolName: toolConfig.toolName },
        },
      ],
    };
  }

  const errors: ResolutionError[] = [];

  // R6.6: duplicate argName detection (one error per argName occurring twice or more).
  const argNameCounts = new Map<string, number>();
  for (const binding of toolConfig.argumentBindings) {
    argNameCounts.set(binding.argName, (argNameCounts.get(binding.argName) ?? 0) + 1);
  }
  for (const [argName, count] of argNameCounts) {
    if (count >= 2) {
      errors.push({
        code: ResolutionErrorCode.RESOLUTION_DUPLICATE_ARGUMENT,
        message: `Argument name "${argName}" is bound more than once in the tool node.`,
        location: { paramName: argName },
      });
    }
  }

  // R6.3: project the bindings into an Argument_Map (first occurrence wins).
  const argMap = new Map<string, PortType>();
  for (const binding of toolConfig.argumentBindings) {
    if (!argMap.has(binding.argName)) {
      argMap.set(binding.argName, binding.portType);
    }
  }

  // R6.4: delegate to validateArguments and wrap each ToolError, preserving paramName.
  for (const te of validateArguments(tool, argMap as ArgumentMap).errors) {
    errors.push({
      code: ResolutionErrorCode.RESOLUTION_ARGUMENT_INVALID,
      message: te.message,
      location: { paramName: te.location.paramName, toolName: toolConfig.toolName },
    });
  }

  errors.sort(compareResolutionErrors);
  return { valid: errors.length === 0, errors };
}
