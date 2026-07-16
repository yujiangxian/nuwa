// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, expect, it } from 'vitest';
import {
  buildCodingEndpoint,
  parseCwdFromEndpoint,
  parsePermissionModeFromEndpoint,
} from './codingEndpoint';

describe('codingEndpoint', () => {
  it('parses cwd and permissionMode from sentinel', () => {
    const ep = 'nuwa://claude-code?cwd=F%3A%2Fproj&permissionMode=plan';
    expect(parseCwdFromEndpoint(ep)).toBe('F:/proj');
    expect(parsePermissionModeFromEndpoint(ep)).toBe('plan');
  });

  it('maps legacy ask to plan', () => {
    expect(parsePermissionModeFromEndpoint('nuwa://claude-code?permissionMode=ask')).toBe('plan');
  });

  it('builds and clears query params', () => {
    let ep = buildCodingEndpoint('nuwa://claude-code', {
      cwd: 'F:/mystudy/model-test',
      permissionMode: 'acceptEdits',
    });
    expect(parseCwdFromEndpoint(ep)).toBe('F:/mystudy/model-test');
    expect(parsePermissionModeFromEndpoint(ep)).toBe('acceptEdits');

    ep = buildCodingEndpoint(ep, { cwd: '', permissionMode: null });
    expect(ep).toBe('nuwa://claude-code');
  });
});
