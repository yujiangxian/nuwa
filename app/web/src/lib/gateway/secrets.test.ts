// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  externalSecretKey,
  saveExternalApiKey,
  loadExternalApiKey,
  deleteExternalApiKey,
} from '@/lib/gateway/secrets';

describe('gateway/secrets', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('stores api key only in localStorage (trimmed)', () => {
    saveExternalApiKey('a1', ' sk-test ');
    expect(loadExternalApiKey('a1')).toBe('sk-test');
    expect(localStorage.getItem(externalSecretKey('a1'))).toBe('sk-test');
    deleteExternalApiKey('a1');
    expect(loadExternalApiKey('a1')).toBe('');
  });

  it('saving an empty key removes the entry', () => {
    saveExternalApiKey('a2', 'sk-x');
    saveExternalApiKey('a2', '   ');
    expect(localStorage.getItem(externalSecretKey('a2'))).toBeNull();
  });
});
