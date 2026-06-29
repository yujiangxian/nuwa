// Feature: workflow-node-types, Property 5: 默认配置工厂确定性
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { NODE_TYPES } from '../types';
import { defaultConfig } from './index';

// For every NodeType, two calls to defaultConfig(t) produce a deep-equal result
// (config, inputs and outputs all coincide). The factory is deterministic.
describe('Property 5: default config factory determinism', () => {
  it('two calls to defaultConfig(t) are deep-equal', () => {
    fc.assert(
      fc.property(fc.constantFrom(...NODE_TYPES), (t) => {
        const a = defaultConfig(t);
        const b = defaultConfig(t);
        return JSON.stringify(a) === JSON.stringify(b);
      }),
      { numRuns: 100 },
    );
  });
});
