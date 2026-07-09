// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-node-types, Property 3: 默认配置判别标签匹配类型
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { NODE_TYPES } from '../types';
import { defaultConfig } from './index';

// For every NodeType, the discriminator of the produced default config equals t.
describe('Property 3: default config discriminator matches type', () => {
  it('defaultConfig(t).config.kind === t', () => {
    fc.assert(
      fc.property(fc.constantFrom(...NODE_TYPES), (t) => {
        return defaultConfig(t).config.kind === t;
      }),
      { numRuns: 100 },
    );
  });
});
