// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  streamChat,
  probeExternalAgent,
  parseProtocol,
  PROTOCOL_OPTIONS,
  PROVIDER_PRESETS,
  DEFAULT_PROTOCOL,
} from '@/lib/gateway';

describe('gateway registry', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parseProtocol accepts known protocols and rejects the rest', () => {
    expect(parseProtocol('openai-compatible')).toBe('openai-compatible');
    expect(parseProtocol('anthropic')).toBe('anthropic');
    expect(parseProtocol('acp')).toBeUndefined();
    expect(parseProtocol(42)).toBeUndefined();
    expect(parseProtocol(undefined)).toBeUndefined();
  });

  it('every provider preset uses a registered protocol', () => {
    const ids = new Set(PROTOCOL_OPTIONS.map((o) => o.id));
    for (const p of PROVIDER_PRESETS) {
      expect(ids.has(p.protocol)).toBe(true);
    }
  });

  it('streamChat dispatches by protocol (openai path vs anthropic path)', async () => {
    // 每次调用都返回新的流：ReadableStream 一经读取即锁定，不能跨调用复用。
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve({
      ok: true,
      body: new ReadableStream({ start: (c) => c.close() }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await streamChat(undefined, {
      baseUrl: 'https://x.example.com/v1',
      messages: [{ role: 'user', content: 'hi' }],
      onDelta: () => {},
    });
    expect(fetchMock.mock.calls[0][0]).toBe('https://x.example.com/v1/chat/completions');

    await streamChat('anthropic', {
      baseUrl: 'https://y.example.com',
      messages: [{ role: 'user', content: 'hi' }],
      onDelta: () => {},
    });
    expect(fetchMock.mock.calls[1][0]).toBe('https://y.example.com/v1/messages');
  });

  it('probeExternalAgent defaults to the openai adapter', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const r = await probeExternalAgent(DEFAULT_PROTOCOL, { baseUrl: 'https://x.example.com/v1' });
    expect(r.ok).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe('https://x.example.com/v1/models');
  });
});
