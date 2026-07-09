// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-system
/**
 * Agent tool system — validation functions and stable error ordering.
 *
 * This module implements `validateTool` (Algorithm 2), `validateRegistry`
 * (Algorithm 3), `validateArguments` (Algorithm 5), and the stable comparator
 * `compareToolErrors`. All functions are pure, deterministic, report every
 * violation without short-circuiting, and return errors sorted by a stable key.
 *
 * To avoid a circular dependency this module does not depend on `registry.ts`;
 * it iterates `registry.tools` directly.
 */

import { isAssignable } from '../workflow/portType';
import type {
  ToolDefinition,
  ToolValidationResult,
  ToolRegistry,
  RegistryValidationResult,
  ArgumentMap,
  ArgumentValidationResult,
  ToolError,
} from './types';
import { ToolErrorCode } from './types';

// ---------------------------------------------------------------------------
// Stable ordering
// ---------------------------------------------------------------------------

/** Declaration order of ToolErrorCode values, used as the primary sort key. */
const ERROR_CODE_ORDER: readonly ToolErrorCode[] = Object.values(ToolErrorCode);

/**
 * Stable comparator (R9.8, R10.5, R14.6): first by ToolErrorCode declaration
 * order, then by location fields (toolId, field, paramName, tag) in UTF-16
 * lexicographic order, finally by message as a tie-breaker.
 */
export function compareToolErrors(a: ToolError, b: ToolError): number {
  const codeDelta = ERROR_CODE_ORDER.indexOf(a.code) - ERROR_CODE_ORDER.indexOf(b.code);
  if (codeDelta !== 0) return codeDelta;

  const toolIdDelta = (a.location.toolId ?? '').localeCompare(b.location.toolId ?? '');
  if (toolIdDelta !== 0) return toolIdDelta;

  const fieldDelta = (a.location.field ?? '').localeCompare(b.location.field ?? '');
  if (fieldDelta !== 0) return fieldDelta;

  const paramNameDelta = (a.location.paramName ?? '').localeCompare(b.location.paramName ?? '');
  if (paramNameDelta !== 0) return paramNameDelta;

  const tagDelta = (a.location.tag ?? '').localeCompare(b.location.tag ?? '');
  if (tagDelta !== 0) return tagDelta;

  return a.message.localeCompare(b.message);
}

// ---------------------------------------------------------------------------
// Tool validation (Algorithm 2, R9)
// ---------------------------------------------------------------------------

/**
 * Validate a single tool definition (R9.1). Reports every violation without
 * short-circuiting, every error carries a non-empty English message, errors
 * are stably sorted, and the function is deterministic (R9.8, R9.9, R11.6).
 */
