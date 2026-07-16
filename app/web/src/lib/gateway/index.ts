// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * AI 网关 — 外部 Agent 多协议统一入口。
 *
 * Chat / AgentsPage 只面向本模块的 streamChat / probeExternalAgent，
 * 不直接依赖具体协议实现；新协议（如 ACP）在 ADAPTERS 注册即可接入。
 */

import type {
  ExternalProtocol,
  GatewayProbeArgs,
  GatewayProbeResult,
  GatewayStreamArgs,
  ProtocolAdapter,
} from './types';
import { probeOpenAICompatible, streamOpenAICompatible } from './openai';
import { probeAnthropic, streamAnthropic } from './anthropic';

const ADAPTERS: Record<ExternalProtocol, ProtocolAdapter> = {
  'openai-compatible': { streamChat: streamOpenAICompatible, probe: probeOpenAICompatible },
  anthropic: { streamChat: streamAnthropic, probe: probeAnthropic },
};

export const DEFAULT_PROTOCOL: ExternalProtocol = 'openai-compatible';

/** 协议选项（UI 下拉展示）。 */
export const PROTOCOL_OPTIONS: { id: ExternalProtocol; label: string; hint: string }[] = [
  { id: 'openai-compatible', label: 'OpenAI 兼容', hint: '/chat/completions（OpenAI、OpenRouter、DeepSeek、Ollama…）' },
  { id: 'anthropic', label: 'Anthropic 原生', hint: '/v1/messages（Claude 系列）' },
];

/** 解析持久化/导入数据里的协议字段；未知值回退 undefined。 */
export function parseProtocol(value: unknown): ExternalProtocol | undefined {
  return value === 'openai-compatible' || value === 'anthropic' ? value : undefined;
}

/** 按协议流式对话（外部 Agent 唯一调用入口）。 */
export function streamChat(
  protocol: ExternalProtocol | undefined,
  args: GatewayStreamArgs,
): Promise<void> {
  return ADAPTERS[protocol ?? DEFAULT_PROTOCOL].streamChat(args);
}

/** 按协议做连通性探测。 */
export function probeExternalAgent(
  protocol: ExternalProtocol | undefined,
  args: GatewayProbeArgs,
): Promise<GatewayProbeResult> {
  return ADAPTERS[protocol ?? DEFAULT_PROTOCOL].probe(args);
}

export { normalizeBaseUrl } from './url';
export {
  externalSecretKey,
  loadExternalApiKey,
  saveExternalApiKey,
  deleteExternalApiKey,
} from './secrets';
export { PROVIDER_PRESETS, type ProviderPreset } from './presets';
export type {
  GatewayStreamArgs,
  GatewayProbeArgs,
  GatewayProbeResult,
  ProtocolAdapter,
} from './types';
