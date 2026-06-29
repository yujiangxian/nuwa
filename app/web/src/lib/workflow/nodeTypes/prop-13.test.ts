// Feature: workflow-node-types, Property 13: human_input 配置错误检测
//
// Property 13, Validates: Requirements 6.4, 6.5
//
// For a valid human_input node, each single-point violation must be detected:
//   - empty prompt                              -> MISSING_REQUIRED_FIELD (field=prompt) (R6.4)
//   - response port type != configured responseType -> PORT_CONTRACT_MISMATCH            (R6.5)

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import type { WorkflowNode } from '../types';
import { T_NUMBER } from '../portType';
import { ConfigErrorCode, validateNodeConfig, type HumanInputConfig } from './index';
import { arbitraryNodeOfType } from './arbitraries';

function setConfig(node: WorkflowNode, config: unknown): WorkflowNode {
  return { ...node, config: config as unknown as WorkflowNode['config'] };
}

interface HumanCase {
  readonly node: WorkflowNode;
  readonly code: ConfigErrorCode;
}

describe('Property 13: human_input config error detection', () => {
  it('detects empty prompt and a response port type mismatch', () => {
    fc.assert(
      fc.property(
        arbitraryNodeOfType('human_input').chain((node) => {
          const c = node.config as unknown as HumanInputConfig;
          return fc.constantFrom<HumanCase>(
            // empty prompt -> MISSING_REQUIRED_FIELD(prompt)
            {
              node: setConfig(node, { ...c, prompt: '' }),
              code: ConfigErrorCode.MISSING_REQUIRED_FIELD,
            },
            // response output port type differs from responseType (default string) -> PORT_CONTRACT_MISMATCH
            {
              node: {
                ...node,
                outputs: node.outputs.map((p) =>
                  p.id === 'response' ? { ...p, portType: T_NUMBER } : p,
                ),
              },
              code: ConfigErrorCode.PORT_CONTRACT_MISMATCH,
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
