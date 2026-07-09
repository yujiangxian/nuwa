// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-turn-reducer, Example: 错误码成员与字符串值

import { describe, it, expect } from 'vitest';
import { TurnErrorCode } from './types';

/**
 * Example: TurnErrorCode exposes exactly three members, each with the
 * documented string value.
 *
 * Validates: Requirements 6.1
 */
describe('Example: 错误码成员与字符串值', () => {
  it('三个成员字符串值正确且总数为 3', () => {
    expect(TurnErrorCode.TURN_INVALID_STATE).toBe('TURN_INVALID_STATE');
    expect(TurnErrorCode.TURN_DUPLICATE_MESSAGE_ID).toBe('TURN_DUPLICATE_MESSAGE_ID');
    expect(TurnErrorCode.TURN_UNKNOWN_CALL_ID).toBe('TURN_UNKNOWN_CALL_ID');
    expect(Object.values(TurnErrorCode).length).toBe(3);
  });
});
