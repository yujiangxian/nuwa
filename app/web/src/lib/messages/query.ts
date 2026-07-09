// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-message-protocol

/**
 * Pure, read-only query helpers over a Transcript. None of these functions
 * mutate their inputs; they only derive new values from existing message data.
 */

import type {
  Transcript,
  Role,
  Message,
  LocatedToolCall,
  ToolResultPairing,
  ToolCallPart,
} from './types';

/** Return the messages whose role matches `role`, preserving order (R12.1). */
export function messagesByRole(transcript: Transcript, role: Role): readonly Message[] {
  return transcript.messages.filter((m) => m.role === role);
}

/** Return the last message, or undefined when the transcript is empty (R12.2). */
export function lastMessage(transcript: Transcript): Message | undefined {
  return transcript.messages.length > 0
    ? transcript.messages[transcript.messages.length - 1]
    : undefined;
}

/**
 * Collect every tool_call part together with its owning Message_Id, in message
 * order then part order (R12.3).
 */
export function toolCalls(transcript: Transcript): readonly LocatedToolCall[] {
  const result: LocatedToolCall[] = [];
  for (const m of transcript.messages) {
    for (const p of m.parts) {
      if (p.kind === 'tool_call') {
        result.push({ messageId: m.id, part: p });
      }
    }
  }
  return result;
}

/**
 * Pair each tool_result part with the earliest (first-seen) tool_call sharing
 * its Call_Id; unpaired results carry null call fields (R12.4). The number of
 * result items equals the number of tool_result parts, in order of appearance.
 */
export function pairToolResults(transcript: Transcript): readonly ToolResultPairing[] {
  // First pass: index the first occurrence of each Call_Id among tool_call parts.
  const callIndex = new Map<string, { call: ToolCallPart; callMessageId: string }>();
  for (const m of transcript.messages) {
    for (const p of m.parts) {
      if (p.kind === 'tool_call' && !callIndex.has(p.callId)) {
        callIndex.set(p.callId, { call: p, callMessageId: m.id });
      }
    }
  }

  // Second pass: emit a pairing for each tool_result part, in order.
  const result: ToolResultPairing[] = [];
  for (const m of transcript.messages) {
    for (const p of m.parts) {
      if (p.kind === 'tool_result') {
        const match = callIndex.get(p.callId);
        result.push({
          result: p,
          resultMessageId: m.id,
          call: match?.call ?? null,
          callMessageId: match?.callMessageId ?? null,
        });
      }
    }
  }
  return result;
}
