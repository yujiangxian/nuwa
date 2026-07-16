// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * 对话页模型标签：只反映真实配置 / Agent 设定，不伪造具体模型名。
 */

import type { Agent, ExternalProtocol } from '@/store/types';
import { PROTOCOL_OPTIONS } from '@/lib/gateway';

const UNSELECTED = '未选择模型';

function stripLlmPrefix(id: string): string {
  return id.replace(/^llm\//, '');
}

function protocolLabel(protocol: ExternalProtocol | undefined): string {
  if (!protocol) return '外部模型';
  return PROTOCOL_OPTIONS.find((o) => o.id === protocol)?.label ?? protocol;
}

export type ConfigLlmFields = {
  current_models?: { llm?: string | null } | null;
  current_llm_model?: string | null;
};

/** 从后端 config 取当前本地 LLM（可为空）。 */
export function configLlmModelId(config: ConfigLlmFields | null | undefined): string | undefined {
  const raw = config?.current_models?.llm ?? config?.current_llm_model;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed || undefined;
}

/**
 * 顶栏 / 流式状态栏展示用标签。
 * - 外部 Agent：externalModel，否则协议短名
 * - 本地 / 工作流：配置中的 LLM，否则「未选择模型」
 */
export function displayModelLabel(
  agent: Agent | undefined,
  config: ConfigLlmFields | null | undefined,
): string {
  if (agent?.kind === 'external') {
    const model = agent.externalModel?.trim();
    if (model) return stripLlmPrefix(model);
    return protocolLabel(agent.protocol);
  }
  const id = configLlmModelId(config);
  return id ? stripLlmPrefix(id) : UNSELECTED;
}

export { UNSELECTED as DISPLAY_MODEL_UNSELECTED };
