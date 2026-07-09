// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-message-protocol, Property 15: 序列化往返恒等

import { describe, it } from 'vitest';
import fc from 'fast-check';
import { serializeTranscript, deserializeTranscript } from './serialize';
import { normalizeMessage, messageEquals } from './normalize';
import { arbitraryTranscript } from './arbitraries';

/**
 * Property 15: 序列化往返恒等
 *
 * 对任意 Transcript t，deserializeTranscript(serializeTranscript(t)) 成功，其记录的
 * messages 与「对 t 每条 normalizeMessage 后的记录」逐条 messageEquals、长度相同、
 * 顺序一致（消息顺序与全部组成部分保留）。
 *
 * **Validates: Requirements 11.3, 11.7**
 */
describe('Property 15: serialization round-trip identity', () => {
  it('deserialize(serialize(t)) recovers the normalized transcript message-for-message', () => {
    fc.assert(
      fc.property(arbitraryTranscript, (t) => {
        const result = deserializeTranscript(serializeTranscript(t));
        if (!result.ok) {
          throw new Error(
            `expected deserialize to succeed, got error: ${JSON.stringify(result.error)}`,
          );
        }

        const expected = t.messages.map(normalizeMessage);
        const actual = result.transcript.messages;

        if (actual.length !== expected.length) {
          throw new Error(
            `length mismatch: expected ${expected.length}, got ${actual.length}`,
          );
        }
        for (let i = 0; i < expected.length; i++) {
          if (!messageEquals(actual[i], expected[i])) {
            throw new Error(
              `message mismatch at index ${i}:\nexpected=${JSON.stringify(
                expected[i],
              )}\nactual=${JSON.stringify(actual[i])}`,
            );
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
