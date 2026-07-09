// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-node-types, Property 25: 表达式类型器总性
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { typeOfExpression, type ExpressionTypeResult } from './index';
import { arbitraryExpression, arbitraryInputTypeEnv } from './arbitraries';

describe('Property 25: expression typer totality (R13.2, R13.4)', () => {
  it('typeOfExpression always terminates, never throws, and returns a well-formed result', () => {
    fc.assert(
      fc.property(arbitraryExpression(), arbitraryInputTypeEnv(), (expr, env) => {
        // Totality: the typer must terminate and never throw for any input.
        let result: ExpressionTypeResult | undefined;
        expect(() => {
          result = typeOfExpression(expr, env);
        }).not.toThrow();

        // The result must be exactly one of the two result shapes.
        const r = result as ExpressionTypeResult;
        expect(typeof r.ok).toBe('boolean');
        if (r.ok) {
          // Success carries a PortType.
          expect(r.type).toBeDefined();
          expect(typeof r.type.kind).toBe('string');
        } else {
          // Failure carries an error with a string code.
          expect(r.error).toBeDefined();
          expect(typeof r.error.code).toBe('string');
          expect(typeof r.error.message).toBe('string');
        }
      }),
      { numRuns: 100 },
    );
  });
});
