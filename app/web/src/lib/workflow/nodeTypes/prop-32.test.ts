// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-node-types, Property 32: 错误码集合不相交
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { ConfigErrorCode } from './index';
import { ErrorCode } from '../types';

// All config-layer error code values and the base-layer error code value set.
const CONFIG_CODES = Object.values(ConfigErrorCode);
const BASE_CODES = new Set<string>(Object.values(ErrorCode));

describe('Property 32: ConfigErrorCode and base ErrorCode are disjoint (R15.6)', () => {
  it('no ConfigErrorCode value collides with any base ErrorCode value', () => {
    fc.assert(
      fc.property(fc.constantFrom(...CONFIG_CODES), (code) => {
        // Disjointness: every config code lies outside the base code set, so the
        // intersection of the two value sets is empty.
        expect(BASE_CODES.has(code)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
