// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-graph-model, Property 3: json 为全局顶类型
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { isAssignable, T_JSON } from './portType';
import { arbitraryPortType } from './arbitraries';

describe('Property 3: json is the global top type', () => {
  it('isAssignable(t, T_JSON) holds for all PortType t', () => {
    fc.assert(
      fc.property(arbitraryPortType(), (t) => {
        return isAssignable(t, T_JSON) === true;
      }),
      { numRuns: 100 },
    );
  });
});
