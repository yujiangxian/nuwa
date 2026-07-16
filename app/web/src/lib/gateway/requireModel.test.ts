// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, expect, it } from 'vitest';
import { probeRequireModel, requireExternalModel } from './requireModel';

describe('requireExternalModel', () => {
  it('returns trimmed model', () => {
    expect(requireExternalModel('  gpt-4o-mini  ')).toBe('gpt-4o-mini');
  });

  it('throws when empty', () => {
    expect(() => requireExternalModel('')).toThrow('请填写模型 ID');
    expect(() => requireExternalModel('   ')).toThrow('请填写模型 ID');
    expect(() => requireExternalModel(undefined)).toThrow('请填写模型 ID');
  });
});

describe('probeRequireModel', () => {
  it('returns null when empty', () => {
    expect(probeRequireModel('')).toBeNull();
    expect(probeRequireModel(null)).toBeNull();
  });
});
