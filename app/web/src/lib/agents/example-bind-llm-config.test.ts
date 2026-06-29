// Feature: agent-definition-registry, Example: 绑定具体 agent 到 LlmConfig 节点配置
import { describe, it, expect } from 'vitest';
import { bindAgentToNodeConfig } from './bind';
import type { AgentDefinition } from './types';
import type { LlmConfig } from '../workflow/nodeTypes/configTypes';

describe('example: bindAgentToNodeConfig projects agent-derived fields', () => {
  const agent: AgentDefinition = {
    id: 'agent-1',
    name: 'Socrates',
    role: 'tutor',
    systemPrompt: 'hello',
    model: {
      modelId: 'gpt-x',
      params: { temperature: 0.7, maxTokens: 256, topP: 0.9 },
    },
    tools: [{ toolId: 'search' }],
    voice: null,
    tags: ['edu'],
  };

  const nodeConfig: LlmConfig = {
    kind: 'llm',
    modelId: 'old',
    systemPrompt: 'old',
    temperature: 0.1,
    maxTokens: 1,
  };

  it('binds the four agent-derived fields', () => {
    const bound = bindAgentToNodeConfig(agent, nodeConfig);
    expect(bound.modelId).toBe(agent.model.modelId);
    expect(bound.systemPrompt).toBe(agent.systemPrompt);
    expect(bound.temperature).toBe(0.7);
    expect(bound.maxTokens).toBe(256);
  });

  it('does not mutate the input nodeConfig', () => {
    bindAgentToNodeConfig(agent, nodeConfig);
    expect(nodeConfig.modelId).toBe('old');
    expect(nodeConfig.systemPrompt).toBe('old');
    expect(nodeConfig.temperature).toBe(0.1);
    expect(nodeConfig.maxTokens).toBe(1);
  });
});