export function validateTool(tool: ToolDefinition): ToolValidationResult {
  const errors: ToolError[] = [];

  // R9.2: empty Tool_Id.
  if (tool.id === '') {
    errors.push({
      code: ToolErrorCode.TOOL_EMPTY_ID,
      message: 'Tool id must not be empty.',
      location: { field: 'id' },
    });
  }

  // R9.3: empty Tool_Name.
  if (tool.name === '') {
    errors.push({
      code: ToolErrorCode.TOOL_EMPTY_NAME,
      message: 'Tool name must not be empty.',
      location: { field: 'name' },
    });
  }

  // R9.4: empty Param_Name (one error per empty-named parameter).
  for (const p of tool.parameters) {
    if (p.name === '') {
      errors.push({
        code: ToolErrorCode.TOOL_EMPTY_PARAM_NAME,
        message: 'Parameter name must not be empty.',
        location: { paramName: '' },
      });
    }
  }

  // R9.5: duplicate Param_Name (one error per name occurring two or more times).
  const nameCounts = new Map<string, number>();
  for (const p of tool.parameters) {
    nameCounts.set(p.name, (nameCounts.get(p.name) ?? 0) + 1);
  }
  for (const [name, count] of nameCounts) {
    if (count >= 2) {
      errors.push({
        code: ToolErrorCode.TOOL_DUPLICATE_PARAM,
        message: `Parameter name "${name}" is declared more than once.`,
        location: { paramName: name },
      });
    }
  }

  // R9.6: empty Tag (one error per empty tag).
  for (const tag of tool.tags) {
    if (tag === '') {
      errors.push({
        code: ToolErrorCode.TOOL_EMPTY_TAG,
        message: 'Tag must not be empty.',
        location: { tag: '' },
      });
    }
  }

  errors.sort(compareToolErrors);
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Registry validation (Algorithm 3, R10)
// ---------------------------------------------------------------------------

/**
 * Validate a registry (R10.1): aggregate per-tool validation over tools
 * traversed by ascending Tool_Id (R10.2), plus global Tool_Id uniqueness over
 * the stored values (R10.3). Errors are stably sorted (R10.5).
 */
export function validateRegistry(registry: ToolRegistry): RegistryValidationResult {
  const errors: ToolError[] = [];

  // R10.2: per-tool validation, traversing values by ascending key (Tool_Id).
  const sortedKeys = [...registry.tools.keys()].sort((x, y) => x.localeCompare(y));
  for (const key of sortedKeys) {
    const tool = registry.tools.get(key);
    if (tool !== undefined) {
      errors.push(...validateTool(tool).errors);
    }
  }

  // R10.3: duplicate Tool_Id detection over the stored values' own `.id`.
  const idCounts = new Map<string, number>();
  for (const tool of registry.tools.values()) {
    idCounts.set(tool.id, (idCounts.get(tool.id) ?? 0) + 1);
  }
  for (const [id, count] of idCounts) {
    if (count >= 2) {
      errors.push({
        code: ToolErrorCode.TOOL_DUPLICATE_ID,
        message: `Tool id "${id}" is held by more than one tool definition.`,
        location: { toolId: id },
      });
    }
  }

  errors.sort(compareToolErrors);
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Argument validation (Algorithm 5, R14)
// ---------------------------------------------------------------------------

/**
 * Validate an argument binding (R14.1). Missing required argument →
 * TOOL_MISSING_REQUIRED_ARGUMENT (R14.2); unknown argument name →
 * TOOL_UNKNOWN_ARGUMENT (R14.3); argument type not assignable to the parameter
 * type → TOOL_ARGUMENT_TYPE_MISMATCH (R14.4). Reports completely, sorts stably,
 * and is deterministic (R14.6); a missing non-required argument is not an
 * error (R14.7).
 */
export function validateArguments(
  tool: ToolDefinition,
  argumentMap: ArgumentMap,
): ArgumentValidationResult {
  const errors: ToolError[] = [];

  // R14.2: missing required arguments.
  for (const p of tool.parameters) {
    if (p.required && !argumentMap.has(p.name)) {
      errors.push({
        code: ToolErrorCode.TOOL_MISSING_REQUIRED_ARGUMENT,
        message: `Required argument "${p.name}" is missing.`,
        location: { paramName: p.name },
      });
    }
  }

  // R14.3: unknown argument names.
  const paramNames = new Set(tool.parameters.map((p) => p.name));
  for (const name of argumentMap.keys()) {
    if (!paramNames.has(name)) {
      errors.push({
        code: ToolErrorCode.TOOL_UNKNOWN_ARGUMENT,
        message: `Unknown argument "${name}" does not match any parameter.`,
        location: { paramName: name },
      });
    }
  }

  // R14.4: argument type not assignable to the parameter type.
  for (const p of tool.parameters) {
    const argType = argumentMap.get(p.name);
    if (argType !== undefined && !isAssignable(argType, p.type)) {
      errors.push({
        code: ToolErrorCode.TOOL_ARGUMENT_TYPE_MISMATCH,
        message: `Argument type for "${p.name}" is not assignable to the parameter type.`,
        location: { paramName: p.name },
      });
    }
  }

  errors.sort(compareToolErrors);
  return { valid: errors.length === 0, errors };
}
