// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-graph-model, Property 5: list 协变
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { isAssignable, listOf } from './portType';
import { arbitraryPortType } from './arbitraries';

describe('Property 5: list covariance', () => {
  it('isAssignable(a,b) implies isAssignable(listOf(a), listOf(b))', () => {
    fc.assert(
      fc.property(arbitraryPortType(), arbitraryPortType(), (a, b) => {
        if (isAssignable(a, b)) {
          return isAssignable(listOf(a), listOf(b)) === true;
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });
});
