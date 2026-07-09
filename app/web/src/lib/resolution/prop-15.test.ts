// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-resolution, Property 15: 空绑定的平凡解析
/**
 * Property 15: For any agent with an empty Tool_Binding_List and any
 * ToolRegistry, resolveAgentTools yields empty resolved and unresolved sets,
 * validateAgentToolRefs is valid, and agentCapabilities is empty.
 *
 * **Validates: Requirements 9.4**
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';

import { resolveAgentTools } from './resolve';
import { validateAgentToolRefs } from './validate';
import { agentCapabilities } from './capability';
import { arbitraryToolRegistry, arbitraryAgentWithToolIds } from './arbitraries';

describe('Property 15: 空绑定的平凡解析', () => {
  it('空绑定智能体：resolved/unresolved 均空、校验 valid 为真、能力为空', () => {
    fc.assert(
      fc.property(
        arbitraryToolRegistry,
        arbitraryAgentWithToolIds([]),
        (toolRegistry, agent) => {
          const res = resolveAgentTools(agent, toolRegistry);
          if (res.resolved.length !== 0) return false;
          if (res.unresolved.length !== 0) return false;

          if (!validateAgentToolRefs(agent, toolRegistry).valid) return false;

          if (agentCapabilities(agent, toolRegistry).length !== 0) return false;

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});
