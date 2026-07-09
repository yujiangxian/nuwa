// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-node-types, Property 1: 配置类型不匹配检测
import { describe, it } from 'vitest';
import fc from 'fast-check';

import type { JsonValue, WorkflowNode } from '../types';
import { NODE_TYPES } from '../types';
import { validateNodeConfig, ConfigErrorCode } from './index';
import { arbitraryNodeOfType } from './arbitraries';

// For any node whose config discriminator `kind` differs from the node's
// NodeType, validateNodeConfig must be invalid and report CONFIG_TYPE_MISMATCH.
const arbMismatchedNode: fc.Arbitrary<WorkflowNode> = fc
  .constantFrom(...NODE_TYPES)
  .chain((t) =>
    arbitraryNodeOfType(t).chain((node) =>
      fc.constantFrom(...NODE_TYPES.filter((k) => k !== t)).map((wrongKind): WorkflowNode => {
        const cfg = node.config as Record<string, unknown>;
        return { ...node, config: { ...cfg, kind: wrongKind } as unknown as JsonValue };
      }),
    ),
  );

describe('Property 1: config type mismatch detection', () => {
  it('flags CONFIG_TYPE_MISMATCH whenever config.kind !== node.type', () => {
    fc.assert(
      fc.property(arbMismatchedNode, (node) => {
        const result = validateNodeConfig(node);
        return (
          result.valid === false &&
          result.errors.some((e) => e.code === ConfigErrorCode.CONFIG_TYPE_MISMATCH)
        );
      }),
      { numRuns: 100 },
    );
  });
});
