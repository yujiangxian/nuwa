// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-message-protocol, Property 1: 追加成功——数量加一、末尾、原记录不变

import { describe, it } from 'vitest';
import fc from 'fast-check';
import {
  appendMessage,
  messageCount,
  getMessage,
} from './transcript';
import { messageEquals } from './normalize';
import { arbitraryTranscript, arbitraryValidMessage } from './arbitraries';
import type { Message, Transcript } from './types';

/**
 * Derive a Message_Id deterministically guaranteed to be absent from `t` by
 * appending '_' to the seed until no existing message shares it. This avoids
 * flaky id collisions between the generated transcript and the new message.
 */
function freshId(t: Transcript, seed: string): string {
  let id = seed;
  while (t.messages.some((m) => m.id === id)) {
    id += '_';
  }
  return id;
}

describe('Property 1: appendMessage 成功——数量加一、末尾、原记录不变', () => {
  it('对任意 transcript 与不在其中的消息，追加成功且结构正确，输入不变', () => {
    fc.assert(
      fc.property(arbitraryTranscript, arbitraryValidMessage, (t, body) => {
        const message: Message = { ...body, id: freshId(t, body.id) };

        // Snapshot of the input transcript before the operation.
        const beforeCount = messageCount(t);
        const beforeIds = t.messages.map((m) => m.id);

        const result = appendMessage(t, message);

        // The append must succeed.
        if (!result.ok) {
          throw new Error('expected appendMessage to succeed');
        }
        const next = result.transcript;

        // messageCount increases by exactly one.
        if (messageCount(next) !== beforeCount + 1) {
          throw new Error('expected messageCount to increase by one');
        }

        // The last message equals the appended message.
        const last = next.messages[next.messages.length - 1];
        if (!messageEquals(last, message)) {
          throw new Error('expected last message to equal the appended message');
        }

        // The prefix preserves the prior message order.
        for (let i = 0; i < t.messages.length; i++) {
          if (next.messages[i].id !== t.messages[i].id) {
            throw new Error('expected prefix order to be preserved');
          }
        }

        // The input transcript is unchanged (count and ids).
        if (messageCount(t) !== beforeCount) {
          throw new Error('input transcript count was mutated');
        }
        for (let i = 0; i < beforeIds.length; i++) {
          if (t.messages[i].id !== beforeIds[i]) {
            throw new Error('input transcript ids were mutated');
          }
        }

        // Sanity: the new id is retrievable in the new transcript.
        const fetched = getMessage(next, message.id);
        if (fetched === undefined || fetched.id !== message.id) {
          throw new Error('expected appended message to be retrievable');
        }
      }),
      { numRuns: 100 },
    );
  });
});
