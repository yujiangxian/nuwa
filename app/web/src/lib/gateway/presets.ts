// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * 提供商预设 — AgentsPage 一键填充 协议/Base URL/默认模型。
 * 仅是表单初值，用户可自由改写；模型 id 会过时，以各家 /models 为准。
 */

import type { ExternalProtocol } from '@/store/types';

export interface ProviderPreset {
  id: string;
  label: string;
  protocol: ExternalProtocol;
  baseUrl: string;
  defaultModel: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-6',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    protocol: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek（OpenAI 兼容）',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-v4-pro',
  },
  {
    id: 'deepseek-anthropic',
    label: 'DeepSeek（Anthropic 兼容）',
    protocol: 'anthropic',
    baseUrl: 'https://api.deepseek.com/anthropic',
    defaultModel: 'deepseek-v4-pro',
  },
  {
    id: 'ollama',
    label: 'Ollama（本机）',
    protocol: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: '',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio（本机）',
    protocol: 'openai-compatible',
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: '',
  },
  {
    id: 'xai-supergrok',
    label: 'xAI SuperGrok（订阅）',
    protocol: 'xai-oauth',
    baseUrl: 'nuwa://xai-oauth',
    defaultModel: 'grok-build-0.1',
  },
  {
    id: 'claude-code',
    label: 'Claude Code（本机）',
    protocol: 'claude-code',
    baseUrl: 'nuwa://claude-code',
    defaultModel: 'sonnet',
  },
  {
    id: 'cursor-agent',
    label: 'Cursor Agent（本机）',
    protocol: 'cursor-sdk',
    baseUrl: 'nuwa://cursor-sdk',
    defaultModel: 'composer-2.5',
  },
];
