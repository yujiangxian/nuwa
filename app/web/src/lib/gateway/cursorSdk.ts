// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * Cursor Agent 本机协议 — 经 Nuwa 后端 spawn Cursor headless `agent -p`。
 */

import { apiAuthHeaders, apiUrl } from '@/api/client';
import type { GatewayProbeArgs, GatewayProbeResult, GatewayStreamArgs } from './types';
import {
  parseCwdFromEndpoint,
  parsePermissionModeFromEndpoint,
} from './codingEndpoint';

export const CURSOR_SDK_ENDPOINT = 'nuwa://cursor-sdk';

async function readSseDeltas(
  res: Response,
  onDelta: (delta: string) => void,
): Promise<void> {
  if (!res.body) throw new Error('未返回流');
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
          error?: { message?: string };
        };
        if (json.error?.message) throw new Error(json.error.message);
        const delta = json.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) onDelta(delta);
      } catch (err) {
        if (err instanceof SyntaxError) continue;
        throw err;
      }
    }
  }
}

export async function streamCursorSdk(args: GatewayStreamArgs): Promise<void> {
  const res = await fetch(apiUrl('/api/coding/cursor/stream'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...apiAuthHeaders(),
    },
    signal: args.signal,
    body: JSON.stringify({
      model: args.model?.trim() || undefined,
      system: args.system,
      messages: args.messages,
      cwd: parseCwdFromEndpoint(args.baseUrl),
      permission_mode: parsePermissionModeFromEndpoint(args.baseUrl),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Cursor Agent HTTP ${res.status}`);
  }
  await readSseDeltas(res, args.onDelta);
}

export async function probeCursorSdk(_opts: GatewayProbeArgs): Promise<GatewayProbeResult> {
  try {
    const res = await fetch(apiUrl('/api/coding/cursor/status'), {
      headers: { ...apiAuthHeaders() },
      signal: _opts.signal,
    });
    if (!res.ok) return { ok: false, message: `后端不可达 (${res.status})` };
    const data = (await res.json()) as {
      available?: boolean;
      message?: string;
      version?: string;
      api_key_configured?: boolean;
    };
    if (!data.available) {
      return { ok: false, message: data.message || '未检测到 Cursor Agent CLI' };
    }
    // Key 可选：本机 `agent login` 订阅登录态也可。探测成功以 CLI available 为准。
    const ver = data.version ? ` · ${data.version}` : '';
    const hint = data.api_key_configured
      ? ''
      : '（未存 Key：将尝试本机 agent login）';
    return { ok: true, message: `${data.message || '可用'}${ver}${hint}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '连接失败';
    return { ok: false, message: msg };
  }
}
