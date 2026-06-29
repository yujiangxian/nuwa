// Feature: workflow-node-types, Property 2: 默认配置往返合法性
import { describe, it } from 'vitest';
import fc from 'fast-check';

import type { JsonValue, WorkflowNode } from '../types';
import { NODE_TYPES } from '../types';
import { defaultConfig, validateNodeConfig } from './index';

// For every NodeType, the node assembled from defaultConfig(t) must pass
// validateNodeConfig with valid === true and an empty error set.
describe('Property 2: default config round-trip validity', () => {
  it('defaultConfig(t) builds a node that validates clean', () => {
    fc.assert(
      fc.property(fc.constantFrom(...NODE_TYPES), (t) => {
        const dc = defaultConfig(t);
        const node: WorkflowNode = {
          id: 'n_default',
          type: t,
          config: dc.config as unknown as JsonValue,
          inputs: dc.inputs,
          outputs: dc.outputs,
        };
        const result = validateNodeConfig(node);
        return result.valid === true && result.errors.length === 0;
      }),
      { numRuns: 100 },
    );
  });
});
