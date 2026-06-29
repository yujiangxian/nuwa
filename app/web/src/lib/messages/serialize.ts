// Feature: agent-message-protocol

/**
 * Serialization and deserialization for transcripts (R11, Algorithm 6).
 *
 * `serializeTranscript` normalizes each message and projects it onto a plain
 * object with a fixed key order, then stringifies a versioned envelope.
 * `deserializeTranscript` parses untrusted JSON and performs strict structural
 * validation, returning a typed result. Any deviation from the `Transcript_Json`
 * shape yields `MESSAGE_MALFORMED_JSON` without partial construction, and the
 * function never throws (R11.6).
 */

import type {
  Transcript,
  TranscriptDeserializeResult,
  Message,
  ContentPart,
  Role,
} from './types';
import { MessageErrorCode } from './types';
import { normalizeMessage } from './normalize';

/** Current on-disk schema version of `Transcript_Json`. */
const SCHEMA_VERSION = 1;

/** Valid role discriminants (R2.1). */
const VALID_ROLES: readonly Role[] = ['system', 'user', 'assistant', 'tool'];

/** Valid content-part `kind` discriminants (R2.2). */
const VALID_KINDS: readonly ContentPart['kind'][] = [
  'text',
  'tool_call',
  'tool_result',
];

/**
 * Serialize a transcript to its canonical JSON string (R11.1, R11.5).
 *
 * Each message is first normalized, then projected onto a plain object using a
 * fixed key order so that semantically equal transcripts serialize identically.
 */
export function serializeTranscript(transcript: Transcript): string {
  const messages = transcript.messages.map((message) => {
    const normalized = normalizeMessage(message);
    return {
      id: normalized.id,
      role: normalized.role,
      parts: normalized.parts.map(projectPart),
    };
  });
  const plain = { version: SCHEMA_VERSION, messages };
  return JSON.stringify(plain);
}

/** Project a content part onto a plain object with a fixed, kind-specific key order. */
function projectPart(part: ContentPart): Record<string, unknown> {
  if (part.kind === 'tool_call') {
    return {
      kind: 'tool_call',
      callId: part.callId,
      toolName: part.toolName,
      argumentsJson: part.argumentsJson,
    };
  }
  if (part.kind === 'tool_result') {
    return {
      kind: 'tool_result',
      callId: part.callId,
      resultJson: part.resultJson,
    };
  }
  // text part
  return { kind: 'text', text: part.text };
}

/**
 * Internal sentinel used to abort strict validation. It never escapes this
 * module: every throw site is wrapped in a try/catch that converts it (and any
 * unexpected throw) into a `MESSAGE_MALFORMED_JSON` failure result.
 */
class MalformedTranscriptError extends Error {}

/**
 * Deserialize a JSON string into a transcript (R11.2, R11.6, R11.7).
 *
 * Returns a discriminated result. On malformed JSON or any structural violation
 * the result is `{ ok: false, error }` with code `MESSAGE_MALFORMED_JSON`; no
 * partial transcript is ever constructed and no exception is thrown.
 */
export function deserializeTranscript(
  json: string,
): TranscriptDeserializeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return malformed(
      e instanceof Error ? e.message : 'Invalid JSON',
    );
  }

  try {
    const transcript = parseTranscript(parsed);
    return { ok: true, transcript };
  } catch (e) {
    // The sentinel carries a descriptive message; any other unexpected throw is
    // also funnelled here so the function never propagates an exception.
    return malformed(
      e instanceof Error ? e.message : 'Malformed transcript',
    );
  }
}

/** Build a `MESSAGE_MALFORMED_JSON` failure result with an empty location. */
function malformed(message: string): TranscriptDeserializeResult {
  return {
    ok: false,
    error: {
      code: MessageErrorCode.MESSAGE_MALFORMED_JSON,
      message,
      location: {},
    },
  };
}

/** Strictly validate the parsed value and build a clean Transcript, or throw the sentinel. */
function parseTranscript(parsed: unknown): Transcript {
  if (!isPlainObject(parsed)) {
    throw new MalformedTranscriptError('Transcript must be an object');
  }
  if (parsed.version !== SCHEMA_VERSION) {
    throw new MalformedTranscriptError('Unsupported transcript version');
  }
  if (!Array.isArray(parsed.messages)) {
    throw new MalformedTranscriptError('messages must be an array');
  }

  const messages: Message[] = parsed.messages.map(parseMessage);
  return { messages };
}

/** Strictly validate a single message and build a clean Message, or throw the sentinel. */
function parseMessage(value: unknown): Message {
  if (!isPlainObject(value)) {
    throw new MalformedTranscriptError('message must be an object');
  }
  if (typeof value.id !== 'string') {
    throw new MalformedTranscriptError('message.id must be a string');
  }
  if (!isRole(value.role)) {
    throw new MalformedTranscriptError('message.role is invalid');
  }
  if (!Array.isArray(value.parts) || value.parts.length === 0) {
    throw new MalformedTranscriptError('message.parts must be a non-empty array');
  }

  const parts: ContentPart[] = value.parts.map(parsePart);
  return { id: value.id, role: value.role, parts };
}

/** Strictly validate a single content part and build a clean ContentPart, or throw the sentinel. */
function parsePart(value: unknown): ContentPart {
  if (!isPlainObject(value)) {
    throw new MalformedTranscriptError('part must be an object');
  }
  const kind = value.kind;
  if (!isKind(kind)) {
    throw new MalformedTranscriptError('part.kind is invalid');
  }

  if (kind === 'text') {
    if (typeof value.text !== 'string') {
      throw new MalformedTranscriptError('text part requires a string text');
    }
    return { kind: 'text', text: value.text };
  }

  if (kind === 'tool_call') {
    if (
      typeof value.callId !== 'string' ||
      typeof value.toolName !== 'string' ||
      typeof value.argumentsJson !== 'string'
    ) {
      throw new MalformedTranscriptError(
        'tool_call part requires string callId, toolName and argumentsJson',
      );
    }
    return {
      kind: 'tool_call',
      callId: value.callId,
      toolName: value.toolName,
      argumentsJson: value.argumentsJson,
    };
  }

  // kind === 'tool_result'
  if (typeof value.callId !== 'string' || typeof value.resultJson !== 'string') {
    throw new MalformedTranscriptError(
      'tool_result part requires string callId and resultJson',
    );
  }
  return { kind: 'tool_result', callId: value.callId, resultJson: value.resultJson };
}

/** Type guard: a non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Type guard: a valid Role. */
function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (VALID_ROLES as readonly string[]).includes(value);
}

/** Type guard: a valid content-part kind. */
function isKind(value: unknown): value is ContentPart['kind'] {
  return typeof value === 'string' && (VALID_KINDS as readonly string[]).includes(value);
}
