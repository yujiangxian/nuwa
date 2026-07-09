// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-message-protocol

/**
 * Normalization and structural equality for messages (R10, R3.3).
 *
 * Pure module: every function is side-effect free and never mutates its inputs.
 * `normalizeMessage` canonicalizes the internal JSON fields (Arguments_Json /
 * Result_Json) so that semantically equivalent messages converge to a unique
 * representation, while preserving message ordering and key identifying fields.
 */

import type { Message, ContentPart } from './types';
import { canonicalizeJsonString } from './canonicalJson';

/**
 * Normalize to a Canonical_Message (R10.1): apply `canonicalizeJsonString` to
 * `argumentsJson` (tool_call) and `resultJson` (tool_result), leaving text parts
 * untouched. Part order and all other fields (id / role) are preserved.
 *
 * Idempotent and a fixed point on already-normalized messages (R10.3, R10.5):
 * canonicalization of internal JSON is itself idempotent.
 *
 * Pure: returns a new Message; the input is never mutated.
 */
export function normalizeMessage(message: Message): Message {
  const parts: ContentPart[] = message.parts.map((p) => {
    if (p.kind === 'tool_call') {
      return { ...p, argumentsJson: canonicalizeJsonString(p.argumentsJson) };
    }
    if (p.kind === 'tool_result') {
      return { ...p, resultJson: canonicalizeJsonString(p.resultJson) };
    }
    // text parts are returned unchanged.
    return p;
  });
  return { ...message, parts };
}

/**
 * Structural field-by-field equality: same id and role, equal part-list length,
 * and each part equal at the same index. Parts are compared by their `kind`
 * discriminant — differing kinds are never equal:
 *  - text: compares `text`
 *  - tool_call: compares `callId`, `toolName`, `argumentsJson`
 *  - tool_result: compares `callId`, `resultJson`
 */
export function messageEquals(a: Message, b: Message): boolean {
  if (a.id !== b.id || a.role !== b.role) {
    return false;
  }
  if (a.parts.length !== b.parts.length) {
    return false;
  }
  for (let i = 0; i < a.parts.length; i++) {
    if (!partEquals(a.parts[i], b.parts[i])) {
      return false;
    }
  }
  return true;
}

/**
 * Semantic equality (R3.3, R10.4): two messages are semantically equal iff their
 * normalized forms are structurally equal.
 */
export function messageSemanticEquals(a: Message, b: Message): boolean {
  return messageEquals(normalizeMessage(a), normalizeMessage(b));
}

/** Compare two content parts by their `kind` discriminant; differing kinds are unequal. */
function partEquals(a: ContentPart, b: ContentPart): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === 'text' && b.kind === 'text') {
    return a.text === b.text;
  }
  if (a.kind === 'tool_call' && b.kind === 'tool_call') {
    return (
      a.callId === b.callId &&
      a.toolName === b.toolName &&
      a.argumentsJson === b.argumentsJson
    );
  }
  if (a.kind === 'tool_result' && b.kind === 'tool_result') {
    return a.callId === b.callId && a.resultJson === b.resultJson;
  }
  return false;
}
