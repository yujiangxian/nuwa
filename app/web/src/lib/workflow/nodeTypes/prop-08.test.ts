// Feature: workflow-node-types, Property 8: 校验错误排序稳定
import { describe, it } from 'vitest';
import fc from 'fast-check';

import type { ConfigError, TypedNodeConfig } from './index';
import type { JsonValue, WorkflowNode } from '../types';
import { NODE_TYPES } from '../types';
import { validateNodeConfig } from './index';
import { arbitraryNodeOfType, arbitraryReorderedConfig } from './arbitraries';

/** Sort key combining error code and location, mirroring the validator. */
function errorKey(e: ConfigError): string {
  const l = e.location;
  return `${e.code}|${l.nodeId}|${l.portId ?? ''}|${l.field ?? ''}|${l.exprPortId ?? ''}`;
}

/** The (code, location)-keyed sequence of a node's validation errors. */
function errorSequence(node: WorkflowNode): string[] {
  return validateNodeConfig(node).errors.map(errorKey);
}

// A node and a semantically-equivalent reordered-config variant must produce
// identical error sequences under the (code, location) ordering.
const arbNodePair: fc.Arbitrary<{ a: WorkflowNode; b: WorkflowNode }> = fc
  .constantFrom(...NODE_TYPES)
  .chain((t) => arbitraryNodeOfType(t))
  .chain((node) => {
    const cfg = node.config as unknown as TypedNodeConfig;
    return arbitraryReorderedConfig(cfg).map((reordered) => ({
      a: node,
      b: { ...node, config: reordered as unknown as JsonValue },
    }));
  });

describe('Property 8: stable error ordering under reordering', () => {
  it('reordered-config variant yields the same error sequence', () => {
    fc.assert(
      fc.property(arbNodePair, ({ a, b }) => {
        const sa = errorSequence(a);
        const sb = errorSequence(b);
        return sa.length === sb.length && sa.every((k, i) => k === sb[i]);
      }),
      { numRuns: 100 },
    );
  });
});
