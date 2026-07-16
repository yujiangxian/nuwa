// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * Claude Code 本机协议 — 经 Nuwa 后端 spawn `claude -p`。
 */

import { apiAuthHeaders, apiUrl } from '@/api/client';
import type { GatewayProbeArgs, GatewayProbeResult, GatewayStreamArgs } from './types';
import {
  parseCwdFromEndpoint,
  parsePermissionModeFromEndpoint,
} from './codingEndpoint';

export const CLAUDE_CODE_ENDPOINT = 'nuwa://claude-code';

export { parseCwdFromEndpoint, parsePermissionModeFromEndpoint } from './codingEndpoint';

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

export async function streamClaudeCode(args: GatewayStreamArgs): Promise<void> {
  const res = await fetch(apiUrl('/api/coding/claude/stream'), {
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
    throw new Error(text || `Claude Code HTTP ${res.status}`);
  }
  await readSseDeltas(res, args.onDelta);
}

export async function probeClaudeCode(_opts: GatewayProbeArgs): Promise<GatewayProbeResult> {
  try {
    const res = await fetch(apiUrl('/api/coding/claude/status'), {
      headers: { ...apiAuthHeaders() },
      signal: _opts.signal,
    });
    if (!res.ok) return { ok: false, message: `后端不可达 (${res.status})` };
    const data = (await res.json()) as {
      available?: boolean;
      message?: string;
      version?: string;
      binary?: string;
    };
    if (!data.available) {
      return { ok: false, message: data.message || '未检测到 Claude Code CLI' };
    }
    const ver = data.version ? ` · ${data.version}` : '';
    return { ok: true, message: `${data.message || '可用'}${ver}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '连接失败';
    return { ok: false, message: msg };
  }
}
