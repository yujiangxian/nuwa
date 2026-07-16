// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, afterEach, vi } from 'vitest';
import { streamOpenAICompatible, probeOpenAICompatible } from '@/lib/gateway/openai';

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
      controller.close();
    },
  });
}

describe('gateway/openai', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('streamOpenAICompatible parses SSE deltas', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: sseStream([
        'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"世界"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    }));

    let text = '';
    await streamOpenAICompatible({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
      onDelta: (d) => { text += d; },
    });
    expect(text).toBe('你好世界');
  });

  it('rejects empty model instead of inventing a default', async () => {
    await expect(streamOpenAICompatible({
      baseUrl: 'https://api.example.com/v1',
      messages: [{ role: 'user', content: 'hi' }],
      onDelta: () => {},
    })).rejects.toThrow('请填写模型 ID');
  });

  it('prepends system message and sends bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: sseStream(['data: [DONE]\n\n']) });
    vi.stubGlobal('fetch', fetchMock);

    await streamOpenAICompatible({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-abc',
      model: 'gpt-4o-mini',
      system: '你是助手',
      messages: [{ role: 'user', content: 'hi' }],
      onDelta: () => {},
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-abc');
    const body = JSON.parse(String(init.body)) as { messages: { role: string; content: string }[] };
    expect(body.messages[0]).toEqual({ role: 'system', content: '你是助手' });
  });

  it('probeOpenAICompatible succeeds on /models', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const r = await probeOpenAICompatible({ baseUrl: 'https://api.example.com/v1', apiKey: 'x' });
    expect(r.ok).toBe(true);
  });

  it('probeOpenAICompatible reports failure text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('unauthorized'),
    }));
    const r = await probeOpenAICompatible({
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4o-mini',
    });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('unauthorized');
  });

  it('probeOpenAICompatible requires model when /models fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, text: () => Promise.resolve('no') }));
    const r = await probeOpenAICompatible({ baseUrl: 'https://api.example.com/v1' });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('请填写模型 ID');
  });
});
