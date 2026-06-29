// Feature: workflow-node-types, Property 23: 规范形式唯一（语义等价归一）
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { normalizeNodeConfig } from './index';
import { arbitraryTypedConfig, arbitraryReorderedConfig } from './arbitraries';
import { NODE_TYPES, type NodeType } from '../types';

/** Order-insensitive structural deep equality (Object.is at the leaves). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr || bArr) {
    if (!aArr || !bArr) {
      return false;
    }
    const aa = a as unknown[];
    const ba = b as unknown[];
    if (aa.length !== ba.length) {
      return false;
    }
    for (let i = 0; i < aa.length; i++) {
      if (!deepEqual(aa[i], ba[i])) {
        return false;
      }
    }
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao).sort();
  const bk = Object.keys(bo).sort();
  if (ak.length !== bk.length) {
    return false;
  }
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i] || !deepEqual(ao[ak[i]], bo[bk[i]])) {
      return false;
    }
  }
  return true;
}

const arbCase = fc.constantFrom(...NODE_TYPES).chain((kind: NodeType) =>
  arbitraryTypedConfig(kind).chain((base) =>
    arbitraryReorderedConfig(base).map((variant) => ({ kind, base, variant })),
  ),
);

describe('Property 23: semantically-equivalent configs share one canonical form', () => {
  it('a reordered (semantically-equivalent) config normalizes to a deep-equal form', () => {
    fc.assert(
      fc.property(arbCase, ({ kind, base, variant }) => {
        return deepEqual(normalizeNodeConfig(kind, base), normalizeNodeConfig(kind, variant));
      }),
      { numRuns: 100 },
    );
  });
});
