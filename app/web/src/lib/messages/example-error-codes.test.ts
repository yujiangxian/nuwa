// Feature: agent-message-protocol, Example: MessageErrorCode membership

import { describe, it, expect } from 'vitest';
import { MessageErrorCode } from './types';

/**
 * Example test pinning the exact membership and string values of the
 * MessageErrorCode enum (R9.1). There are exactly nine members, all
 * `MESSAGE_` prefixed.
 */
describe('Example: MessageErrorCode members', () => {
  it('has the nine expected string-valued members', () => {
    expect(MessageErrorCode.MESSAGE_DUPLICATE_ID).toBe('MESSAGE_DUPLICATE_ID');
    expect(MessageErrorCode.MESSAGE_NOT_FOUND).toBe('MESSAGE_NOT_FOUND');
    expect(MessageErrorCode.MESSAGE_EMPTY_ID).toBe('MESSAGE_EMPTY_ID');
    expect(MessageErrorCode.MESSAGE_EMPTY_PARTS).toBe('MESSAGE_EMPTY_PARTS');
    expect(MessageErrorCode.MESSAGE_EMPTY_CALL_ID).toBe('MESSAGE_EMPTY_CALL_ID');
    expect(MessageErrorCode.MESSAGE_EMPTY_TOOL_NAME).toBe('MESSAGE_EMPTY_TOOL_NAME');
    expect(MessageErrorCode.MESSAGE_UNPAIRED_TOOL_RESULT).toBe('MESSAGE_UNPAIRED_TOOL_RESULT');
    expect(MessageErrorCode.MESSAGE_DUPLICATE_CALL_ID).toBe('MESSAGE_DUPLICATE_CALL_ID');
    expect(MessageErrorCode.MESSAGE_MALFORMED_JSON).toBe('MESSAGE_MALFORMED_JSON');
  });

  it('has exactly nine members', () => {
    expect(Object.values(MessageErrorCode).length).toBe(9);
  });
});
