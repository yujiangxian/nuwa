// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * AI 网关 — 外部 Agent 多协议统一入口。
 *
 * Chat / AgentsPage 只面向本模块的 streamChat / probeExternalAgent，
 * 不直接依赖具体协议实现；新协议在 ADAPTERS 注册即可接入。
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
import { probeXaiOauth, streamXaiOauth } from './xaiOauth';
import { probeClaudeCode, streamClaudeCode } from './claudeCode';
import { probeCursorSdk, streamCursorSdk } from './cursorSdk';

const ADAPTERS: Record<ExternalProtocol, ProtocolAdapter> = {
  'openai-compatible': { streamChat: streamOpenAICompatible, probe: probeOpenAICompatible },
  anthropic: { streamChat: streamAnthropic, probe: probeAnthropic },
  'xai-oauth': { streamChat: streamXaiOauth, probe: probeXaiOauth },
  'claude-code': { streamChat: streamClaudeCode, probe: probeClaudeCode },
  'cursor-sdk': { streamChat: streamCursorSdk, probe: probeCursorSdk },
};

export const DEFAULT_PROTOCOL: ExternalProtocol = 'openai-compatible';

/** 协议选项（UI 下拉展示）。 */
export const PROTOCOL_OPTIONS: { id: ExternalProtocol; label: string; hint: string }[] = [
  { id: 'openai-compatible', label: 'OpenAI 兼容', hint: '/chat/completions（OpenAI、OpenRouter、DeepSeek、Ollama…）' },
  { id: 'anthropic', label: 'Anthropic 原生', hint: '/v1/messages（Claude 系列 HTTP API）' },
  { id: 'xai-oauth', label: 'SuperGrok（订阅 OAuth）', hint: '经 Nuwa 后端使用已购 SuperGrok / Grok Build 登录' },
  { id: 'claude-code', label: 'Claude Code（本机）', hint: '经后端 spawn 本机 claude -p（订阅登录 / API Key）' },
  { id: 'cursor-sdk', label: 'Cursor Agent（本机）', hint: '经后端 spawn Cursor headless agent -p（需 CURSOR_API_KEY）' },
];

const KNOWN: ExternalProtocol[] = [
  'openai-compatible',
  'anthropic',
  'xai-oauth',
  'claude-code',
  'cursor-sdk',
];

/** 解析持久化/导入数据里的协议字段；未知值回退 undefined。 */
export function parseProtocol(value: unknown): ExternalProtocol | undefined {
  return typeof value === 'string' && (KNOWN as string[]).includes(value)
    ? (value as ExternalProtocol)
    : undefined;
}

/** 本机 coding / 订阅代理协议：无需浏览器侧 Base URL。 */
export function isLocalProxyProtocol(protocol: ExternalProtocol | undefined): boolean {
  return protocol === 'xai-oauth' || protocol === 'claude-code' || protocol === 'cursor-sdk';
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
export { XAI_OAUTH_ENDPOINT } from './xaiOauth';
export { CLAUDE_CODE_ENDPOINT } from './claudeCode';
export { CURSOR_SDK_ENDPOINT } from './cursorSdk';
export {
  parseCwdFromEndpoint,
  parsePermissionModeFromEndpoint,
  buildCodingEndpoint,
  isCodingProtocol,
  type CodingPermissionMode,
} from './codingEndpoint';
export type {
  GatewayStreamArgs,
  GatewayProbeArgs,
  GatewayProbeResult,
  ProtocolAdapter,
} from './types';
