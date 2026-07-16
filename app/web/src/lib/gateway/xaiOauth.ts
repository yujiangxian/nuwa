// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * SuperGrok 订阅 OAuth 协议适配器。
 * 浏览器不直连 api.x.ai；一律经 Nuwa 后端 `/api/xai/*` 代理。
 */

import { apiAuthHeaders, apiUrl } from '@/api/client';
import type { GatewayProbeArgs, GatewayProbeResult, GatewayStreamArgs } from './types';
import { requireExternalModel } from './requireModel';

/** Sentinel endpoint stored on Agent (backend ignores it). */
export const XAI_OAUTH_ENDPOINT = 'nuwa://xai-oauth';

export async function streamXaiOauth(args: GatewayStreamArgs): Promise<void> {
  const model = requireExternalModel(args.model);
  const res = await fetch(apiUrl('/api/xai/chat/stream'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...apiAuthHeaders(),
    },
    signal: args.signal,
    body: JSON.stringify({
      model,
      system: args.system,
      messages: args.messages,
      temperature: args.temperature,
      top_p: args.topP,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `SuperGrok HTTP ${res.status}`);
  }
  if (!res.body) throw new Error('SuperGrok 未返回流');

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
        /* skip */
      }
    }
  }
}

export async function probeXaiOauth(_opts: GatewayProbeArgs): Promise<GatewayProbeResult> {
  try {
    const res = await fetch(apiUrl('/api/xai/status'), {
      headers: { ...apiAuthHeaders() },
      signal: _opts.signal,
    });
    if (!res.ok) {
      return { ok: false, message: `后端不可达 (${res.status})` };
    }
    const data = (await res.json()) as { connected?: boolean; email?: string; models?: string[] };
    if (!data.connected) {
      return { ok: false, message: '尚未连接 SuperGrok（设置页导入 Grok Build 或设备码登录）' };
    }
    const n = data.models?.length ?? 0;
    return {
      ok: true,
      message: `已连接${data.email ? ` · ${data.email}` : ''} · ${n} 个模型`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '探测失败' };
  }
}
