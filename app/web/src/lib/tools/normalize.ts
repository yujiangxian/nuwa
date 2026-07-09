// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-system
/**
 * Agent tool system — normalization and equality (Key Algorithm 1).
 *
 * Pure functions only: no I/O, no mutation of inputs, deterministic. PortType
 * equality is delegated to the prior layer's `portTypeEquals` (structural).
 */

import type { ToolDefinition, ParameterDef } from './types';
import { portTypeEquals } from '../workflow/portType';

/** UTF-16 code-unit lexicographic comparator. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Normalize a tool definition into its Canonical_Tool form (R12.1):
 *   1. tags: dedupe, then sort ascending in lexicographic order;
 *   2. parameters: dedupe by name (keep first occurrence), then sort by name.
 * The id/name/description/resultType and each ParameterDef's type/required are
 * left semantically unchanged (R12.6). Idempotent (R12.3), unique for
 * semantically equal inputs (R12.4), and the canonical form is a fixed point
 * (R12.5). Does not mutate the input.
 */
export function normalizeTool(tool: ToolDefinition): ToolDefinition {
  // tags: dedupe (preserving values) then sort lexicographically.
  const tags = [...new Set(tool.tags)].sort(compareStrings);

  // parameters: dedupe by name keeping first occurrence, then sort by name.
  const seen = new Set<string>();
  const deduped: ParameterDef[] = [];
  for (const param of tool.parameters) {
    if (!seen.has(param.name)) {
      seen.add(param.name);
      deduped.push(param);
    }
  }
  const parameters = deduped.sort((x, y) => compareStrings(x.name, y.name));

  return { ...tool, tags, parameters };
}

/**
 * Structural field-by-field equality. parameters and tags are compared in
 * their current order, element by element. PortType fields are compared with
 * the prior layer's `portTypeEquals`.
 */
export function toolEquals(a: ToolDefinition, b: ToolDefinition): boolean {
  if (
    a.id !== b.id ||
    a.name !== b.name ||
    a.description !== b.description ||
    !portTypeEquals(a.resultType, b.resultType)
  ) {
    return false;
  }

  if (a.parameters.length !== b.parameters.length) {
    return false;
  }
  for (let i = 0; i < a.parameters.length; i++) {
    const pa = a.parameters[i];
    const pb = b.parameters[i];
    if (
      pa.name !== pb.name ||
      pa.required !== pb.required ||
      !portTypeEquals(pa.type, pb.type)
    ) {
      return false;
    }
  }

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
 * Semantic equality: normalizeTool(a) and normalizeTool(b) are toolEquals,
 * ignoring the order of parameters and tags (R2.5, R12.4).
 */
export function toolSemanticEquals(a: ToolDefinition, b: ToolDefinition): boolean {
  return toolEquals(normalizeTool(a), normalizeTool(b));
}
