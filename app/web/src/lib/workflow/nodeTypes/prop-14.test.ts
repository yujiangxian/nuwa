// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-node-types, Property 14: loop 数值范围与中止条件类型检测
//
// Property 14, Validates: Requirements 7.3, 7.5
//
// For a valid loop node, each single-point violation must be detected:
//   - maxIterations < 1 / non-integer  -> NUMERIC_OUT_OF_RANGE (field=maxIterations) (R7.3)
//   - non-boolean break condition       -> EXPRESSION_TYPE_ERROR                      (R7.5)

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import type { WorkflowNode } from '../types';
import { ConfigErrorCode, validateNodeConfig, type LoopConfig } from './index';
import { arbitraryNodeOfType } from './arbitraries';

function setConfig(node: WorkflowNode, config: unknown): WorkflowNode {
  return { ...node, config: config as unknown as WorkflowNode['config'] };
}

interface LoopCase {
  readonly node: WorkflowNode;
  readonly code: ConfigErrorCode;
  readonly field?: string;
}

describe('Property 14: loop numeric-range and break-condition type detection', () => {
  it('detects out-of-range maxIterations and a non-boolean break condition', () => {
    fc.assert(
      fc.property(
        arbitraryNodeOfType('loop').chain((node) => {
          const c = node.config as unknown as LoopConfig;
          return fc.constantFrom<LoopCase>(
            // maxIterations < 1 -> NUMERIC_OUT_OF_RANGE(maxIterations)
            {
              node: setConfig(node, { ...c, maxIterations: 0 }),
              code: ConfigErrorCode.NUMERIC_OUT_OF_RANGE,
              field: 'maxIterations',
            },
            // non-integer maxIterations -> NUMERIC_OUT_OF_RANGE(maxIterations)
            {
              node: setConfig(node, { ...c, maxIterations: 2.5 }),
              code: ConfigErrorCode.NUMERIC_OUT_OF_RANGE,
              field: 'maxIterations',
            },
            // break condition typing to a non-boolean (string) -> EXPRESSION_TYPE_ERROR
            {
              node: setConfig(node, { ...c, breakCondition: { node: 'litString', value: '' } }),
              code: ConfigErrorCode.EXPRESSION_TYPE_ERROR,
            },
          );
        }),
        ({ node, code, field }) => {
          const result = validateNodeConfig(node);
          expect(result.valid).toBe(false);
          const match = result.errors.some(
            (e) => e.code === code && (field === undefined || e.location.field === field),
          );
          expect(match).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
