// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-resolution, Example: ResolutionErrorCode 含全部 4 个成员
/**
 * Example test pinning the four ResolutionErrorCode members and their exact
 * string values, and asserting the enum has exactly four values.
 *
 * **Validates: Requirements 7.1**
 */

import { describe, it, expect } from 'vitest';

import { ResolutionErrorCode } from './types';

describe('Example: ResolutionErrorCode 成员与取值', () => {
  it('逐个断言四个成员的字符串值', () => {
    expect(ResolutionErrorCode.RESOLUTION_TOOL_NOT_FOUND).toBe('RESOLUTION_TOOL_NOT_FOUND');
    expect(ResolutionErrorCode.RESOLUTION_AGENT_NOT_FOUND).toBe('RESOLUTION_AGENT_NOT_FOUND');
    expect(ResolutionErrorCode.RESOLUTION_ARGUMENT_INVALID).toBe('RESOLUTION_ARGUMENT_INVALID');
    expect(ResolutionErrorCode.RESOLUTION_DUPLICATE_ARGUMENT).toBe('RESOLUTION_DUPLICATE_ARGUMENT');
  });

  it('枚举恰含 4 个取值', () => {
    expect(Object.values(ResolutionErrorCode).length).toBe(4);
  });
});
