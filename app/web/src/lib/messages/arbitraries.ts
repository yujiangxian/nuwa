// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-message-protocol
//
// Custom fast-check arbitraries (generators) for the messages layer. These power
// the property tests (prop-01..20). Generators are split into "anything goes"
// shapes (for negative / robustness properties) and constrained shapes that are
// guaranteed to satisfy `validateMessage` / `validateTranscript` (for positive
// well-formedness properties).

import fc from 'fast-check';
import type {
  Role,
  ContentPart,
  TextPart,
  ToolCallPart,
  ToolResultPart,
  Message,
  Transcript,
} from './types';

// —— Roles & JSON text ——

/** Any of the four roles. */
export const arbitraryRole: fc.Arbitrary<Role> = fc.constantFrom(
  'system',
  'user',
  'assistant',
  'tool',
);

/**
 * A legal JSON text (stringified JSON value). Includes objects so that key-order
 * canonicalization is exercised by the normalization properties.
 */
export const arbitraryJsonText: fc.Arbitrary<string> = fc
  .jsonValue()
  .map((v) => JSON.stringify(v));

// —— Unconstrained content parts (may be out of bounds) ——

const arbitraryTextPart: fc.Arbitrary<TextPart> = fc
  .record({ text: fc.string() })
  .map((r) => ({ kind: 'text', text: r.text }));

const arbitraryToolCallPart: fc.Arbitrary<ToolCallPart> = fc
  .record({
    callId: fc.string(), // may be empty
    toolName: fc.string(), // may be empty
    argumentsJson: arbitraryJsonText,
  })
  .map((r) => ({
    kind: 'tool_call',
    callId: r.callId,
    toolName: r.toolName,
    argumentsJson: r.argumentsJson,
  }));

const arbitraryToolResultPart: fc.Arbitrary<ToolResultPart> = fc
  .record({
    callId: fc.string(), // may be empty
    resultJson: arbitraryJsonText,
  })
  .map((r) => ({ kind: 'tool_result', callId: r.callId, resultJson: r.resultJson }));

/** A content part of any of the three kinds; callId/toolName may be empty. */
export const arbitraryContentPart: fc.Arbitrary<ContentPart> = fc.oneof(
  arbitraryTextPart,
  arbitraryToolCallPart,
  arbitraryToolResultPart,
);

/** A message that may be out of bounds: empty id, empty parts, empty callId/toolName. */
export const arbitraryMessage: fc.Arbitrary<Message> = fc
  .record({
    id: fc.string(),
    role: arbitraryRole,
    parts: fc.array(arbitraryContentPart),
  })
  .map((r) => ({ id: r.id, role: r.role, parts: r.parts }));

// —— Constrained content parts (guaranteed valid) ——

const arbitraryValidToolCallPart: fc.Arbitrary<ToolCallPart> = fc
  .record({
    callId: fc.string({ minLength: 1 }),
    toolName: fc.string({ minLength: 1 }),
    argumentsJson: arbitraryJsonText,
  })
  .map((r) => ({
    kind: 'tool_call',
    callId: r.callId,
    toolName: r.toolName,
    argumentsJson: r.argumentsJson,
  }));

const arbitraryValidToolResultPart: fc.Arbitrary<ToolResultPart> = fc
  .record({
    callId: fc.string({ minLength: 1 }),
    resultJson: arbitraryJsonText,
  })
  .map((r) => ({ kind: 'tool_result', callId: r.callId, resultJson: r.resultJson }));

/** A content part that never triggers a per-part validation error. */
const arbitraryValidPart: fc.Arbitrary<ContentPart> = fc.oneof(
  arbitraryTextPart,
  arbitraryValidToolCallPart,
  arbitraryValidToolResultPart,
);

/**
 * A message guaranteed to pass `validateMessage`: non-empty id, non-empty parts,
 * non-empty callId on tool_call/tool_result, non-empty toolName on tool_call.
 */
