// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-node-types, Property 21: 端口契约一致则无端口错误
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { expectedPorts, validateNodeConfig, ConfigErrorCode } from './index';
import { arbitraryTypedConfig } from './arbitraries';
import { NODE_TYPES, type JsonValue, type NodeType, type WorkflowNode } from '../types';

const arbCase = fc
  .constantFrom(...NODE_TYPES)
  .chain((kind: NodeType) => arbitraryTypedConfig(kind).map((config) => ({ kind, config })));

describe('Property 21: a contract-consistent node reports no port errors', () => {
  it('a node assembled from expectedPorts(t, c) has no PORT_*_MISMATCH', () => {
    fc.assert(
      fc.property(arbCase, ({ kind, config }) => {
        // Assemble the node with exactly the derived expected ports, so the port
        // contract holds by construction (R11.7 / R15.2). For condition nodes the
        // derived outputs are exactly {true, false}.
        const ep = expectedPorts(kind, config);
        const node: WorkflowNode = {
          id: 'n1',
          type: kind,
          config: config as unknown as JsonValue,
          inputs: ep.inputs,
          outputs: ep.outputs,
        };
        const result = validateNodeConfig(node);
        return result.errors.every(
          (e) =>
            e.code !== ConfigErrorCode.PORT_CONTRACT_MISMATCH &&
            e.code !== ConfigErrorCode.PORT_ARITY_MISMATCH,
        );
      }),
      { numRuns: 100 },
    );
  });
});
