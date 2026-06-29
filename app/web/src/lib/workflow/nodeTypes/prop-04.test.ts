// Feature: workflow-node-types, Property 4: 默认端口集合等于推导端口
import { describe, it } from 'vitest';
import fc from 'fast-check';

import type { Port } from '../types';
import { NODE_TYPES } from '../types';
import { defaultConfig, expectedPorts } from './index';

/** Comparable key for a port by direction + id + type (structural). */
function portKey(p: Port): string {
  return `${p.direction}|${p.id}|${JSON.stringify(p.portType)}`;
}

/** Two port sets are equal when they carry the same direction/id/type keys. */
function portSetsEqual(a: readonly Port[], b: readonly Port[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const ka = a.map(portKey).sort();
  const kb = b.map(portKey).sort();
  return ka.every((k, i) => k === kb[i]);
}

// For every NodeType, the default port sets equal expectedPorts(t, defaultConfig).
describe('Property 4: default ports equal derived ports', () => {
  it('defaultConfig(t) ports equal expectedPorts(t, defaultConfig(t).config)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...NODE_TYPES), (t) => {
        const dc = defaultConfig(t);
        const ep = expectedPorts(t, dc.config);
        return portSetsEqual(dc.inputs, ep.inputs) && portSetsEqual(dc.outputs, ep.outputs);
      }),
      { numRuns: 100 },
    );
  });
});
