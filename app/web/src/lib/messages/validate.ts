// Feature: agent-message-protocol
//
// Validation for single messages and whole transcripts. All checks collect
// every violation (no short-circuit) and produce errors sorted into a stable,
// deterministic order via `compareMessageErrors`.

import type {
  Message,
  MessageValidationResult,
  Transcript,
  TranscriptValidationResult,
  MessageError,
} from './types';
import { MessageErrorCode } from './types';

// Declaration order of MessageErrorCode, used as the primary sort key so that
// reports are deterministic regardless of the order violations were detected.
const ERROR_CODE_ORDER: readonly MessageErrorCode[] = Object.values(MessageErrorCode);

/**
 * Stable comparator for `MessageError` (R7.7, R8.7): order by error code
 * declaration order, then by location fields (messageId, callId, field
 * lexicographically; partIndex numerically), then by message as a final
 * tie-breaker.
 */
export function compareMessageErrors(a: MessageError, b: MessageError): number {
  const codeDelta = ERROR_CODE_ORDER.indexOf(a.code) - ERROR_CODE_ORDER.indexOf(b.code);
  if (codeDelta !== 0) return codeDelta;

  const messageIdDelta = (a.location.messageId ?? '').localeCompare(b.location.messageId ?? '');
  if (messageIdDelta !== 0) return messageIdDelta;

  const callIdDelta = (a.location.callId ?? '').localeCompare(b.location.callId ?? '');
  if (callIdDelta !== 0) return callIdDelta;

  const fieldDelta = (a.location.field ?? '').localeCompare(b.location.field ?? '');
  if (fieldDelta !== 0) return fieldDelta;

  const partIndexDelta = (a.location.partIndex ?? -1) - (b.location.partIndex ?? -1);
  if (partIndexDelta !== 0) return partIndexDelta;

  return a.message.localeCompare(b.message);
}

/**
 * Validate a single message (Algorithm 3, R7). Collects every violation without
 * short-circuiting, then returns a stably sorted result.
 */
export function validateMessage(message: Message): MessageValidationResult {
  const errors: MessageError[] = [];

  if (message.id === '') {
    errors.push({
      code: MessageErrorCode.MESSAGE_EMPTY_ID,
      message: 'Message id must not be empty.',
      location: { field: 'id' },
    });
  }

  if (message.parts.length === 0) {
    errors.push({
      code: MessageErrorCode.MESSAGE_EMPTY_PARTS,
      message: 'Message parts must not be empty.',
      location: { field: 'parts' },
    });
  }

  for (let i = 0; i < message.parts.length; i++) {
    const p = message.parts[i];
    if ((p.kind === 'tool_call' || p.kind === 'tool_result') && p.callId === '') {
      errors.push({
        code: MessageErrorCode.MESSAGE_EMPTY_CALL_ID,
        message: 'Tool call id must not be empty.',
        location: { partIndex: i },
      });
    }
    if (p.kind === 'tool_call' && p.toolName === '') {
      errors.push({
        code: MessageErrorCode.MESSAGE_EMPTY_TOOL_NAME,
        message: 'Tool name must not be empty.',
        location: { partIndex: i },
      });
    }
  }

  errors.sort(compareMessageErrors);
  return { valid: errors.length === 0, errors };
}

/**
 * Validate a whole transcript (Algorithm 4, R8). Aggregates per-message
 * validation, detects duplicate message ids, and checks tool-call pairing by a
 * single ordered pass over messages and their parts.
 */
export function validateTranscript(transcript: Transcript): TranscriptValidationResult {
  const errors: MessageError[] = [];

  // Per-message validation (R8.2).
  for (const m of transcript.messages) {
    errors.push(...validateMessage(m).errors);
  }

  // Duplicate Message_Id detection (R8.3).
  const idCounts = new Map<string, number>();
  for (const id of transcript.messages.map((m) => m.id)) {
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  }
  for (const [id, count] of idCounts) {
    if (count >= 2) {
      errors.push({
        code: MessageErrorCode.MESSAGE_DUPLICATE_ID,
        message: 'Message id is duplicated within the transcript.',
        location: { messageId: id },
      });
    }
  }

  // Tool-call pairing (R8.4, R8.5): linear pass over messages and parts in
  // order. A tool_result must be preceded by a tool_call with the same callId,
  // so `seenCallIds` only contains call ids encountered earlier in the pass.
  const seenCallIds = new Set<string>();
  const callIdCounts = new Map<string, number>();
  for (const m of transcript.messages) {
    for (const p of m.parts) {
      if (p.kind === 'tool_call') {
        callIdCounts.set(p.callId, (callIdCounts.get(p.callId) ?? 0) + 1);
        seenCallIds.add(p.callId);
      } else if (p.kind === 'tool_result') {
        if (!seenCallIds.has(p.callId)) {
          errors.push({
            code: MessageErrorCode.MESSAGE_UNPAIRED_TOOL_RESULT,
            message: 'Tool result has no matching earlier tool call.',
            location: { callId: p.callId },
          });
        }
      }
    }
  }
  for (const [callId, count] of callIdCounts) {
    if (count >= 2) {
      errors.push({
        code: MessageErrorCode.MESSAGE_DUPLICATE_CALL_ID,
        message: 'Tool call id is duplicated within the transcript.',
        location: { callId },
      });
    }
  }

  errors.sort(compareMessageErrors);
  return { valid: errors.length === 0, errors };
}
