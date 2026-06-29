// Feature: workflow-node-types, Property 31: 跨层集成——默认入口节点通过图校验
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { defaultConfig } from './index';
import { NODE_TYPES, ErrorCode, type JsonValue, type WorkflowGraph } from '../types';
import { validateGraph } from '../validate';

describe('Property 31: default entry node passes the base graph validation (R15.4, R15.5)', () => {
  it('a single-node entry graph built from defaultConfig(t) validates cleanly modulo required inputs', () => {
    fc.assert(
      fc.property(fc.constantFrom(...NODE_TYPES), (t) => {
        const dc = defaultConfig(t);
        const graph: WorkflowGraph = {
          nodes: [
            {
              id: 'n1',
              type: t,
              config: dc.config as unknown as JsonValue,
              inputs: dc.inputs,
              outputs: dc.outputs,
            },
          ],
          edges: [],
          loopScopes: [],
          entryNodeId: 'n1',
        };

        const res = validateGraph(graph);
        const hasRequiredInput = dc.inputs.some((p) => p.required);

        if (hasRequiredInput) {
          // (b) The only possible errors are unmet required inputs; no other
          // base rule may fire for the default entry node.
          expect(res.errors.length).toBeGreaterThan(0);
          expect(res.errors.every((e) => e.code === ErrorCode.MISSING_REQUIRED_INPUT)).toBe(true);
        } else {
          // (a) No required inputs -> fully valid.
          expect(res.valid).toBe(true);
          expect(res.errors).toHaveLength(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
