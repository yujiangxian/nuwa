// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-message-protocol, Property 8: 校验结果 valid 当且仅当无错误且错误良构
//
// 对任意 Message m，validateMessage(m).valid ⇔ errors 空，每条 message 非空、location
// 为对象；对任意 Transcript t，validateTranscript(t).valid ⇔ errors 空。
//
// Validates: Requirements 7.6, 8.6, 9.8

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { validateMessage, validateTranscript } from './validate';
import { arbitraryMessage, arbitraryTranscript } from './arbitraries';
import type { MessageError } from './types';

function assertWellFormed(errors: readonly MessageError[]): void {
  for (const e of errors) {
    expect(typeof e.message).toBe('string');
    expect(e.message.length).toBeGreaterThan(0);
    expect(typeof e.location).toBe('object');
    expect(e.location).not.toBeNull();
  }
}

describe('Property 8: valid iff no errors, and errors are well-formed', () => {
  it('validateMessage: valid equals (errors empty), errors well-formed', () => {
    fc.assert(
      fc.property(arbitraryMessage, (m) => {
        const { valid, errors } = validateMessage(m);
        expect(valid).toBe(errors.length === 0);
        assertWellFormed(errors);
      }),
      { numRuns: 100 },
    );
  });

  it('validateTranscript: valid equals (errors empty), errors well-formed', () => {
    fc.assert(
      fc.property(arbitraryTranscript, (t) => {
        const { valid, errors } = validateTranscript(t);
        expect(valid).toBe(errors.length === 0);
        assertWellFormed(errors);
      }),
      { numRuns: 100 },
    );
  });
});
