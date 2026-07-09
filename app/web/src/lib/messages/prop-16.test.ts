// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-message-protocol, Property 16: 规范字符串往返与规范输出唯一

import { describe, it } from 'vitest';
import fc from 'fast-check';
import { serializeTranscript, deserializeTranscript } from './serialize';
import { arbitraryTranscript, reorderJsonKeys } from './arbitraries';
import type { ContentPart, Message, Transcript } from './types';

/**
 * Build a semantically-equivalent variant of `t` by reordering the object keys
 * inside every internal JSON field (tool_call.argumentsJson / tool_result.resultJson).
 * The variant carries the same semantic content as `t`, so its canonical
 * serialization must be byte-for-byte identical to `serializeTranscript(t)`.
 */
function reorderTranscript(t: Transcript): Transcript {
  const messages: Message[] = t.messages.map((m) => {
    const parts: ContentPart[] = m.parts.map((p) => {
      if (p.kind === 'tool_call') {
        return { ...p, argumentsJson: reorderJsonKeys(p.argumentsJson) };
      }
      if (p.kind === 'tool_result') {
        return { ...p, resultJson: reorderJsonKeys(p.resultJson) };
      }
      return p;
    });
    return { ...m, parts };
  });
  return { messages };
}

describe('Property 16: 规范字符串往返与规范输出唯一', () => {
  it('对任意 transcript，规范字符串为往返不动点，且语义等价变体序列化逐字符相同', () => {
    fc.assert(
      fc.property(arbitraryTranscript, (t) => {
        const j = serializeTranscript(t);

        // Round-trip succeeds.
        const result = deserializeTranscript(j);
        if (!result.ok) {
          throw new Error('expected deserializeTranscript to succeed');
        }

        // The canonical string is a fixed point: re-serializing the deserialized
        // transcript reproduces the exact same string.
        const reserialized = serializeTranscript(result.transcript);
        if (reserialized !== j) {
          throw new Error('expected canonical string to be a round-trip fixed point');
        }

        // Canonical output is unique: a semantically-equivalent variant (internal
        // JSON keys reordered) serializes to the byte-for-byte identical string.
        const variant = reorderTranscript(t);
        const jVariant = serializeTranscript(variant);
        if (jVariant !== j) {
          throw new Error('expected semantically-equivalent variant to serialize identically');
        }
      }),
      { numRuns: 100 },
    );
  });
});
