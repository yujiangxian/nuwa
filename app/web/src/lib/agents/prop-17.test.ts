// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-definition-registry, Property 17: 规范化消解数值越界
//
// 对任意 AgentDefinition a，validateAgent(normalizeAgent(a)).errors 不含
// AGENT_TEMPERATURE_OUT_OF_RANGE、AGENT_TOP_P_OUT_OF_RANGE、AGENT_MAX_TOKENS_INVALID
// 三者中任一 code（规范化已 clamp 数值，故消解全部数值越界）。
//
// Validates: Requirements 14.5

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { normalizeAgent } from './normalize';
import { validateAgent } from './validate';
import { AgentErrorCode } from './types';
import { arbitraryAgentDefinition } from './arbitraries';

describe('Property 17: normalization eliminates numeric out-of-range errors', () => {
  it('validateAgent(normalizeAgent(a)) never reports a numeric range error', () => {
    const numericCodes = new Set<AgentErrorCode>([
      AgentErrorCode.AGENT_TEMPERATURE_OUT_OF_RANGE,
      AgentErrorCode.AGENT_TOP_P_OUT_OF_RANGE,
      AgentErrorCode.AGENT_MAX_TOKENS_INVALID,
    ]);

    fc.assert(
      fc.property(arbitraryAgentDefinition, (a) => {
        const { errors } = validateAgent(normalizeAgent(a));
        for (const err of errors) {
          expect(numericCodes.has(err.code)).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });
});
