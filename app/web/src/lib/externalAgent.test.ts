// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  normalizeBaseUrl,
  externalSecretKey,
  saveExternalApiKey,
  loadExternalApiKey,
  deleteExternalApiKey,
  streamOpenAICompatible,
  probeExternalAgent,
} from '@/lib/externalAgent';

describe('externalAgent', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('normalizeBaseUrl strips trailing slashes', () => {
    expect(normalizeBaseUrl(' https://api.example.com/v1/ ')).toBe('https://api.example.com/v1');
  });

  it('stores api key only in localStorage', () => {
    saveExternalApiKey('a1', ' sk-test ');
    expect(loadExternalApiKey('a1')).toBe('sk-test');
    expect(localStorage.getItem(externalSecretKey('a1'))).toBe('sk-test');
    deleteExternalApiKey('a1');
    expect(loadExternalApiKey('a1')).toBe('');
  });

  it('streamOpenAICompatible parses SSE deltas', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"世界"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const stream = new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: stream,
    }));

    let text = '';
    await streamOpenAICompatible({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk',
      messages: [{ role: 'user', content: 'hi' }],
      onDelta: (d) => { text += d; },
    });
    expect(text).toBe('你好世界');
    expect(fetch).toHaveBeenCalled();
  });

  it('probeExternalAgent succeeds on /models', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const r = await probeExternalAgent({ baseUrl: 'https://api.example.com/v1', apiKey: 'x' });
    expect(r.ok).toBe(true);
  });
});
