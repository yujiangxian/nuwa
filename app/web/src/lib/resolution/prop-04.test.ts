// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-resolution, Property 4: 解析确定性与不可变性
/**
 * Property 4: resolveAgentTools is deterministic (two calls deep-equal) and
 * does not mutate its inputs (serialized agent and tool registry are unchanged
 * across the call).
 *
 * **Validates: Requirements 1.3, 1.4, 9.1, 9.3**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { resolveAgentTools } from './resolve';
import { arbitraryToolRegistryAndAgent } from './arbitraries';

describe('Property 4: 解析确定性与不可变性', () => {
  it('两次调用深相等，且调用前后输入不变', () => {
    fc.assert(
      fc.property(arbitraryToolRegistryAndAgent, ({ toolRegistry, agent }) => {
        const agentBefore = JSON.stringify(agent);
        const registryBefore = JSON.stringify([...toolRegistry.tools]);

        const first = resolveAgentTools(agent, toolRegistry);
        const second = resolveAgentTools(agent, toolRegistry);

        // Determinism: equal inputs yield deep-equal outputs.
        expect(first).toEqual(second);

        // Immutability: inputs unchanged after the calls.
        expect(JSON.stringify(agent)).toBe(agentBefore);
        expect(JSON.stringify([...toolRegistry.tools])).toBe(registryBefore);
      }),
      { numRuns: 100 },
    );
  });
});
