// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-message-protocol, Property 17: 反序列化拒斥畸形输入

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { deserializeTranscript } from './serialize';
import { arbitraryMalformedTranscriptJson } from './arbitraries';
import { MessageErrorCode } from './types';

describe('Property 17: 反序列化拒斥畸形输入', () => {
  it('对任意畸形输入，反序列化不抛异常、失败且码为 MESSAGE_MALFORMED_JSON、不部分构造', () => {
    fc.assert(
      fc.property(arbitraryMalformedTranscriptJson, (s) => {
        // Never throws.
        expect(() => deserializeTranscript(s)).not.toThrow();

        const result = deserializeTranscript(s);

        // Fails with the malformed-JSON code.
        if (result.ok !== false) {
          throw new Error('expected deserializeTranscript to fail for malformed input');
        }
        if (result.error.code !== MessageErrorCode.MESSAGE_MALFORMED_JSON) {
          throw new Error('expected MESSAGE_MALFORMED_JSON error code');
        }

        // No partial construction: the failure result carries no transcript field.
        if ('transcript' in result) {
          throw new Error('expected no transcript field on a failure result');
        }
      }),
      { numRuns: 100 },
    );
  });
});
