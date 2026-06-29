// Feature: agent-turn-reducer
//
// Pure, deterministic reducer state machine that advances a single
// conversational turn. Model output and tool results are injected as pure
// data; this layer performs no I/O, calls no LLM/tool, and never mutates its
// inputs. Every transition returns a fresh TurnState wrapped in a TurnResult.

import type { Transcript, Message, ContentPart } from '../messages/types';
import type { TurnState, ModelResponse, ToolOutcome, TurnResult } from './types';
import { TurnErrorCode, TOOL_RESULT_MESSAGE_ID_PREFIX } from './types';
import { appendMessage, getMessage } from '../messages/transcript';

/**
 * Algorithm 1 (R3): construct the initial Turn_State from a Transcript.
 * Status is `awaiting_model` and Pending_Call_Ids is empty.
 */
export function initialTurnState(transcript: Transcript): TurnState {
  return { transcript, status: 'awaiting_model', pendingCallIds: [] };
}

/**
 * Algorithm 2 (R4): apply one step of model output.
 * Only legal in `awaiting_model`; appends an `assistant` message and
 * transitions based on whether the response contains tool calls.
 */
export function applyModelResponse(state: TurnState, response: ModelResponse): TurnResult {
  // R4.2: invalid state.
  if (state.status !== 'awaiting_model') {
    return {
      ok: false,
      error: {
        code: TurnErrorCode.TURN_INVALID_STATE,
        message: `applyModelResponse requires status "awaiting_model" but got "${state.status}".`,
        location: { status: state.status },
      },
    };
  }

  // R4.3: duplicate Message_Id already present in the transcript.
  if (getMessage(state.transcript, response.messageId) !== undefined) {
    return {
      ok: false,
      error: {
        code: TurnErrorCode.TURN_DUPLICATE_MESSAGE_ID,
        message: `A message with id "${response.messageId}" already exists in the transcript.`,
        location: { messageId: response.messageId },
      },
    };
  }

  // Build the assistant message parts: optional text first, then tool calls.
  const parts: ContentPart[] = [];
  if (response.assistantText !== undefined) {
    parts.push({ kind: 'text', text: response.assistantText });
  }
  for (const c of response.toolCalls) {
    parts.push({
      kind: 'tool_call',
      callId: c.callId,
      toolName: c.toolName,
      argumentsJson: c.argumentsJson,
    });
  }
  // Guarantee a non-empty Part_List (messages layer well-formedness).
  const finalParts: ContentPart[] = parts.length === 0 ? [{ kind: 'text', text: '' }] : parts;

  const msg: Message = { id: response.messageId, role: 'assistant', parts: finalParts };
  const appended = appendMessage(state.transcript, msg);
  // Double safety: appendMessage detects duplicate ids too.
  if (!appended.ok) {
    return {
      ok: false,
      error: {
        code: TurnErrorCode.TURN_DUPLICATE_MESSAGE_ID,
        message: `A message with id "${response.messageId}" already exists in the transcript.`,
        location: { messageId: response.messageId },
      },
    };
  }

  // R4.4: Pending_Call_Ids = tool call ids, deduplicated, order-preserving.
  const seen = new Set<string>();
  const pending: string[] = [];
  for (const c of response.toolCalls) {
    if (!seen.has(c.callId)) {
      seen.add(c.callId);
      pending.push(c.callId);
    }
  }

  // R4.4 / R4.5: transition based on presence of tool calls.
  const status = pending.length > 0 ? 'awaiting_tools' : 'completed';

  return {
    ok: true,
    state: { transcript: appended.transcript, status, pendingCallIds: pending },
  };
}

/**
 * Algorithm 3 (R5): apply tool results.
 * Only legal in `awaiting_tools`; appends a `tool` message and settles the
 * Pending_Call_Ids. An empty `outcomes` is a trivial success.
 */
export function applyToolResults(state: TurnState, outcomes: readonly ToolOutcome[]): TurnResult {
  // R5.2: invalid state.
  if (state.status !== 'awaiting_tools') {
    return {
      ok: false,
      error: {
        code: TurnErrorCode.TURN_INVALID_STATE,
        message: `applyToolResults requires status "awaiting_tools" but got "${state.status}".`,
        location: { status: state.status },
      },
    };
  }

  // R5.3: every outcome's Call_Id must be pending.
  const pendingSet = new Set(state.pendingCallIds);
  for (const o of outcomes) {
    if (!pendingSet.has(o.callId)) {
      return {
        ok: false,
        error: {
          code: TurnErrorCode.TURN_UNKNOWN_CALL_ID,
          message: `Call_Id "${o.callId}" is not in the pending tool calls.`,
          location: { callId: o.callId },
        },
      };
    }
  }

  // R5.4: build tool-result parts preserving outcomes order.
  const parts: ContentPart[] = outcomes.map((o) => ({
    kind: 'tool_result',
    callId: o.callId,
    resultJson: o.resultJson,
  }));

  // R5.7: remove settled Call_Ids, preserving the relative order of the rest.
  const resolved = new Set(outcomes.map((o) => o.callId));
  const nextPending = state.pendingCallIds.filter((id) => !resolved.has(id));

  // Append a `tool` message only when there are outcomes; empty is trivial.
  let nextTranscript = state.transcript;
  if (outcomes.length > 0) {
    const msgId = TOOL_RESULT_MESSAGE_ID_PREFIX + state.transcript.messages.length;
    const appended = appendMessage(state.transcript, { id: msgId, role: 'tool', parts });
    if (!appended.ok) {
      return {
        ok: false,
        error: {
          code: TurnErrorCode.TURN_DUPLICATE_MESSAGE_ID,
          message: `A message with id "${msgId}" already exists in the transcript.`,
          location: { messageId: msgId },
        },
      };
    }
    nextTranscript = appended.transcript;
  }

  // R5.5 / R5.6: transition based on remaining pending calls.
  const status = nextPending.length === 0 ? 'awaiting_model' : 'awaiting_tools';

  return {
    ok: true,
    state: { transcript: nextTranscript, status, pendingCallIds: nextPending },
  };
}
