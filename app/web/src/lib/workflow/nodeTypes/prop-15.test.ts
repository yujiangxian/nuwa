// Feature: workflow-node-types, Property 15: condition 端口契约与表达式类型检测
//
// Property 15, Validates: Requirements 3.3, 3.4, 3.6
//
// For a valid condition node, each single-point violation must be detected:
//   - output count != 2                 -> PORT_ARITY_MISMATCH      (R3.3)
//   - outputs not exactly {true,false}  -> PORT_CONTRACT_MISMATCH   (R3.4)
//   - non-boolean condition expression  -> EXPRESSION_TYPE_ERROR    (R3.6)

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import type { WorkflowNode } from '../types';
import { ConfigErrorCode, validateNodeConfig, type ConditionConfig } from './index';
import { arbitraryNodeOfType } from './arbitraries';

function setConfig(node: WorkflowNode, config: unknown): WorkflowNode {
  return { ...node, config: config as unknown as WorkflowNode['config'] };
}

interface CondCase {
  readonly node: WorkflowNode;
  readonly code: ConfigErrorCode;
}

describe('Property 15: condition port-contract and expression-type detection', () => {
  it('detects output arity, output id-set, and non-boolean condition violations', () => {
    fc.assert(
      fc.property(
        arbitraryNodeOfType('condition').chain((node) => {
          const c = node.config as unknown as ConditionConfig;
          return fc.constantFrom<CondCase>(
            // drop one output -> output arity != 2 -> PORT_ARITY_MISMATCH
            {
              node: { ...node, outputs: node.outputs.slice(0, 1) },
              code: ConfigErrorCode.PORT_ARITY_MISMATCH,
            },
            // keep two outputs but break the {true, false} id set -> PORT_CONTRACT_MISMATCH
            {
              node: {
                ...node,
                outputs: node.outputs.map((p, i) => (i === 0 ? { ...p, id: 'maybe' } : p)),
              },
              code: ConfigErrorCode.PORT_CONTRACT_MISMATCH,
            },
            // condition typing to a non-boolean (string) -> EXPRESSION_TYPE_ERROR
            {
              node: setConfig(node, { ...c, condition: { node: 'litString', value: '' } }),
              code: ConfigErrorCode.EXPRESSION_TYPE_ERROR,
            },
          );
        }),
        ({ node, code }) => {
          const result = validateNodeConfig(node);
          expect(result.valid).toBe(false);
          expect(result.errors.some((e) => e.code === code)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
