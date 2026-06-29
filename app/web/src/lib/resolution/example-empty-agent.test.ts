// Feature: agent-tool-resolution, Example: 空绑定智能体的平凡解析
/**
 * Example/edge test for an agent with no tool bindings (tools: []) against an
 * empty ToolRegistry. resolveAgentTools yields empty resolved/unresolved,
 * validateAgentToolRefs is valid, and agentCapabilities is empty.
 *
 * **Validates: Requirements 9.4**
 */

import { describe, it, expect } from 'vitest';

import { resolveAgentTools } from './resolve';
import { validateAgentToolRefs } from './validate';
import { agentCapabilities } from './capability';
import type { AgentDefinition } from '../agents/types';
import type { ToolRegistry } from '../tools/types';

/** A minimal, legal AgentDefinition with an empty tool-binding list. */
const emptyAgent: AgentDefinition = {
  id: 'agent-empty',
  name: 'Empty Agent',
  role: '',
  systemPrompt: '',
  model: {
    modelId: 'model-1',
    params: { temperature: 1, maxTokens: 256, topP: 1 },
  },
  tools: [],
  voice: null,
  tags: [],
};

/** An empty ToolRegistry. */
const emptyRegistry: ToolRegistry = { tools: new Map() };

describe('Example: 空绑定智能体的平凡解析', () => {
  it('resolveAgentTools 的 resolved 与 unresolved 均为空，agentId 等于 agent.id', () => {
    const res = resolveAgentTools(emptyAgent, emptyRegistry);
    expect(res.agentId).toBe('agent-empty');
    expect(res.resolved).toEqual([]);
    expect(res.unresolved).toEqual([]);
  });

  it('validateAgentToolRefs.valid 为真且无错误', () => {
    const result = validateAgentToolRefs(emptyAgent, emptyRegistry);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('agentCapabilities 为空', () => {
    expect(agentCapabilities(emptyAgent, emptyRegistry)).toEqual([]);
  });
});
