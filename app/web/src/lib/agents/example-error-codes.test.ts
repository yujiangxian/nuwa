// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-definition-registry, Example: AgentErrorCode 枚举的全部 10 个成员
import { describe, it, expect } from 'vitest';
import { AgentErrorCode } from './types';

describe('example: AgentErrorCode enum members', () => {
  it('contains all ten members with matching string values', () => {
    expect(AgentErrorCode.AGENT_DUPLICATE_ID).toBe('AGENT_DUPLICATE_ID');
    expect(AgentErrorCode.AGENT_NOT_FOUND).toBe('AGENT_NOT_FOUND');
    expect(AgentErrorCode.AGENT_EMPTY_ID).toBe('AGENT_EMPTY_ID');
    expect(AgentErrorCode.AGENT_EMPTY_NAME).toBe('AGENT_EMPTY_NAME');
    expect(AgentErrorCode.AGENT_TEMPERATURE_OUT_OF_RANGE).toBe(
      'AGENT_TEMPERATURE_OUT_OF_RANGE'
    );
    expect(AgentErrorCode.AGENT_MAX_TOKENS_INVALID).toBe('AGENT_MAX_TOKENS_INVALID');
    expect(AgentErrorCode.AGENT_TOP_P_OUT_OF_RANGE).toBe('AGENT_TOP_P_OUT_OF_RANGE');
    expect(AgentErrorCode.AGENT_DUPLICATE_TOOL_BINDING).toBe(
      'AGENT_DUPLICATE_TOOL_BINDING'
    );
    expect(AgentErrorCode.AGENT_SYSTEM_PROMPT_TOO_LONG).toBe(
      'AGENT_SYSTEM_PROMPT_TOO_LONG'
    );
    expect(AgentErrorCode.AGENT_MALFORMED_JSON).toBe('AGENT_MALFORMED_JSON');
  });

  it('has exactly ten members', () => {
    expect(Object.values(AgentErrorCode).length).toBe(10);
  });
});
