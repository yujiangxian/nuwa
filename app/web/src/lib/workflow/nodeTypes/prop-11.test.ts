// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-node-types, Property 11: llm 必需字段与数值范围检测
//
// Property 11, Validates: Requirements 2.4, 2.5, 2.6
//
// For a valid default llm node, each single-point violation must be detected with
// the right code and field location:
//   - empty modelId        -> MISSING_REQUIRED_FIELD (field=modelId)   (R2.4)
//   - temperature = 5       -> NUMERIC_OUT_OF_RANGE   (field=temperature)(R2.5)
//   - maxTokens 0 / non-int -> NUMERIC_OUT_OF_RANGE   (field=maxTokens)  (R2.6)

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import type { WorkflowNode } from '../types';
import { ConfigErrorCode, validateNodeConfig, type LlmConfig } from './index';
import { arbitraryNodeOfType } from './arbitraries';

function setConfig(node: WorkflowNode, config: unknown): WorkflowNode {
  return { ...node, config: config as unknown as WorkflowNode['config'] };
}

interface LlmCase {
  readonly node: WorkflowNode;
  readonly code: ConfigErrorCode;
  readonly field: string;
}

describe('Property 11: llm required-field and numeric-range detection', () => {
  it('detects each llm single-point violation with the expected code and field', () => {
    fc.assert(
      fc.property(
        arbitraryNodeOfType('llm').chain((node) => {
          const c = node.config as unknown as LlmConfig;
          return fc.constantFrom<LlmCase>(
            {
              node: setConfig(node, { ...c, modelId: '' }),
              code: ConfigErrorCode.MISSING_REQUIRED_FIELD,
              field: 'modelId',
            },
            {
              node: setConfig(node, { ...c, temperature: 5 }),
              code: ConfigErrorCode.NUMERIC_OUT_OF_RANGE,
              field: 'temperature',
            },
            {
              node: setConfig(node, { ...c, maxTokens: 0 }),
              code: ConfigErrorCode.NUMERIC_OUT_OF_RANGE,
              field: 'maxTokens',
            },
            {
              node: setConfig(node, { ...c, maxTokens: 1.5 }),
              code: ConfigErrorCode.NUMERIC_OUT_OF_RANGE,
              field: 'maxTokens',
            },
          );
        }),
        ({ node, code, field }) => {
          const result = validateNodeConfig(node);
          expect(result.valid).toBe(false);
          const match = result.errors.some(
            (e) => e.code === code && e.location.field === field && e.location.nodeId === node.id,
          );
          expect(match).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
