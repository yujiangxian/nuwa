// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * Feature: agent-turn-reducer
 *
 * Core data model for the pure, deterministic turn reducer state machine that
 * advances a single conversational turn. This module is the leaf of the
 * `turn/` layer: pure type, enum, and constant declarations only — no logic,
 * no I/O, no React, no network.
 *
 * Defines the turn status, turn state, model response / tool outcome injection
 * shapes, the layer's error code enum (all `TURN_` prefixed, disjoint from the
 * prior eight layers), error and result value shapes, and the tool-result
 * message id prefix constant.
 */

import type { Transcript } from '../messages/types';

/** Turn state machine status (R2.2). */
export type TurnStatus = 'awaiting_model' | 'awaiting_tools' | 'completed';

/** Turn state (R2.1). */
export interface TurnState {
  readonly transcript: Transcript;
  readonly status: TurnStatus;
  readonly pendingCallIds: readonly string[]; // deduplicated, order-preserving
}

/** A single tool call within a Model_Response (R2.3). */
export interface ResponseToolCall {
  readonly callId: string;
  readonly toolName: string;
  readonly argumentsJson: string;
}

/** One step of model output (R2.3). */
export interface ModelResponse {
  readonly messageId: string;
  readonly assistantText?: string; // optional assistant text
  readonly toolCalls: readonly ResponseToolCall[];
}

/** A tool result (R2.4). */
export interface ToolOutcome {
  readonly callId: string;
  readonly resultJson: string;
}

/** Error codes (R6.1): all `TURN_` prefixed, disjoint from the prior eight layers (R6.2–R6.9). */
export enum TurnErrorCode {
  TURN_INVALID_STATE = 'TURN_INVALID_STATE', // R4.2 / R5.2
  TURN_DUPLICATE_MESSAGE_ID = 'TURN_DUPLICATE_MESSAGE_ID', // R4.3
  TURN_UNKNOWN_CALL_ID = 'TURN_UNKNOWN_CALL_ID', // R5.3
}

/** Error location information (R6.10). */
export interface TurnErrorLocation {
  readonly callId?: string;
  readonly messageId?: string;
  readonly status?: TurnStatus;
}

/** A single error value (R6.10). */
export interface TurnError {
  readonly code: TurnErrorCode;
  readonly message: string;
  readonly location: TurnErrorLocation;
}

/** Result of a turn transition (R4.1 / R5.1). */
export type TurnResult =
  | { readonly ok: true; readonly state: TurnState }
  | { readonly ok: false; readonly error: TurnError };

/** Message_Id prefix for tool-result messages (Decision 2). */
export const TOOL_RESULT_MESSAGE_ID_PREFIX = 'turn:tool-result:';
