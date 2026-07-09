// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * Feature: agent-message-protocol
 *
 * Core data model for the immutable, typed message sequences exchanged in
 * multi-agent collaboration. This module is the leaf of the `messages/` layer:
 * pure type and enum declarations only — no logic, no I/O, no imports.
 *
 * Defines roles, content parts, messages, transcripts, the layer's error code
 * enum (all `MESSAGE_` prefixed, disjoint from the prior six layers), error and
 * result value shapes, and query-derived types.
 */

// —— Roles & content parts ——

/** Role of the message sender (R2.1). */
export type Role = 'system' | 'user' | 'assistant' | 'tool';

/** Text content part (R2.3). */
export interface TextPart {
  readonly kind: 'text';
  readonly text: string;
}

/** Tool call content part (R2.4). */
export interface ToolCallPart {
  readonly kind: 'tool_call';
  readonly callId: string; // Call_Id: non-empty
  readonly toolName: string; // Tool_Name: non-empty
  readonly argumentsJson: string; // Arguments_Json: stringified JSON
}

/** Tool result content part (R2.5). */
export interface ToolResultPart {
  readonly kind: 'tool_result';
  readonly callId: string; // Call_Id: non-empty, matches an earlier ToolCallPart
  readonly resultJson: string; // Result_Json: stringified JSON
}

/** Discriminated union of content parts (R2.2). */
export type ContentPart = TextPart | ToolCallPart | ToolResultPart;

/** A single immutable message (R3.1). Equality is based on semantic content (R3.3). */
export interface Message {
  readonly id: string; // Message_Id: non-empty, unique within a Transcript
  readonly role: Role;
  readonly parts: readonly ContentPart[]; // Part_List: non-empty
}

/** Immutable, ordered sequence of messages (R4.1). */
export interface Transcript {
  readonly messages: readonly Message[];
}

// —— Error codes ——

/** Error codes (R9.1): all `MESSAGE_` prefixed, disjoint from the prior six layers (R9.2–R9.7). */
export enum MessageErrorCode {
  MESSAGE_DUPLICATE_ID = 'MESSAGE_DUPLICATE_ID', // R5.3 / R8.3
  MESSAGE_NOT_FOUND = 'MESSAGE_NOT_FOUND', // R6.3
  MESSAGE_EMPTY_ID = 'MESSAGE_EMPTY_ID', // R7.2
  MESSAGE_EMPTY_PARTS = 'MESSAGE_EMPTY_PARTS', // R7.3
  MESSAGE_EMPTY_CALL_ID = 'MESSAGE_EMPTY_CALL_ID', // R7.4
  MESSAGE_EMPTY_TOOL_NAME = 'MESSAGE_EMPTY_TOOL_NAME', // R7.5
  MESSAGE_UNPAIRED_TOOL_RESULT = 'MESSAGE_UNPAIRED_TOOL_RESULT', // R8.4
  MESSAGE_DUPLICATE_CALL_ID = 'MESSAGE_DUPLICATE_CALL_ID', // R8.5
  MESSAGE_MALFORMED_JSON = 'MESSAGE_MALFORMED_JSON', // R11.6
}

/** Error location information (R9.8). */
export interface MessageErrorLocation {
  readonly messageId?: string;
  readonly callId?: string;
  readonly field?: string;
  readonly partIndex?: number;
}

/** A single error value (R9.8). */
export interface MessageError {
  readonly code: MessageErrorCode;
  readonly message: string;
  readonly location: MessageErrorLocation;
}

// —— Result types ——

/** Result of a transcript write operation (R5, R6). */
export type TranscriptResult =
  | { readonly ok: true; readonly transcript: Transcript }
  | { readonly ok: false; readonly error: MessageError };

/** Result of transcript deserialization (R11.2, R11.6). */
export type TranscriptDeserializeResult =
  | { readonly ok: true; readonly transcript: Transcript }
  | { readonly ok: false; readonly error: MessageError };

/** Result of validating a single message (R7). */
export interface MessageValidationResult {
  readonly valid: boolean;
  readonly errors: readonly MessageError[];
}

/** Result of validating a transcript (R8). */
export interface TranscriptValidationResult {
  readonly valid: boolean;
  readonly errors: readonly MessageError[];
}

// —— Query-derived types ——

/** A `toolCalls` result item: a ToolCallPart together with its owning Message_Id (R12.3). */
export interface LocatedToolCall {
  readonly messageId: string;
  readonly part: ToolCallPart;
}

/** A `pairToolResults` result item (R12.4). */
export interface ToolResultPairing {
  readonly result: ToolResultPart;
  readonly resultMessageId: string;
  readonly call: ToolCallPart | null; // null indicates unpaired
  readonly callMessageId: string | null;
}
