// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-message-protocol, Example: deserialization rejects malformed JSON

import { describe, it, expect } from 'vitest';
import { deserializeTranscript } from './serialize';
import { MessageErrorCode } from './types';

/**
 * Example tests for representative malformed inputs (R11.6). Each must fail
 * with MESSAGE_MALFORMED_JSON without throwing and without partial
 * construction.
 */
describe('Example: deserializeTranscript rejects malformed inputs', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['empty string', ''],
    ['unterminated object', '{'],
    ['messages is not an array', '{"messages":1}'],
    [
      'invalid role',
      '{"version":1,"messages":[{"id":"a","role":"boss","parts":[{"kind":"text","text":"x"}]}]}',
    ],
    [
      'invalid part kind',
      '{"version":1,"messages":[{"id":"a","role":"user","parts":[{"kind":"weird"}]}]}',
    ],
  ];

  for (const [label, json] of cases) {
    it(`rejects ${label} with MESSAGE_MALFORMED_JSON`, () => {
      const result = deserializeTranscript(json);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(MessageErrorCode.MESSAGE_MALFORMED_JSON);
      }
    });
  }
});
