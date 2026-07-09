// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-message-protocol
//
// Immutable transcript operations (R4, R5, R6). Every write returns a new
// Transcript value via TranscriptResult and never mutates its inputs in place.

import type { Message, Transcript, TranscriptResult } from './types';
import { MessageErrorCode } from './types';

/** Create an empty transcript (R4.2). */
export function emptyTranscript(): Transcript {
  return { messages: [] };
}

/** Number of messages in the transcript (R4.3). */
export function messageCount(transcript: Transcript): number {
  return transcript.messages.length;
}

/** Look up a message by id; returns undefined when absent — does not throw (R4.5). */
export function getMessage(transcript: Transcript, messageId: string): Message | undefined {
  return transcript.messages.find((m) => m.id === messageId);
}

/**
 * Append a message at the end of the transcript (R5).
 * Fails with MESSAGE_DUPLICATE_ID when the id already exists; on success the
 * prior order is preserved and the new message is last. Input is never mutated.
 */
export function appendMessage(transcript: Transcript, message: Message): TranscriptResult {
  if (transcript.messages.some((m) => m.id === message.id)) {
    return {
      ok: false,
      error: {
        code: MessageErrorCode.MESSAGE_DUPLICATE_ID,
        message: `A message with id "${message.id}" already exists in the transcript.`,
        location: { messageId: message.id },
      },
    };
  }
  return { ok: true, transcript: { messages: [...transcript.messages, message] } };
}

/**
 * Replace the message sharing the given id, keeping its position (R6).
 * Fails with MESSAGE_NOT_FOUND when no message has that id; on success the
 * count and id order are unchanged. Input is never mutated.
 */
export function replaceMessage(transcript: Transcript, message: Message): TranscriptResult {
  const idx = transcript.messages.findIndex((m) => m.id === message.id);
  if (idx < 0) {
    return {
      ok: false,
      error: {
        code: MessageErrorCode.MESSAGE_NOT_FOUND,
        message: `No message with id "${message.id}" exists in the transcript.`,
        location: { messageId: message.id },
      },
    };
  }
  const next = [...transcript.messages];
  next[idx] = message;
  return { ok: true, transcript: { messages: next } };
}
