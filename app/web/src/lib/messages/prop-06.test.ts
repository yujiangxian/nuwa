// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-message-protocol, Property 6: validateMessage 逐类违规检测
//
// 对任意合法 Message，单点注入：空 id ⇒ MESSAGE_EMPTY_ID(field='id')；空 parts ⇒
// MESSAGE_EMPTY_PARTS(field='parts')；含空 callId 的 tool_call/tool_result ⇒
// MESSAGE_EMPTY_CALL_ID(partIndex)；含空 toolName 的 tool_call ⇒
// MESSAGE_EMPTY_TOOL_NAME(partIndex)。
//
// Validates: Requirements 7.2, 7.3, 7.4, 7.5

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { validateMessage } from './validate';
import { arbitraryValidMessage } from './arbitraries';
import { MessageErrorCode } from './types';
import type { Message, MessageError } from './types';

function hasCode(errors: readonly MessageError[], code: MessageErrorCode): boolean {
  return errors.some((e) => e.code === code);
}

describe('Property 6: validateMessage detects each violation class', () => {
  it('empty id yields MESSAGE_EMPTY_ID located at field=id', () => {
    fc.assert(
      fc.property(arbitraryValidMessage, (base) => {
        const m: Message = { ...base, id: '' };
        const { errors } = validateMessage(m);
        const err = errors.find((e) => e.code === MessageErrorCode.MESSAGE_EMPTY_ID);
        expect(err).toBeDefined();
        expect(err?.location.field).toBe('id');
      }),
      { numRuns: 100 },
    );
  });

  it('empty parts yields MESSAGE_EMPTY_PARTS located at field=parts', () => {
    fc.assert(
      fc.property(arbitraryValidMessage, (base) => {
        const m: Message = { ...base, parts: [] };
        const { errors } = validateMessage(m);
        const err = errors.find((e) => e.code === MessageErrorCode.MESSAGE_EMPTY_PARTS);
        expect(err).toBeDefined();
        expect(err?.location.field).toBe('parts');
      }),
      { numRuns: 100 },
    );
  });

  it('a tool_call with empty callId yields MESSAGE_EMPTY_CALL_ID at partIndex 0', () => {
    fc.assert(
      fc.property(arbitraryValidMessage, (base) => {
        const m: Message = {
          ...base,
          parts: [{ kind: 'tool_call', callId: '', toolName: 't', argumentsJson: '{}' }],
        };
        const { errors } = validateMessage(m);
        const err = errors.find((e) => e.code === MessageErrorCode.MESSAGE_EMPTY_CALL_ID);
        expect(err).toBeDefined();
        expect(err?.location.partIndex).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it('a tool_result with empty callId yields MESSAGE_EMPTY_CALL_ID at partIndex 0', () => {
    fc.assert(
      fc.property(arbitraryValidMessage, (base) => {
        const m: Message = {
          ...base,
          parts: [{ kind: 'tool_result', callId: '', resultJson: '{}' }],
        };
        const { errors } = validateMessage(m);
        const err = errors.find((e) => e.code === MessageErrorCode.MESSAGE_EMPTY_CALL_ID);
        expect(err).toBeDefined();
        expect(err?.location.partIndex).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it('a tool_call with empty toolName yields MESSAGE_EMPTY_TOOL_NAME at partIndex 0', () => {
    fc.assert(
      fc.property(arbitraryValidMessage, (base) => {
        const m: Message = {
          ...base,
          parts: [{ kind: 'tool_call', callId: 'c', toolName: '', argumentsJson: '{}' }],
        };
        const { errors } = validateMessage(m);
        const err = errors.find((e) => e.code === MessageErrorCode.MESSAGE_EMPTY_TOOL_NAME);
        expect(err).toBeDefined();
        expect(err?.location.partIndex).toBe(0);
        // The injected tool_call has a non-empty callId, so no empty-callId error here.
        expect(hasCode(errors, MessageErrorCode.MESSAGE_EMPTY_CALL_ID)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
