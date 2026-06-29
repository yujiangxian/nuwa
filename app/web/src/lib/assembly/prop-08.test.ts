// Feature: agent-conversation-assembly, Property 8: 装配长度上界
//
// 对任意 a、t 与含 maxMessages = max (max >= 1) 的 options，assembleMessages 的
// 长度不超过 max；当不含 maxMessages 时长度等于 1 + t.messages.length。
// Validates: Requirements 4.5

import { describe, it } from 'vitest';
import fc from 'fast-check';
import { assembleMessages } from './assemble';
import {
  arbitraryAgent,
  arbitraryTranscript,
  arbitraryMaxMessages,
} from './arbitraries';

describe('Property 8: 装配长度上界', () => {
  it('提供 maxMessages 时装配结果长度不超过 max', () => {
    fc.assert(
      fc.property(
        arbitraryAgent,
        arbitraryTranscript,
        arbitraryMaxMessages,
        (a, t, max) => {
          const res = assembleMessages(a, t, { maxMessages: max });
          return res.length <= max;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('不含 maxMessages 时长度等于 1 + 历史长度', () => {
    fc.assert(
      fc.property(arbitraryAgent, arbitraryTranscript, (a, t) => {
        const res = assembleMessages(a, t, {});
        return res.length === 1 + t.messages.length;
      }),
      { numRuns: 100 },
    );
  });
});
