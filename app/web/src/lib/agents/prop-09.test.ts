// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-definition-registry, Property 9: validateAgent 逐类违规检测
import { describe, it } from 'vitest';
import fc from 'fast-check';
import { validateAgent } from './validate';
import { AgentErrorCode, SYSTEM_PROMPT_MAX_LENGTH } from './types';
import type { AgentDefinition } from './types';
import { arbitraryValidAgentDefinition } from './arbitraries';

/** Build a copy of base whose model.params has the given field overridden. */
function withParam(
  base: AgentDefinition,
  field: 'temperature' | 'maxTokens' | 'topP',
  value: number
): AgentDefinition {
  return {
    ...base,
    model: { ...base.model, params: { ...base.model.params, [field]: value } },
  };
}

describe('Property 9: validateAgent detects each violation class', () => {
  it('produces the correct AgentErrorCode and location for a single-point injected violation', () => {
    // **Validates: Requirements 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8**
    fc.assert(
      fc.property(arbitraryValidAgentDefinition, (base) => {
        // Empty id -> AGENT_EMPTY_ID (field=id).
        {
          const errs = validateAgent({ ...base, id: '' }).errors;
          if (
            !errs.some(
              (e) => e.code === AgentErrorCode.AGENT_EMPTY_ID && e.location.field === 'id'
            )
          )
            return false;
        }

        // Empty name -> AGENT_EMPTY_NAME (field=name).
        {
          const errs = validateAgent({ ...base, name: '' }).errors;
          if (
            !errs.some(
              (e) => e.code === AgentErrorCode.AGENT_EMPTY_NAME && e.location.field === 'name'
            )
          )
            return false;
        }

        // temperature out of [0,2] -> AGENT_TEMPERATURE_OUT_OF_RANGE (field=temperature).
        for (const t of [3, -1]) {
          const errs = validateAgent(withParam(base, 'temperature', t)).errors;
          if (
            !errs.some(
              (e) =>
                e.code === AgentErrorCode.AGENT_TEMPERATURE_OUT_OF_RANGE &&
                e.location.field === 'temperature'
            )
          )
            return false;
        }

        // maxTokens not an integer >= 1 -> AGENT_MAX_TOKENS_INVALID (field=maxTokens).
        for (const m of [0, 1.5]) {
          const errs = validateAgent(withParam(base, 'maxTokens', m)).errors;
          if (
            !errs.some(
              (e) =>
                e.code === AgentErrorCode.AGENT_MAX_TOKENS_INVALID &&
                e.location.field === 'maxTokens'
            )
          )
            return false;
        }

        // topP out of [0,1] -> AGENT_TOP_P_OUT_OF_RANGE (field=topP).
        {
          const errs = validateAgent(withParam(base, 'topP', 1.5)).errors;
          if (
            !errs.some(
              (e) =>
                e.code === AgentErrorCode.AGENT_TOP_P_OUT_OF_RANGE && e.location.field === 'topP'
            )
          )
            return false;
        }

        // Duplicate tool binding -> AGENT_DUPLICATE_TOOL_BINDING (location.toolId === 'x').
        {
          const errs = validateAgent({
            ...base,
            tools: [{ toolId: 'x' }, { toolId: 'x' }],
          }).errors;
          if (
            !errs.some(
              (e) =>
                e.code === AgentErrorCode.AGENT_DUPLICATE_TOOL_BINDING &&
                e.location.toolId === 'x'
            )
          )
            return false;
        }

        // System prompt too long -> AGENT_SYSTEM_PROMPT_TOO_LONG (field=systemPrompt).
        {
          const errs = validateAgent({
            ...base,
            systemPrompt: 'x'.repeat(SYSTEM_PROMPT_MAX_LENGTH + 1),
          }).errors;
          if (
            !errs.some(
              (e) =>
                e.code === AgentErrorCode.AGENT_SYSTEM_PROMPT_TOO_LONG &&
                e.location.field === 'systemPrompt'
            )
          )
            return false;
        }

        return true;
      }),
      { numRuns: 100 }
    );
  });
});
