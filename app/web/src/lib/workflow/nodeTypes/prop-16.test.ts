// Feature: workflow-node-types, Property 16: transform 表达式类型与未知输入检测
//
// Property 16, Validates: Requirements 5.4, 5.5, 14.5
//
// For a transform node:
//   - referencing an undeclared input port -> EXPRESSION_UNKNOWN_INPUT (exprPortId) (R5.5)
//   - inferred type incompatible with the declared outputType -> EXPRESSION_TYPE_ERROR (R5.4)
//   - a compatible expression with no unknown references -> NEITHER of those codes (R14.5)
//
// A single property covers all three scenarios via a scenario discriminator.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import type { WorkflowNode } from '../types';
import { T_NUMBER } from '../portType';
import { ConfigErrorCode, validateNodeConfig, type TransformConfig } from './index';
import { arbitraryNodeOfType } from './arbitraries';

function setConfig(node: WorkflowNode, config: unknown): WorkflowNode {
  return { ...node, config: config as unknown as WorkflowNode['config'] };
}

type Scenario = 'unknown' | 'incompatible' | 'ok';

describe('Property 16: transform expression-type and unknown-input detection', () => {
  it('detects unknown refs, incompatible outputType, and accepts compatible expressions', () => {
    fc.assert(
      fc.property(
        arbitraryNodeOfType('transform').chain((node) =>
          fc.constantFrom<Scenario>('unknown', 'incompatible', 'ok').map((scenario) => ({ node, scenario })),
        ),
        ({ node, scenario }) => {
          const c = node.config as unknown as TransformConfig;
          if (scenario === 'unknown') {
            // Reference an input port that is not in declaredInputs.
            const mutated = setConfig(node, { ...c, transform: { node: 'inputRef', portId: 'pX' } });
            const result = validateNodeConfig(mutated);
            const match = result.errors.some(
              (e) =>
                e.code === ConfigErrorCode.EXPRESSION_UNKNOWN_INPUT && e.location.exprPortId === 'pX',
            );
            expect(match).toBe(true);
          } else if (scenario === 'incompatible') {
            // Default transform infers `string`; declare an incompatible number output.
            const mutated = setConfig(node, { ...c, outputType: T_NUMBER });
            const result = validateNodeConfig(mutated);
            expect(result.errors.some((e) => e.code === ConfigErrorCode.EXPRESSION_TYPE_ERROR)).toBe(true);
          } else {
            // The valid default transform: compatible output, no unknown references.
            const result = validateNodeConfig(node);
            const offending = result.errors.some(
              (e) =>
                e.code === ConfigErrorCode.EXPRESSION_TYPE_ERROR ||
                e.code === ConfigErrorCode.EXPRESSION_UNKNOWN_INPUT,
            );
            expect(offending).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