export const arbitraryValidMessage: fc.Arbitrary<Message> = fc
  .record({
    id: fc.string({ minLength: 1 }),
    role: arbitraryRole,
    parts: fc.array(arbitraryValidPart, { minLength: 1 }),
  })
  .map((r) => ({ id: r.id, role: r.role, parts: r.parts }));

// —— Semantically-equivalent JSON key reordering ——

/** True for non-null, non-array plain objects. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Recursively rebuild a parsed JSON value with object keys in reversed order.
 * Reversing the key order produces a different textual layout while keeping the
 * value semantically identical, so `canonicalizeJsonString` collapses both to the
 * same canonical form.
 */
function reverseKeysDeep(v: unknown): unknown {
  if (Array.isArray(v)) {
    return v.map(reverseKeysDeep);
  }
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).reverse()) {
      out[k] = reverseKeysDeep(v[k]);
    }
    return out;
  }
  return v;
}

/**
 * Pure helper: re-emit a JSON text with object key order reversed. Non-object
 * JSON (arrays / primitives) and unparseable text are returned unchanged. The
 * result is semantically equivalent to the input.
 */
export function reorderJsonKeys(jsonText: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return jsonText;
  }
  if (!isPlainObject(parsed)) {
    return jsonText;
  }
  return JSON.stringify(reverseKeysDeep(parsed));
}

/**
 * Given a base `Message`, produce a semantically-equivalent variant whose internal
 * JSON fields (argumentsJson / resultJson) have their object keys reordered. The
 * variant normalizes (via `normalizeMessage`) to the same canonical form as the
 * base, so it `messageEquals` the base's normalized form. A deterministic variant
 * is returned via `fc.constant`.
 */
export function arbitraryReorderedJsonMessage(base: Message): fc.Arbitrary<Message> {
  const parts: ContentPart[] = base.parts.map((p) => {
    if (p.kind === 'tool_call') {
      return { ...p, argumentsJson: reorderJsonKeys(p.argumentsJson) };
    }
    if (p.kind === 'tool_result') {
      return { ...p, resultJson: reorderJsonKeys(p.resultJson) };
    }
    return p;
  });
  return fc.constant({ id: base.id, role: base.role, parts });
}

// —— Well-formed transcripts (guaranteed to pass validateTranscript) ——

type TextUnit = { readonly kind: 'text'; readonly role: Role; readonly text: string };
type ToolUnit = {
  readonly kind: 'tool';
  readonly callRole: Role;
  readonly resultRole: Role;
  readonly toolName: string;
  readonly argumentsJson: string;
  readonly resultJson: string;
};
type TranscriptUnit = TextUnit | ToolUnit;

const textUnit: fc.Arbitrary<TranscriptUnit> = fc
  .record({ role: arbitraryRole, text: fc.string() })
  .map((r) => ({ kind: 'text', role: r.role, text: r.text }));

const toolUnit: fc.Arbitrary<TranscriptUnit> = fc
  .record({
    callRole: arbitraryRole,
    resultRole: arbitraryRole,
    toolName: fc.string({ minLength: 1 }),
    argumentsJson: arbitraryJsonText,
    resultJson: arbitraryJsonText,
  })
  .map((r) => ({
    kind: 'tool',
    callRole: r.callRole,
    resultRole: r.resultRole,
    toolName: r.toolName,
    argumentsJson: r.argumentsJson,
    resultJson: r.resultJson,
  }));

/**
 * A transcript guaranteed to pass `validateTranscript`: every message has a unique
 * sequential id and non-empty parts, every tool_result is preceded by a tool_call
 * sharing a globally-unique callId, and no callId repeats. A `tool` unit expands
 * into a tool_call message immediately followed by its paired tool_result message.
 */
