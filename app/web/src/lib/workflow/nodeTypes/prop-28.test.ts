// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-node-types, Property 28: 算子类型不匹配产生 EXPRESSION_TYPE_ERROR
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { typeOfExpression, ConfigErrorCode, type Expression } from './index';
import { arbitraryInputTypeEnv } from './arbitraries';

const litBool: fc.Arbitrary<Expression> = fc
  .boolean()
  .map((value): Expression => ({ node: 'litBool', value }));
const litNumber: fc.Arbitrary<Expression> = fc
  .double({ noNaN: true })
  .map((value): Expression => ({ node: 'litNumber', value }));

/**
 * Build expressions that violate an operator's typing requirement while
 * containing NO `inputRef` (so EXPRESSION_UNKNOWN_INPUT can never fire). The
 * typer must classify each of these as EXPRESSION_TYPE_ERROR.
 */
const arbMismatchExpr: fc.Arbitrary<Expression> = fc.oneof(
  // Arithmetic over a boolean operand (needs both operands to be number).
  fc
    .tuple(fc.constantFrom('add', 'sub', 'mul', 'div'), litBool, litNumber)
    .map(([op, left, right]): Expression => ({ node: 'arith', op: op as never, left, right })),
  // Logic over a number operand (needs both operands to be boolean).
  fc
    .tuple(fc.constantFrom('and', 'or'), litNumber, litBool)
    .map(([op, left, right]): Expression => ({ node: 'logic', op: op as never, left, right })),
  // Negation of a number operand (needs a boolean operand).
  litNumber.map((operand): Expression => ({ node: 'not', operand })),
  // Ordered comparison over two booleans (needs both number or both string).
  fc
    .tuple(fc.constantFrom('lt', 'le', 'gt', 'ge'), litBool, litBool)
    .map(([op, left, right]): Expression => ({ node: 'compare', op: op as never, left, right })),
);

describe('Property 28: operator type mismatch yields EXPRESSION_TYPE_ERROR (R13.6)', () => {
  it('an expression violating operator typing (no unknown inputs) fails with EXPRESSION_TYPE_ERROR', () => {
    fc.assert(
      fc.property(arbMismatchExpr, arbitraryInputTypeEnv(), (expr, env) => {
        const r = typeOfExpression(expr, env);
        expect(r.ok).toBe(false);
        if (!r.ok) {
          expect(r.error.code).toBe(ConfigErrorCode.EXPRESSION_TYPE_ERROR);
        }
      }),
      { numRuns: 100 },
    );
  });
});
