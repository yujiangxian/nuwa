// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, afterEach, vi } from 'vitest';
import { streamAnthropic, probeAnthropic, toAnthropicMessages } from '@/lib/gateway/anthropic';

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
      controller.close();
    },
  });
}

describe('gateway/anthropic', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('toAnthropicMessages merges consecutive roles and drops leading assistant', () => {
    expect(toAnthropicMessages([
      { role: 'assistant', content: '开场白' },
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
      { role: 'assistant', content: 'c' },
    ])).toEqual([
      { role: 'user', content: 'a\n\nb' },
      { role: 'assistant', content: 'c' },
    ]);
  });

  it('streamAnthropic parses content_block_delta events until message_stop', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: sseStream([
        'event: message_start\ndata: {"type":"message_start"}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"你好"}}\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Claude"}}\n\n',
        'data: {"type":"message_stop"}\n\n',
      ]),
    });
    vi.stubGlobal('fetch', fetchMock);

    let text = '';
    await streamAnthropic({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-ant',
      model: 'claude-sonnet-4-6',
      system: '你是助手',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 1.4,
      onDelta: (d) => { text += d; },
    });
    expect(text).toBe('你好Claude');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.system).toBe('你是助手');
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.temperature).toBe(1); // clamped to Anthropic [0,1]
    expect(body.stream).toBe(true);
  });

  it('streamAnthropic surfaces error events', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: sseStream([
        'data: {"type":"error","error":{"message":"overloaded"}}\n\n',
      ]),
    }));
    await expect(streamAnthropic({
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      onDelta: () => {},
    })).rejects.toThrow('overloaded');
  });

  it('streamAnthropic throws on HTTP error with body text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('invalid x-api-key'),
    }));
    await expect(streamAnthropic({
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      onDelta: () => {},
    })).rejects.toThrow('invalid x-api-key');
  });

  it('streamAnthropic rejects empty model', async () => {
    await expect(streamAnthropic({
      baseUrl: 'https://api.anthropic.com',
      messages: [{ role: 'user', content: 'hi' }],
      onDelta: () => {},
    })).rejects.toThrow('请填写模型 ID');
  });

  it('probeAnthropic succeeds on /v1/models', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const r = await probeAnthropic({ baseUrl: 'https://api.anthropic.com', apiKey: 'x' });
    expect(r.ok).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/models');
  });
});
