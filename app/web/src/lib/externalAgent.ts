// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * V3: OpenAI-compatible external Agent client (browser-side).
 * API keys stay in localStorage only — never sent to Nuwa backend.
 */

const SECRET_PREFIX = 'nuwa_agent_secret:';

export function externalSecretKey(agentId: string): string {
  return `${SECRET_PREFIX}${agentId}`;
}

export function loadExternalApiKey(agentId: string): string {
  try {
    return localStorage.getItem(externalSecretKey(agentId)) ?? '';
  } catch {
    return '';
  }
}

export function saveExternalApiKey(agentId: string, apiKey: string): void {
  try {
    const key = externalSecretKey(agentId);
    if (!apiKey.trim()) localStorage.removeItem(key);
    else localStorage.setItem(key, apiKey.trim());
  } catch {
    /* ignore quota / private mode */
  }
}

export function deleteExternalApiKey(agentId: string): void {
  try {
    localStorage.removeItem(externalSecretKey(agentId));
  } catch {
    /* ignore */
  }
}

export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

export type ExternalProtocol = 'openai-compatible';

export interface StreamExternalArgs {
  baseUrl: string;
  apiKey?: string;
  model?: string;
  system?: string;
  messages: { role: string; content: string }[];
  temperature?: number;
  topP?: number;
  signal?: AbortSignal;
  onDelta: (delta: string) => void;
}

/**
 * Stream chat completions from an OpenAI-compatible endpoint.
 * Expects SSE lines: data: {...} with choices[0].delta.content
 */
export async function streamOpenAICompatible(args: StreamExternalArgs): Promise<void> {
  const base = normalizeBaseUrl(args.baseUrl);
  if (!base) throw new Error('缺少外部 Agent 地址');

  const url = `${base}/chat/completions`;
  const bodyMessages = [...args.messages];
  if (args.system?.trim()) {
    bodyMessages.unshift({ role: 'system', content: args.system.trim() });
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (args.apiKey) headers.Authorization = `Bearer ${args.apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    signal: args.signal,
    body: JSON.stringify({
      model: args.model || 'gpt-4o-mini',
      stream: true,
      messages: bodyMessages,
      ...(typeof args.temperature === 'number' ? { temperature: args.temperature } : {}),
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
      if (payload === '[DONE]') return;
      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = json.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) args.onDelta(delta);
      } catch {
        /* skip malformed chunk */
      }
    }
  }
}

export interface ProbeExternalResult {
  ok: boolean;
  message: string;
}

/** Lightweight connectivity check: POST a tiny non-stream completion (or GET /models). */
export async function probeExternalAgent(opts: {
  baseUrl: string;
  apiKey?: string;
  model?: string;
  signal?: AbortSignal;
}): Promise<ProbeExternalResult> {
  const base = normalizeBaseUrl(opts.baseUrl);
  if (!base) return { ok: false, message: '请填写 Base URL' };

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;

  try {
    const modelsRes = await fetch(`${base}/models`, { headers, signal: opts.signal });
    if (modelsRes.ok) {
      return { ok: true, message: '已连通（/models）' };
    }
  } catch {
    /* fall through to chat probe */
  }

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      signal: opts.signal,
      body: JSON.stringify({
        model: opts.model || 'gpt-4o-mini',
        stream: false,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    if (res.ok) return { ok: true, message: '已连通（chat/completions）' };
    const text = await res.text().catch(() => '');
    return { ok: false, message: text.slice(0, 200) || `HTTP ${res.status}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '连接失败';
    return { ok: false, message: msg };
  }
}
