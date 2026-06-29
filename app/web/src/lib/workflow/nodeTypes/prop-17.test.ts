// Feature: workflow-node-types, Property 17: 数值收敛幂等且区间内保持
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { clampNumericFields, type TypedNodeConfig } from './index';
import { arbitraryTypedConfig } from './arbitraries';
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

/**
 * Inject (possibly out-of-range) arbitrary numeric values into the numeric
 * fields of llm / loop configs; other kinds are returned unchanged.
 */
function arbNumericVariant(c: TypedNodeConfig): fc.Arbitrary<TypedNodeConfig> {
  const anyNum = fc.double(); // includes negatives, large, fractional, ±Infinity, NaN
  switch (c.kind) {
    case 'llm':
      return fc
        .record({ t: anyNum, m: anyNum })
        .map(({ t, m }): TypedNodeConfig => ({ ...c, temperature: t, maxTokens: m }));
    case 'loop':
      return anyNum.map((m): TypedNodeConfig => ({ ...c, maxIterations: m }));
    default:
      return fc.constant(c);
  }
}

const arbCase = fc.constantFrom(...NODE_TYPES).chain((kind: NodeType) =>
  arbitraryTypedConfig(kind).chain((base) =>
    arbNumericVariant(base).map((variant) => ({ kind, base, variant })),
  ),
);

describe('Property 17: numeric clamping is idempotent and preserves in-range values', () => {
  it('clampNumericFields is idempotent, and in-range numeric fields are unchanged', () => {
    fc.assert(
      fc.property(arbCase, ({ kind, base, variant }) => {
        // Idempotency (R9.3): clamping a clamped config is a no-op.
        const once = clampNumericFields(kind, variant);
        const twice = clampNumericFields(kind, once);
        const idempotent = deepEqual(once, twice);
        // In-range preservation (R9.2 / R9.4): the base config carries only valid
        // numeric fields, so clamping leaves it structurally unchanged.
        const inRangeUnchanged = deepEqual(clampNumericFields(kind, base), base);
        return idempotent && inRangeUnchanged;
      }),
      { numRuns: 100 },
    );
  });
});
