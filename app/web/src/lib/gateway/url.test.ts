// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect } from 'vitest';
import { normalizeBaseUrl, anthropicMessagesUrl, anthropicModelsUrl } from '@/lib/gateway/url';

describe('gateway/url', () => {
  it('normalizeBaseUrl strips whitespace and trailing slashes', () => {
    expect(normalizeBaseUrl(' https://api.example.com/v1/ ')).toBe('https://api.example.com/v1');
    expect(normalizeBaseUrl('https://api.example.com///')).toBe('https://api.example.com');
    expect(normalizeBaseUrl('   ')).toBe('');
  });

  it('anthropicMessagesUrl handles base with and without /v1 suffix', () => {
    expect(anthropicMessagesUrl('https://api.anthropic.com')).toBe('https://api.anthropic.com/v1/messages');
    expect(anthropicMessagesUrl('https://api.anthropic.com/v1')).toBe('https://api.anthropic.com/v1/messages');
    expect(anthropicMessagesUrl('https://api.anthropic.com/v1/')).toBe('https://api.anthropic.com/v1/messages');
  });

  it('anthropicModelsUrl handles base with and without /v1 suffix', () => {
    expect(anthropicModelsUrl('https://api.anthropic.com')).toBe('https://api.anthropic.com/v1/models');
    expect(anthropicModelsUrl('https://api.anthropic.com/v1')).toBe('https://api.anthropic.com/v1/models');
  });
});
