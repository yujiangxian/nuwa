// Feature: agent-conversation-assembly, Example: AssemblyErrorCode 成员完整且仅 2 个
//
// Validates: Requirements 7.1

import { describe, it, expect } from 'vitest';
import { AssemblyErrorCode } from './types';

describe('Example: AssemblyErrorCode 成员', () => {
  it('包含全部 2 个成员且取值集合大小为 2', () => {
    expect(AssemblyErrorCode.ASSEMBLY_SYSTEM_PROMPT_TOO_LONG).toBe('ASSEMBLY_SYSTEM_PROMPT_TOO_LONG');
    expect(AssemblyErrorCode.ASSEMBLY_MAX_MESSAGES_INVALID).toBe('ASSEMBLY_MAX_MESSAGES_INVALID');
    expect(Object.values(AssemblyErrorCode).length).toBe(2);
  });
});
