// Feature: workflow-node-types, Property 27: 未知输入引用产生 EXPRESSION_UNKNOWN_INPUT
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { typeOfExpression, ConfigErrorCode, type Expression } from './index';
import { arbitraryInputTypeEnv } from './arbitraries';

describe('Property 27: unknown input reference yields EXPRESSION_UNKNOWN_INPUT (R13.5)', () => {
  it('an inputRef to a Port_Id absent from the environment fails with the referenced Port_Id', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), arbitraryInputTypeEnv(), (portId, env) => {
        // Ensure the chosen Port_Id is genuinely unknown to the environment.
        fc.pre(!env.has(portId));

        const expr: Expression = { node: 'inputRef', portId };
        const r = typeOfExpression(expr, env);

        expect(r.ok).toBe(false);
        if (!r.ok) {
          expect(r.error.code).toBe(ConfigErrorCode.EXPRESSION_UNKNOWN_INPUT);
          expect(r.error.portId).toBe(portId);
        }
      }),
      { numRuns: 100 },
    );
  });
});
