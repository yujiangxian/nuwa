// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-system, Property 22: 桥接确定且不变
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

import { toolConfigToToolName, isToolReferencedBy } from './bind';
import type { ToolConfig } from '../workflow/nodeTypes/configTypes';
import type { AgentDefinition, ToolBinding } from '../agents/types';
import { arbitraryValidToolDefinition } from './arbitraries';

/** Build a minimal valid AgentDefinition with the given tool bindings. */
function makeAgent(toolIds: readonly string[]): AgentDefinition {
  const tools: readonly ToolBinding[] = toolIds.map((toolId) => ({ toolId }));
  return {
    id: 'agent-id',
    name: 'agent-name',
    role: '',
    systemPrompt: '',
    model: { modelId: 'model-id', params: { temperature: 0.5, maxTokens: 256, topP: 0.9 } },
    tools,
    voice: null,
    tags: [],
  };
}

/**
 * Validates: Requirements 15.1, 15.2, 15.3, 15.4
 *
 * toolConfigToToolName returns c.toolName; isToolReferencedBy is true exactly
 * when the agent's Tool_Binding_List contains a binding with toolId === t.id.
 * Both functions are deterministic and do not mutate their inputs.
 */
describe('Property 22: 桥接确定且不变', () => {
  it('toolConfigToToolName returns toolName, deterministically and without mutation', () => {
    fc.assert(
      fc.property(fc.string(), (toolName) => {
        const config: ToolConfig = { kind: 'tool', toolName, argumentBindings: [] };
        const before = JSON.stringify(config);

        expect(toolConfigToToolName(config)).toBe(toolName);
        // Deterministic.
        expect(toolConfigToToolName(config)).toBe(toolConfigToToolName(config));
        // Input unchanged.
        expect(JSON.stringify(config)).toBe(before);
      }),
      { numRuns: 100 },
    );
  });

  it('isToolReferencedBy holds iff a binding references the tool id, deterministically and without mutation', () => {
    fc.assert(
      fc.property(
        arbitraryValidToolDefinition,
        fc.array(fc.string()),
        (tool, toolIds) => {
          const agent = makeAgent(toolIds);
          const expected = toolIds.includes(tool.id);

          const beforeTool = JSON.stringify(tool);
          const beforeAgent = JSON.stringify(agent);

          expect(isToolReferencedBy(tool, agent)).toBe(expected);
          // Deterministic.
          expect(isToolReferencedBy(tool, agent)).toBe(isToolReferencedBy(tool, agent));
          // Inputs unchanged.
          expect(JSON.stringify(tool)).toBe(beforeTool);
          expect(JSON.stringify(agent)).toBe(beforeAgent);
        },
      ),
      { numRuns: 100 },
    );
  });
});
