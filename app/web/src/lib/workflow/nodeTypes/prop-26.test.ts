// Feature: workflow-node-types, Property 26: 表达式类型器确定性
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { typeOfExpression } from './index';
import { arbitraryExpression, arbitraryInputTypeEnv } from './arbitraries';

describe('Property 26: expression typer determinism (R13.3)', () => {
  it('two calls of typeOfExpression on the same input are deep-equal', () => {
    fc.assert(
      fc.property(arbitraryExpression(), arbitraryInputTypeEnv(), (expr, env) => {
        const r1 = typeOfExpression(expr, env);
        const r2 = typeOfExpression(expr, env);
        expect(r1).toEqual(r2);
      }),
      { numRuns: 100 },
    );
  });
});
