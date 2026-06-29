// Feature: workflow-node-types, Property 18: 收敛后无数值范围错误
import { describe, it } from 'vitest';
import fc from 'fast-check';

import {
  clampNumericFields,
  expectedPorts,
  validateNodeConfig,
  ConfigErrorCode,
  type TypedNodeConfig,
} from './index';
import { arbitraryTypedConfig } from './arbitraries';
import type { JsonValue, WorkflowNode } from '../types';

/** Replace the numeric fields of an llm / loop config with arbitrary values. */
function injectOutOfRange(c: TypedNodeConfig): fc.Arbitrary<TypedNodeConfig> {
  const anyNum = fc.double(); // any value, biased to exercise out-of-range inputs
  switch (c.kind) {
    case 'llm':
      return fc
        .record({ t: anyNum, m: anyNum })
        .map(({ t, m }): TypedNodeConfig => ({ ...c, temperature: t, maxTokens: m }));
    case 'loop':
      return anyNum.map((m): TypedNodeConfig => ({ ...c, maxIterations: m }));
    default:
      return fc.constant(c);
  }
}

const arbCase = fc.constantFrom<'llm' | 'loop'>('llm', 'loop').chain((kind) =>
  arbitraryTypedConfig(kind).chain((base) => injectOutOfRange(base).map((cfg) => ({ kind, cfg }))),
);

describe('Property 18: clamped numeric fields never trigger NUMERIC_OUT_OF_RANGE', () => {
  it('a node built from the clamped config reports no NUMERIC_OUT_OF_RANGE error', () => {
    fc.assert(
      fc.property(arbCase, ({ kind, cfg }) => {
        const clamped = clampNumericFields(kind, cfg);
        // expectedPorts for llm / loop does not depend on the numeric fields, so
        // the assembled node satisfies the port contract; only the numeric check
        // is under test here.
        const ports = expectedPorts(kind, clamped);
        const node: WorkflowNode = {
          id: 'n1',
          type: kind,
          config: clamped as unknown as JsonValue,
          inputs: ports.inputs,
          outputs: ports.outputs,
        };
        const result = validateNodeConfig(node);
        return result.errors.every((e) => e.code !== ConfigErrorCode.NUMERIC_OUT_OF_RANGE);
      }),
      { numRuns: 100 },
    );
  });
});
