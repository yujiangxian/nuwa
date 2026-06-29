// Feature: agent-message-protocol, Property 4: 替换不存在失败

import { describe, it } from 'vitest';
import fc from 'fast-check';
import { replaceMessage } from './transcript';
import { arbitraryTranscript, arbitraryValidMessage } from './arbitraries';
import { MessageErrorCode } from './types';
import type { Message, Transcript } from './types';

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

describe('Property 4: replaceMessage 不存在失败', () => {
  it('对任意 transcript 与不在其中的 id，替换失败且定位该 id', () => {
    fc.assert(
      fc.property(arbitraryTranscript, arbitraryValidMessage, (t, body) => {
        const id = freshId(t, body.id);
        const message: Message = { ...body, id };

        const result = replaceMessage(t, message);

        // The replace must fail.
        if (result.ok) {
          throw new Error('expected replaceMessage to fail for an absent id');
        }

        // Error code is MESSAGE_NOT_FOUND.
        if (result.error.code !== MessageErrorCode.MESSAGE_NOT_FOUND) {
          throw new Error('expected MESSAGE_NOT_FOUND error code');
        }

        // location.messageId matches the absent id.
        if (result.error.location.messageId !== id) {
          throw new Error('expected error location to identify the absent id');
        }
      }),
      { numRuns: 100 },
    );
  });
});
