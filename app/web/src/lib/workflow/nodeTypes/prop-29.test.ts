// Feature: workflow-node-types, Property 29: 条件表达式定型为布尔
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { typeOfExpression } from './index';
import { arbitraryInputTypeEnv, arbitraryWellTypedExpression } from './arbitraries';
import { T_BOOLEAN, isAssignable } from '../portType';

// Pair a random environment with a well-typed boolean expression generated under it.
const arbEnvAndExpr = arbitraryInputTypeEnv().chain((env) =>
  arbitraryWellTypedExpression(env, T_BOOLEAN).map((expr) => ({ env, expr })),
);

describe('Property 29: condition expressions type to boolean (R14.1)', () => {
  it('a well-typed boolean expression types successfully and is assignable to boolean', () => {
    fc.assert(
      fc.property(arbEnvAndExpr, ({ env, expr }) => {
        const r = typeOfExpression(expr, env);
        expect(r.ok).toBe(true);
        if (r.ok) {
          expect(isAssignable(r.type, T_BOOLEAN)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
