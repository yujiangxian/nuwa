// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * Workflow graph model — port type system (R3).
 *
 * Feature: workflow-graph-model
 *
 * This module implements the structured port value type system: type
 * constructors, structural equality, the `isAssignable` compatibility
 * relation, and the canonical string representation with its inverse parser.
 *
 * Every export is a pure function (or an immutable constant). No I/O, no
 * mutable global state, no time/random dependency.
 */

import type { PortType } from './types';

// ---------------------------------------------------------------------------
// 2.1 Type constructors (R3.1)
// ---------------------------------------------------------------------------

/** Base type constant: string. */
export const T_STRING: PortType = { kind: 'string' };
/** Base type constant: number. */
export const T_NUMBER: PortType = { kind: 'number' };
/** Base type constant: boolean. */
export const T_BOOLEAN: PortType = { kind: 'boolean' };
/** Base type constant: json (the global top type, R3.5). */
export const T_JSON: PortType = { kind: 'json' };
/** Base type constant: message. */
export const T_MESSAGE: PortType = { kind: 'message' };

/** Construct a `list<element>` composite type. */
export function listOf(element: PortType): PortType {
  return { kind: 'list', element };
}

/** Construct an `optional<inner>` composite type. */
export function optionalOf(inner: PortType): PortType {
  return { kind: 'optional', inner };
}

// ---------------------------------------------------------------------------
// 2.2 Structural deep equality (R3.1)
// ---------------------------------------------------------------------------

/**
 * Structural deep equality on PortType. Recurses into `list`/`optional` so that
 * two types are equal iff they have identical structure.
 */
export function portTypeEquals(a: PortType, b: PortType): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  switch (a.kind) {
    case 'list':
      // b.kind === 'list' is guaranteed by the kind check above.
      return portTypeEquals(a.element, (b as { readonly element: PortType }).element);
    case 'optional':
      return portTypeEquals(a.inner, (b as { readonly inner: PortType }).inner);
    default:
      // Both are the same base kind (string/number/boolean/json/message).
      return true;
  }
}

// ---------------------------------------------------------------------------
// 2.3 Assignability — the critical algorithm (R3.2–R3.9)
// ---------------------------------------------------------------------------

/**
 * `isAssignable(from, to)` decides whether a value of type `from` may be
 * assigned to a port expecting type `to`.
 *
 * The definition is by structural induction on `to`, and is designed to
 * simultaneously satisfy reflexivity (R3.3), transitivity (R3.4), `json` as the
 * global top type (R3.5), `optional` wrapping (R3.6), `list` covariance (R3.7),
 * `optional` covariance (R3.8) and the R3.9 restriction (an `optional` cannot be
 * unwrapped into a bare base type).
 *
 * Induction on `to`:
 *   1. to is json                  -> true (top type; takes priority so R3.9 never restricts json)
 *   2. to is optional(tb):
 *        from is optional(ta)      -> isAssignable(ta, tb)   (optional covariance)
 *        otherwise                 -> isAssignable(from, tb) (wrap + covariance unified)
 *   3. to is list(tb):
 *        from is list(ta)          -> isAssignable(ta, tb)   (list covariance)
 *        otherwise                 -> false
 *   4. otherwise (to is a bare base type: string/number/boolean/message):
 *        from is optional          -> false (R3.9)
 *        from is list              -> false
 *        otherwise                 -> from.kind === to.kind  (base types equal only reflexively)
 */
export function isAssignable(from: PortType, to: PortType): boolean {
  // Rule 1: json is the global top type and absorbs everything.
  if (to.kind === 'json') {
    return true;
  }

  // Rule 2: target is optional — covariant, with implicit wrapping of non-optional sources.
  if (to.kind === 'optional') {
    if (from.kind === 'optional') {
      return isAssignable(from.inner, to.inner);
    }
    return isAssignable(from, to.inner);
  }

  // Rule 3: target is list — strictly covariant; only lists are assignable to lists.
  if (to.kind === 'list') {
    if (from.kind === 'list') {
      return isAssignable(from.element, to.element);
    }
    return false;
  }

  // Rule 4: target is a bare base type (string/number/boolean/message).
  if (from.kind === 'optional') {
    // R3.9: optional cannot be unwrapped into a bare (non-json) base type.
    return false;
  }
  if (from.kind === 'list') {
    return false;
  }
  // Both `from` and `to` are bare base types: assignable only when identical.
  return from.kind === to.kind;
}

// ---------------------------------------------------------------------------
// 2.4 Canonical string representation (R3.10)
// ---------------------------------------------------------------------------

/**
 * Render a PortType to its unique canonical string, built bottom-up:
 *   base       -> kind name
 *   list<T>    -> `list<${format(T)}>`
 *   optional<T>-> `optional<${format(T)}>`
 */
export function formatPortType(t: PortType): string {
  switch (t.kind) {
    case 'list':
      return `list<${formatPortType(t.element)}>`;
    case 'optional':
      return `optional<${formatPortType(t.inner)}>`;
    default:
      // Base kinds render to their kind name directly.
      return t.kind;
  }
}

// ---------------------------------------------------------------------------
// 2.5 Recursive-descent parser — inverse of formatPortType (R3.11, R3.12)
// ---------------------------------------------------------------------------

const BASE_KINDS: ReadonlySet<string> = new Set(['string', 'number', 'boolean', 'json', 'message']);

/**
 * Parse a canonical PortType string back into a PortType. Returns `null` for any
 * malformed input. Guarantees `portTypeEquals(parsePortType(formatPortType(t)), t)`.
 */
export function parsePortType(s: string): PortType | null {
  const parsed = parseType(s, 0);
  // Require the parse to consume the entire string with no trailing characters.
  if (parsed === null || parsed.next !== s.length) {
    return null;
  }
  return parsed.type;
}

/** Internal parse result: the parsed type plus the index just past what was consumed. */
interface ParseState {
  readonly type: PortType;
  readonly next: number;
}

/**
 * Parse a single type starting at index `pos`. Returns the parsed type and the
 * position immediately after it, or `null` on malformed input.
 */
function parseType(s: string, pos: number): ParseState | null {
  // Read an identifier: a run of lowercase letters (matches all kind names).
  let i = pos;
  while (i < s.length && s[i] >= 'a' && s[i] <= 'z') {
    i++;
  }
  const ident = s.slice(pos, i);
  if (ident.length === 0) {
    return null;
  }

  if (ident === 'list' || ident === 'optional') {
    // Expect `<` immediately after the keyword.
    if (s[i] !== '<') {
      return null;
    }
    const innerStart = i + 1;
    const inner = parseType(s, innerStart);
    if (inner === null) {
      return null;
    }
    // Expect a closing `>` immediately after the inner type.
    if (s[inner.next] !== '>') {
      return null;
    }
    const composite: PortType =
      ident === 'list' ? { kind: 'list', element: inner.type } : { kind: 'optional', inner: inner.type };
    return { type: composite, next: inner.next + 1 };
  }

  if (BASE_KINDS.has(ident)) {
    return { type: { kind: ident as PortType['kind'] } as PortType, next: i };
  }

  // Unknown identifier — malformed.
  return null;
}
