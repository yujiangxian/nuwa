// Feature: workflow-node-types, Property 12: tool 配置错误检测
//
// Property 12, Validates: Requirements 4.4, 4.5, 4.6
//
// For a valid tool node, each single-point violation must be detected:
//   - empty toolName                       -> MISSING_REQUIRED_FIELD (field=toolName) (R4.4)
//   - binding to an undeclared input port  -> PORT_CONTRACT_MISMATCH (portId)          (R4.5)
//   - duplicate argument name              -> DUPLICATE_ARGUMENT_BINDING               (R4.6)

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import type { WorkflowNode } from '../types';
import { T_STRING } from '../portType';
import { ConfigErrorCode, validateNodeConfig, type ToolConfig } from './index';
import { arbitraryNodeOfType } from './arbitraries';

function setConfig(node: WorkflowNode, config: unknown): WorkflowNode {
  return { ...node, config: config as unknown as WorkflowNode['config'] };
}

interface ToolCase {
  readonly node: WorkflowNode;
  readonly code: ConfigErrorCode;
}

describe('Property 12: tool config error detection', () => {
  it('detects empty toolName, undeclared binding port, and duplicate argName', () => {
    fc.assert(
      fc.property(
        arbitraryNodeOfType('tool').chain((node) => {
          const c = node.config as unknown as ToolConfig;
          return fc.constantFrom<ToolCase>(
            // empty toolName -> MISSING_REQUIRED_FIELD
            {
              node: setConfig(node, { ...c, toolName: '' }),
              code: ConfigErrorCode.MISSING_REQUIRED_FIELD,
            },
            // binding references an undeclared input port -> PORT_CONTRACT_MISMATCH
            {
              node: setConfig(node, {
                ...c,
                argumentBindings: [{ portId: 'pX', argName: 'a', portType: T_STRING }],
              }),
              code: ConfigErrorCode.PORT_CONTRACT_MISMATCH,
            },
            // duplicate argName (with a matching declared input port) -> DUPLICATE_ARGUMENT_BINDING
            {
              node: {
                ...setConfig(node, {
                  ...c,
                  argumentBindings: [
                    { portId: 'p0', argName: 'a', portType: T_STRING },
                    { portId: 'p0', argName: 'a', portType: T_STRING },
                  ],
                }),
                inputs: [{ id: 'p0', direction: 'input', portType: T_STRING, required: true }],
              },
              code: ConfigErrorCode.DUPLICATE_ARGUMENT_BINDING,
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
