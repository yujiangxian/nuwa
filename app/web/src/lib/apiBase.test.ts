// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect } from 'vitest';
import { normalizeApiBaseUrl, joinApiUrl } from '@/lib/apiBase';

describe('apiBase', () => {
  it('normalizeApiBaseUrl strips trailing slashes and whitespace', () => {
    expect(normalizeApiBaseUrl(' http://localhost:8080/ ')).toBe('http://localhost:8080');
    expect(normalizeApiBaseUrl('https://api.example.com///')).toBe('https://api.example.com');
    expect(normalizeApiBaseUrl('   ')).toBe('');
  });

  it('joinApiUrl uses relative paths when base is empty', () => {
    expect(joinApiUrl('', '/api/config')).toBe('/api/config');
    expect(joinApiUrl('  ', 'api/config')).toBe('/api/config');
  });

  it('joinApiUrl prefixes absolute base', () => {
    expect(joinApiUrl('http://localhost:8080/', '/api/config')).toBe(
      'http://localhost:8080/api/config',
    );
  });
});
