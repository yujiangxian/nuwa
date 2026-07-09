// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-message-protocol

/**
 * Canonicalize a JSON text into a deterministic, key-ordered equivalent JSON string:
 * parse it, then recursively sort all object keys in ascending order and re-stringify.
 *
 * Total function: if the input is not valid JSON, it is returned unchanged (identity),
 * preserving totality.
 *
 * Idempotent: canonicalizeJsonString(canonicalizeJsonString(s)) === canonicalizeJsonString(s).
 *
 * Pure: no side effects, output depends only on the input.
 */
export function canonicalizeJsonString(jsonText: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    // Invalid JSON is returned as-is to guarantee identity and totality.
    return jsonText;
  }
  return JSON.stringify(sortKeysDeep(parsed));
}

/**
 * Recursively sort object keys (ascending) while preserving array order and primitives.
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortKeysDeep(source[key]);
    }
    return sorted;
  }
  // Primitives (string / number / boolean) and null are returned unchanged.
  return value;
}
