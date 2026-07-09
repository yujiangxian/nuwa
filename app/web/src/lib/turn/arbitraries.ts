// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-turn-reducer
//
// Custom fast-check arbitraries (generators) for the turn reducer layer. These
// power the property tests (prop-01..16). Generators are constructed relative to
// a concrete Transcript so that generated Model_Response message ids are
// guaranteed fresh (not already present in the transcript) and never collide
// with the `turn:tool-result:` derived id prefix.

import fc from 'fast-check';
import type { Transcript } from '../messages/types';
import type { TurnState, ModelResponse, ToolOutcome } from './types';
import { arbitraryTranscript } from '../messages/arbitraries';
import { initialTurnState, applyModelResponse } from './reducer';

/**
 * Produce a message id derived from `seed` that is guaranteed not to collide with
 * any existing message id in `transcript`. Appends '_' until unique. The seed is
 * an ordinary string (never starting with the tool-result prefix), so the result
 * also stays clear of derived tool-result message ids.
 */
export function freshMessageId(transcript: Transcript, seed: string): string {
  let id = seed;
  while (transcript.messages.some((m) => m.id === id)) {
    id += '_';
  }
  return id;
}

/** A legal JSON text (stringified JSON value), used for arguments / result payloads. */
export const arbitraryJsonText: fc.Arbitrary<string> = fc
  .jsonValue()
  .map((v) => JSON.stringify(v));

/**
 * A Model_Response carrying at least one tool call (callIds unique), relative to
 * `transcript`. Drives the transition into `awaiting_tools`.
 */
export function arbitraryModelResponseWithTools(
  transcript: Transcript,
): fc.Arbitrary<ModelResponse> {
  return fc
    .record({
      seed: fc.string(),
      assistantText: fc.option(fc.string(), { nil: undefined }),
      toolCalls: fc.uniqueArray(
        fc.record({
          callId: fc.string({ minLength: 1 }),
          toolName: fc.string({ minLength: 1 }),
          argumentsJson: arbitraryJsonText,
        }),
        { selector: (c) => c.callId, minLength: 1 },
      ),
    })
    .map((r) => ({
      messageId: freshMessageId(transcript, r.seed),
      assistantText: r.assistantText,
      toolCalls: r.toolCalls,
    }));
}

/**
 * A Model_Response with no tool calls, relative to `transcript`. Drives the
 * transition into `completed`.
 */
export function arbitraryModelResponseNoTools(
  transcript: Transcript,
): fc.Arbitrary<ModelResponse> {
  return fc
    .record({
      seed: fc.string(),
      assistantText: fc.option(fc.string(), { nil: undefined }),
    })
    .map((r) => ({
      messageId: freshMessageId(transcript, r.seed),
      assistantText: r.assistantText,
      toolCalls: [],
    }));
}

/** Either a with-tools or no-tools Model_Response relative to `transcript`. */
export function arbitraryModelResponse(transcript: Transcript): fc.Arbitrary<ModelResponse> {
  return fc.oneof(
    arbitraryModelResponseWithTools(transcript),
    arbitraryModelResponseNoTools(transcript),
  );
}

/** A Turn_State in `awaiting_model`: the initial state for an arbitrary transcript. */
export const arbitraryTurnStateAwaitingModel: fc.Arbitrary<TurnState> = arbitraryTranscript.map(
  (t) => initialTurnState(t),
);

/**
 * A Turn_State in `awaiting_tools`: produced by applying a with-tools model
 * response to a fresh initial state (so Pending_Call_Ids is non-empty). Filtered
 * to the `awaiting_tools` status (which always holds for the with-tools branch).
 */
export const arbitraryTurnStateAwaitingTools: fc.Arbitrary<TurnState> = arbitraryTranscript
  .chain((t) =>
    arbitraryModelResponseWithTools(t).map((r) => {
      const res = applyModelResponse(initialTurnState(t), r);
      return res.ok ? res.state : initialTurnState(t);
    }),
  )
  .filter((s) => s.status === 'awaiting_tools');

/**
 * A Turn_State in `completed`: produced by applying a no-tools model response to
 * a fresh initial state. Filtered to the `completed` status.
 */
export const arbitraryCompletedState: fc.Arbitrary<TurnState> = arbitraryTranscript
  .chain((t) =>
    arbitraryModelResponseNoTools(t).map((r) => {
      const res = applyModelResponse(initialTurnState(t), r);
      return res.ok ? res.state : initialTurnState(t);
    }),
  )
  .filter((s) => s.status === 'completed');

/**
 * Tool_Outcomes covering ALL of the given pending Call_Ids, in pending order.
 * For an empty pending list, yields the empty outcome list.
 */
export function arbitraryToolOutcomesFull(
  pendingCallIds: readonly string[],
): fc.Arbitrary<readonly ToolOutcome[]> {
  if (pendingCallIds.length === 0) {
    return fc.constant([] as readonly ToolOutcome[]);
  }
  return fc.tuple(
    ...pendingCallIds.map((id) =>
      arbitraryJsonText.map((resultJson) => ({ callId: id, resultJson })),
    ),
  );
}

/**
 * Tool_Outcomes covering a non-empty PROPER subset of the given pending Call_Ids
 * (requires pending length >= 2). For shorter pending lists, yields the empty
 * outcome list (tests exercising this generator use states with length >= 2).
 */
export function arbitraryToolOutcomesSubset(
  pendingCallIds: readonly string[],
): fc.Arbitrary<readonly ToolOutcome[]> {
  if (pendingCallIds.length < 2) {
    return fc.constant([] as readonly ToolOutcome[]);
  }
  return fc
    .shuffledSubarray([...pendingCallIds], {
      minLength: 1,
      maxLength: pendingCallIds.length - 1,
    })
    .chain((ids) =>
      fc.tuple(
        ...ids.map((id) =>
          arbitraryJsonText.map((resultJson) => ({ callId: id, resultJson })),
        ),
      ),
    );
}
