// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * Anthropic Messages API 适配器（浏览器直连）。
 * 官方 CORS 支持依赖请求头 `anthropic-dangerous-direct-browser-access: true`，
 * 密钥依旧只在本机 localStorage —— 与 openai 适配器同一安全模型。
 */

import type { GatewayProbeArgs, GatewayProbeResult, GatewayStreamArgs } from './types';
import { probeRequireModel, requireExternalModel } from './requireModel';
import { anthropicMessagesUrl, anthropicModelsUrl, normalizeBaseUrl } from './url';

const ANTHROPIC_VERSION = '2023-06-01';
/** Anthropic 的 max_tokens 为必填；8192 对当前全系模型（≥64k 输出）都安全。 */
const DEFAULT_MAX_TOKENS = 8192;

function anthropicHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
    // 官方开关：明确选择浏览器直连（密钥只在本机），否则 API 拒绝 CORS。
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  if (apiKey) headers['x-api-key'] = apiKey;
  return headers;
}

/**
 * Messages API 只接受 user/assistant 且首条必须为 user：
 * 合并相邻同角色消息，并丢弃开头的 assistant 消息。纯函数，可单测。
 */
export function toAnthropicMessages(
  messages: { role: string; content: string }[],
): { role: 'user' | 'assistant'; content: string }[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    if (out.length === 0 && role === 'assistant') continue;
    const last = out[out.length - 1];
    if (last && last.role === role) {
      last.content = `${last.content}\n\n${m.content}`;
    } else {
      out.push({ role, content: m.content });
    }
  }
  return out;
}

/** Anthropic temperature 合法区间为 [0, 1]（OpenAI 习惯 0..2，这里收口）。 */
function clampTemperature(t: number): number {
  return Math.min(1, Math.max(0, t));
}

/**
 * Stream a chat reply from the Anthropic Messages API.
 * SSE data events: content_block_delta(text_delta) 累积文本，message_stop 结束。
 */
export async function streamAnthropic(args: GatewayStreamArgs): Promise<void> {
  const base = normalizeBaseUrl(args.baseUrl);
  if (!base) throw new Error('缺少外部 Agent 地址');
  const model = requireExternalModel(args.model);

  const messages = toAnthropicMessages(args.messages);
  if (messages.length === 0) throw new Error('对话内容为空');

  const res = await fetch(anthropicMessagesUrl(base), {
    method: 'POST',
    headers: anthropicHeaders(args.apiKey),
    signal: args.signal,
    body: JSON.stringify({
      model,
      max_tokens: args.maxTokens ?? DEFAULT_MAX_TOKENS,
      stream: true,
      messages,
      ...(args.system?.trim() ? { system: args.system.trim() } : {}),
      ...(typeof args.temperature === 'number' ? { temperature: clampTemperature(args.temperature) } : {}),
      ...(typeof args.topP === 'number' ? { top_p: args.topP } : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `外部 Agent HTTP ${res.status}`);
  }

  if (!res.body) throw new Error('外部 Agent 未返回流');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  let reading = true;
  while (reading) {
    const { done, value } = await reader.read();
    if (done) {
      reading = false;
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;
      try {
        const json = JSON.parse(payload) as {
          type?: string;
          delta?: { type?: string; text?: string };
          error?: { message?: string };
        };
        if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
          if (json.delta.text) args.onDelta(json.delta.text);
        } else if (json.type === 'error') {
          throw new Error(json.error?.message || 'Anthropic 流式响应错误');
        } else if (json.type === 'message_stop') {
          return;
        }
      } catch (err) {
        // JSON.parse 失败静默跳过；上面显式抛出的错误继续向外传播。
        if (err instanceof SyntaxError) continue;
        throw err;
      }
    }
  }
}

/** 连通性探测：GET /v1/models，失败则退回一条 max_tokens=1 的最小消息。 */
export async function probeAnthropic(opts: GatewayProbeArgs): Promise<GatewayProbeResult> {
  const base = normalizeBaseUrl(opts.baseUrl);
  if (!base) return { ok: false, message: '请填写 Base URL' };

  const headers = anthropicHeaders(opts.apiKey);

  try {
    const modelsRes = await fetch(anthropicModelsUrl(base), { headers, signal: opts.signal });
    if (modelsRes.ok) {
      return { ok: true, message: '已连通（/v1/models）' };
    }
  } catch {
    /* fall through to messages probe */
  }

  const model = probeRequireModel(opts.model);
  if (!model) {
    return { ok: false, message: '请填写模型 ID' };
  }

  try {
    const res = await fetch(anthropicMessagesUrl(base), {
      method: 'POST',
      headers,
      signal: opts.signal,
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    if (res.ok) return { ok: true, message: '已连通（/v1/messages）' };
    const text = await res.text().catch(() => '');
    return { ok: false, message: text.slice(0, 200) || `HTTP ${res.status}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '连接失败';
    return { ok: false, message: msg };
  }
}
