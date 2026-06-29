// Feature: agent-message-protocol, Property 2: 追加重复 id 失败

import { describe, it } from 'vitest';
import fc from 'fast-check';
import { appendMessage, messageCount } from './transcript';
import { arbitraryTranscript, arbitraryValidMessage } from './arbitraries';
import { MessageErrorCode } from './types';
import type { Message } from './types';

describe('Property 2: appendMessage 重复 id 失败', () => {
  it('对任意非空 transcript 与取自其已有 id 的消息，追加失败且定位该 id，输入不变', () => {
    const arb = arbitraryTranscript
      .filter((t) => t.messages.length > 0)
      .chain((t) =>
        fc.record({
          t: fc.constant(t),
          idx: fc.nat({ max: t.messages.length - 1 }),
          body: arbitraryValidMessage,
        }),
      );

    fc.assert(
      fc.property(arb, ({ t, idx, body }) => {
        const existingId = t.messages[idx].id;
        const message: Message = { ...body, id: existingId };

        const beforeCount = messageCount(t);
        const beforeIds = t.messages.map((m) => m.id);

        const result = appendMessage(t, message);

        // The append must fail.
        if (result.ok) {
          throw new Error('expected appendMessage to fail for a duplicate id');
        }

        // Error code is MESSAGE_DUPLICATE_ID.
        if (result.error.code !== MessageErrorCode.MESSAGE_DUPLICATE_ID) {
          throw new Error('expected MESSAGE_DUPLICATE_ID error code');
        }

        // location.messageId matches the duplicated id.
        if (result.error.location.messageId !== existingId) {
          throw new Error('expected error location to identify the duplicate id');
        }

        // The input transcript is unchanged.
        if (messageCount(t) !== beforeCount) {
          throw new Error('input transcript count was mutated');
        }
        for (let i = 0; i < beforeIds.length; i++) {
          if (t.messages[i].id !== beforeIds[i]) {
            throw new Error('input transcript ids were mutated');
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
