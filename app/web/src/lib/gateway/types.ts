// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * AI 网关共享类型 — Agent 外部接入的统一协议抽象。
 * 每个协议以 ProtocolAdapter 形状注册到 index.ts 的 ADAPTERS；
 * 密钥只存 localStorage（见 secrets.ts），不进 IndexedDB / 不发 Nuwa 后端。
 */

import type { ExternalProtocol } from '@/store/types';

/** 统一流式请求参数（协议无关）。 */
export interface GatewayStreamArgs {
  baseUrl: string;
  apiKey?: string;
  model?: string;
  system?: string;
  messages: { role: string; content: string }[];
  temperature?: number;
  topP?: number;
  /** Anthropic 的 max_tokens 必填项；OpenAI 兼容协议忽略。 */
  maxTokens?: number;
  signal?: AbortSignal;
  onDelta: (delta: string) => void;
}

/** 连通性探测入参。 */
export interface GatewayProbeArgs {
  baseUrl: string;
  apiKey?: string;
  model?: string;
  signal?: AbortSignal;
}

export interface GatewayProbeResult {
  ok: boolean;
  message: string;
}

/** 协议适配器：新协议（如 ACP）实现该接口后在网关注册即可被 Chat 使用。 */
export interface ProtocolAdapter {
  streamChat: (args: GatewayStreamArgs) => Promise<void>;
  probe: (args: GatewayProbeArgs) => Promise<GatewayProbeResult>;
}

export type { ExternalProtocol };
