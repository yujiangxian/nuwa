// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-node-types, Property 9: 校验完整报告（不在首错停止）
//
// Property 9, Validates: Requirements 8.6
//
// `validateNodeConfig` must collect ALL violations without short-circuiting on
// the first error. We inject k >= 2 independent single-point violations onto one
// valid node (built from `defaultConfig` via `arbitraryNodeOfType`) and assert
// that each injected violation's expected `ConfigErrorCode` appears in the error
// set. Inclusion (not exclusivity) is asserted, since one mutation may surface a
// related code as a side effect.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { NODE_TYPES, type WorkflowNode } from '../types';
import { T_STRING, T_NUMBER } from '../portType';
import {
  ConfigErrorCode,
  validateNodeConfig,
  type LlmConfig,
  type ToolConfig,
  type HumanInputConfig,
  type ConditionConfig,
  type TransformConfig,
  type LoopConfig,
} from './index';
import { arbitraryNodeOfType } from './arbitraries';

/** Replace a node's opaque config with an arbitrary (possibly invalid) payload. */
function setConfig(node: WorkflowNode, config: unknown): WorkflowNode {
  return { ...node, config: config as unknown as WorkflowNode['config'] };
}

/**
 * Inject two independent single-point violations into a valid node and return
 * the mutated node together with the two `ConfigErrorCode`s each is expected to
 * trigger. The two violations target disjoint aspects of the node so both codes
 * are guaranteed to appear in the aggregated error set.
 */
function injectTwo(node: WorkflowNode): { node: WorkflowNode; codes: ConfigErrorCode[] } {
  const raw = node.config as unknown as Record<string, unknown>;
  switch (node.type) {
    case 'llm': {
      const c = raw as unknown as LlmConfig;
      // empty modelId (MISSING_REQUIRED_FIELD) + maxTokens < 1 (NUMERIC_OUT_OF_RANGE)
      return {
        node: setConfig(node, { ...c, modelId: '', maxTokens: 0 }),
        codes: [ConfigErrorCode.MISSING_REQUIRED_FIELD, ConfigErrorCode.NUMERIC_OUT_OF_RANGE],
      };
    }
    case 'condition': {
      const c = raw as unknown as ConditionConfig;
      // non-boolean condition (EXPRESSION_TYPE_ERROR) + output arity != 2 (PORT_ARITY_MISMATCH)
      return {
        node: {
          ...setConfig(node, { ...c, condition: { node: 'litString', value: '' } }),
          outputs: node.outputs.slice(0, 1),
        },
        codes: [ConfigErrorCode.EXPRESSION_TYPE_ERROR, ConfigErrorCode.PORT_ARITY_MISMATCH],
      };
    }
    case 'tool': {
      const c = raw as unknown as ToolConfig;
      // empty toolName (MISSING_REQUIRED_FIELD) + duplicate argName binding
      // (DUPLICATE_ARGUMENT_BINDING). The single declared input port p0 keeps the
      // port contract satisfied so only the duplicate-binding rule fires there.
      return {
        node: {
          ...setConfig(node, {
            ...c,
            toolName: '',
            argumentBindings: [
              { portId: 'p0', argName: 'a', portType: T_STRING },
              { portId: 'p0', argName: 'a', portType: T_STRING },
            ],
          }),
          inputs: [{ id: 'p0', direction: 'input', portType: T_STRING, required: true }],
        },
        codes: [ConfigErrorCode.MISSING_REQUIRED_FIELD, ConfigErrorCode.DUPLICATE_ARGUMENT_BINDING],
      };
    }
    case 'transform': {
      const c = raw as unknown as TransformConfig;
      // outputType incompatible with the inferred string output (EXPRESSION_TYPE_ERROR)
      // + missing output port (PORT_ARITY_MISMATCH).
      return {
        node: { ...setConfig(node, { ...c, outputType: T_NUMBER }), outputs: [] },
        codes: [ConfigErrorCode.EXPRESSION_TYPE_ERROR, ConfigErrorCode.PORT_ARITY_MISMATCH],
      };
    }
    case 'human_input': {
      const c = raw as unknown as HumanInputConfig;
      // empty prompt (MISSING_REQUIRED_FIELD) + response port type != responseType
      // (PORT_CONTRACT_MISMATCH).
      return {
        node: {
          ...setConfig(node, { ...c, prompt: '' }),
          outputs: node.outputs.map((p) => (p.id === 'response' ? { ...p, portType: T_NUMBER } : p)),
        },
        codes: [ConfigErrorCode.MISSING_REQUIRED_FIELD, ConfigErrorCode.PORT_CONTRACT_MISMATCH],
      };
    }
    case 'loop': {
      const c = raw as unknown as LoopConfig;
      // maxIterations < 1 (NUMERIC_OUT_OF_RANGE) + non-boolean break condition
      // (EXPRESSION_TYPE_ERROR).
      return {
        node: setConfig(node, {
          ...c,
          maxIterations: 0,
          breakCondition: { node: 'litString', value: '' },
        }),
        codes: [ConfigErrorCode.NUMERIC_OUT_OF_RANGE, ConfigErrorCode.EXPRESSION_TYPE_ERROR],
      };
    }
  }
}

describe('Property 9: validation reports all violations (no first-error stop)', () => {
  it('every injected single-point violation code appears in the error set', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...NODE_TYPES).chain((t) => arbitraryNodeOfType(t)),
        (baseNode) => {
          const { node, codes } = injectTwo(baseNode);
          const result = validateNodeConfig(node);
          expect(result.valid).toBe(false);
          const present = new Set(result.errors.map((e) => e.code));
          for (const code of codes) {
            expect(present.has(code)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
