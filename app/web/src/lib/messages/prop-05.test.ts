// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-message-protocol, Property 5: getMessage 命中与未命中

import { describe, it } from 'vitest';
import fc from 'fast-check';
import { getMessage } from './transcript';
import { arbitraryTranscript, arbitraryValidMessage } from './arbitraries';
import type { Transcript } from './types';

/**
 * Derive a Message_Id deterministically guaranteed to be absent from `t` by
 * appending '_' to the seed until no existing message shares it.
 */
function freshId(t: Transcript, seed: string): string {
  let id = seed;
  while (t.messages.some((m) => m.id === id)) {
    id += '_';
  }
  return id;
}

describe('Property 5: getMessage 命中与未命中', () => {
  it('对每个出现的 id 命中且 id 相等，对不存在的 id 返回 undefined', () => {
    fc.assert(
      fc.property(arbitraryTranscript, arbitraryValidMessage, (t, body) => {
        // Hit: every present id resolves to a message with that id.
        for (const m of t.messages) {
          const found = getMessage(t, m.id);
          if (found === undefined || found.id !== m.id) {
            throw new Error('expected getMessage to find each present id');
          }
        }

        // Miss: an absent id resolves to undefined (no throw).
        const absent = freshId(t, body.id);
        if (getMessage(t, absent) !== undefined) {
          throw new Error('expected getMessage to return undefined for an absent id');
        }
      }),
      { numRuns: 100 },
    );
  });
});
