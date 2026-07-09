// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-message-protocol, Property 3: 替换保持序列结构

import { describe, it } from 'vitest';
import fc from 'fast-check';
import { replaceMessage, messageCount } from './transcript';
import { messageEquals } from './normalize';
import { arbitraryTranscript, arbitraryValidMessage } from './arbitraries';
import type { Message } from './types';

describe('Property 3: replaceMessage 保持序列结构', () => {
  it('对任意非空 transcript、取自其的 id 与任意内容，替换成功且仅该位置变更', () => {
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
        const id = t.messages[idx].id;
        const message: Message = { ...body, id };

        const beforeIds = t.messages.map((m) => m.id);

        const result = replaceMessage(t, message);

        // The replace must succeed.
        if (!result.ok) {
          throw new Error('expected replaceMessage to succeed');
        }
        const next = result.transcript;

        // The targeted position now equals the replacement message.
        if (!messageEquals(next.messages[idx], message)) {
          throw new Error('expected target position to equal the replacement');
        }

        // Every other position is unchanged.
        for (let i = 0; i < t.messages.length; i++) {
          if (i === idx) continue;
          if (!messageEquals(next.messages[i], t.messages[i])) {
            throw new Error('expected non-target positions to be unchanged');
          }
        }

        // Count and id order match the input transcript.
        if (messageCount(next) !== messageCount(t)) {
          throw new Error('expected message count to be preserved');
        }
        for (let i = 0; i < beforeIds.length; i++) {
          if (next.messages[i].id !== beforeIds[i]) {
            throw new Error('expected id order to be preserved');
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
