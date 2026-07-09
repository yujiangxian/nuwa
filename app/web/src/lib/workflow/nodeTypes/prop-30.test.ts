// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-node-types, Property 30: 输入加宽下类型推导单调可靠
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { typeOfExpression, referencedInputs } from './index';
import { arbitraryInputTypeEnv, arbitraryWellTypedExpression } from './arbitraries';
import { T_JSON, isAssignable } from '../portType';

// Generate an environment and a well-typed expression (target json), then build
// a second environment by widening every referenced port to json (the top type).
// Widening keeps each entry isAssignable-compatible: isAssignable(t, json) holds.
const arbEnvAndExpr = arbitraryInputTypeEnv().chain((env1) =>
  arbitraryWellTypedExpression(env1, T_JSON).map((expr) => ({ env1, expr })),
);

describe('Property 30: type inference is monotone/sound under input widening (R14.3)', () => {
  it('when both envs type ok, the output types stay isAssignable-compatible', () => {
    fc.assert(
      fc.property(arbEnvAndExpr, ({ env1, expr }) => {
        const refs = referencedInputs(expr);
        // env2 agrees with env1 on every referenced port via widening to json.
        const env2 = new Map(env1);
        for (const portId of refs) {
          env2.set(portId, T_JSON);
        }

        const r1 = typeOfExpression(expr, env1);
        const r2 = typeOfExpression(expr, env2);

        // Only assert when both type successfully (R14.3 premise).
        if (r1.ok && r2.ok) {
          expect(isAssignable(r1.type, r2.type)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