export const arbitraryTranscript: fc.Arbitrary<Transcript> = fc
  .array(fc.oneof(textUnit, toolUnit))
  .map((units) => {
    const messages: Message[] = [];
    let mid = 0;
    let cid = 0;
    for (const u of units) {
      if (u.kind === 'text') {
        messages.push({
          id: `m${mid++}`,
          role: u.role,
          parts: [{ kind: 'text', text: u.text }],
        });
      } else {
        const callId = `c${cid++}`;
        messages.push({
          id: `m${mid++}`,
          role: u.callRole,
          parts: [
            { kind: 'tool_call', callId, toolName: u.toolName, argumentsJson: u.argumentsJson },
          ],
        });
        messages.push({
          id: `m${mid++}`,
          role: u.resultRole,
          parts: [{ kind: 'tool_result', callId, resultJson: u.resultJson }],
        });
      }
    }
    return { messages };
  });

// —— Transcripts engineered to trigger specific validation errors ——

/** A transcript containing at least two messages that share the same Message_Id. */
export const arbitraryDuplicateIdTranscript: fc.Arbitrary<Transcript> = fc
  .record({
    id: fc.string({ minLength: 1 }),
    roleA: arbitraryRole,
    roleB: arbitraryRole,
    textA: fc.string(),
    textB: fc.string(),
  })
  .map((r) => ({
    messages: [
      { id: r.id, role: r.roleA, parts: [{ kind: 'text', text: r.textA }] },
      { id: r.id, role: r.roleB, parts: [{ kind: 'text', text: r.textB }] },
    ],
  }));

/**
 * A transcript containing a single tool_result whose Call_Id matches no earlier
 * tool_call (the whole transcript holds only the orphaned tool_result).
 */
export const arbitraryUnpairedResultTranscript: fc.Arbitrary<Transcript> = fc
  .record({
    callId: fc.string({ minLength: 1 }),
    resultJson: arbitraryJsonText,
    role: arbitraryRole,
  })
  .map((r) => ({
    messages: [
      {
        id: 'm0',
        role: r.role,
        parts: [{ kind: 'tool_result', callId: r.callId, resultJson: r.resultJson }],
      },
    ],
  }));

/** A transcript containing two tool_call parts that share the same Call_Id. */
export const arbitraryDuplicateCallIdTranscript: fc.Arbitrary<Transcript> = fc
  .record({
    callId: fc.string({ minLength: 1 }),
    toolName: fc.string({ minLength: 1 }),
    argumentsJsonA: arbitraryJsonText,
    argumentsJsonB: arbitraryJsonText,
    role: arbitraryRole,
  })
  .map((r) => ({
    messages: [
      {
        id: 'm0',
        role: r.role,
        parts: [
          {
            kind: 'tool_call',
            callId: r.callId,
            toolName: r.toolName,
            argumentsJson: r.argumentsJsonA,
          },
          {
            kind: 'tool_call',
            callId: r.callId,
            toolName: r.toolName,
            argumentsJson: r.argumentsJsonB,
          },
        ],
      },
    ],
  }));

// —— Malformed serialized transcripts ——

/**
 * A string that does not conform to the Transcript_Json structure. Mixes random
 * non-JSON text, structurally-wrong legal JSON, and well-formed JSON carrying an
 * illegal role / part kind / empty parts list.
 */
export const arbitraryMalformedTranscriptJson: fc.Arbitrary<string> = fc.oneof(
  // Random non-JSON text.
  fc.string().filter((s) => {
    try {
      JSON.parse(s);
      return false;
    } catch {
      return true;
    }
  }),
  // Legal JSON with the wrong top-level structure.
  fc.constantFrom('{"messages":1}', '{"version":1}', '[]', 'null', '42'),
  // Well-formed JSON violating role / part kind / non-empty parts constraints.
  fc.constantFrom(
    '{"version":1,"messages":[{"id":"a","role":"boss","parts":[{"kind":"text","text":"x"}]}]}',
    '{"version":1,"messages":[{"id":"a","role":"user","parts":[]}]}',
    '{"version":1,"messages":[{"id":"a","role":"user","parts":[{"kind":"weird"}]}]}',
  ),
);
