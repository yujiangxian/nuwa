// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-system, Example: ToolErrorCode 含全部 11 个成员
/**
 * Example & boundary test (R11.1): ToolErrorCode declares exactly the 11
 * TOOL_-prefixed members, each mapping to its own string value.
 */

import { describe, it, expect } from 'vitest';
import { ToolErrorCode } from './types';

describe('Example: ToolErrorCode members', () => {
  it('declares each of the 11 members with the expected string value', () => {
    expect(ToolErrorCode.TOOL_DUPLICATE_ID).toBe('TOOL_DUPLICATE_ID');
    expect(ToolErrorCode.TOOL_NOT_FOUND).toBe('TOOL_NOT_FOUND');
    expect(ToolErrorCode.TOOL_EMPTY_ID).toBe('TOOL_EMPTY_ID');
    expect(ToolErrorCode.TOOL_EMPTY_NAME).toBe('TOOL_EMPTY_NAME');
    expect(ToolErrorCode.TOOL_EMPTY_PARAM_NAME).toBe('TOOL_EMPTY_PARAM_NAME');
    expect(ToolErrorCode.TOOL_DUPLICATE_PARAM).toBe('TOOL_DUPLICATE_PARAM');
    expect(ToolErrorCode.TOOL_EMPTY_TAG).toBe('TOOL_EMPTY_TAG');
    expect(ToolErrorCode.TOOL_MISSING_REQUIRED_ARGUMENT).toBe('TOOL_MISSING_REQUIRED_ARGUMENT');
    expect(ToolErrorCode.TOOL_UNKNOWN_ARGUMENT).toBe('TOOL_UNKNOWN_ARGUMENT');
    expect(ToolErrorCode.TOOL_ARGUMENT_TYPE_MISMATCH).toBe('TOOL_ARGUMENT_TYPE_MISMATCH');
    expect(ToolErrorCode.TOOL_MALFORMED_JSON).toBe('TOOL_MALFORMED_JSON');
  });

  it('has exactly 11 members', () => {
    expect(Object.values(ToolErrorCode).length).toBe(11);
  });
});
