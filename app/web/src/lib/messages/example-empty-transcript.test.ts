// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-message-protocol, Example: empty transcript queries

import { describe, it, expect } from 'vitest';
import { emptyTranscript, messageCount, getMessage } from './transcript';
import { lastMessage, messagesByRole } from './query';

/**
 * Example/edge tests for an empty Transcript (R4.2, R4.5, R12.2).
 * Queries over an empty transcript return well-defined empties rather than
 * throwing.
 */
describe('Example: empty transcript', () => {
  it('messageCount of an empty transcript is 0', () => {
    expect(messageCount(emptyTranscript())).toBe(0);
  });

  it('lastMessage of an empty transcript is undefined', () => {
    expect(lastMessage(emptyTranscript())).toBeUndefined();
  });

  it('getMessage on an empty transcript returns undefined and does not throw', () => {
    expect(getMessage(emptyTranscript(), 'x')).toBeUndefined();
  });

  it('messagesByRole on an empty transcript returns an empty array', () => {
    expect(messagesByRole(emptyTranscript(), 'user')).toEqual([]);
  });
});
