// Feature: workflow-graph-model, Property 4: optional 包裹可赋值
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { isAssignable, optionalOf } from './portType';
import { arbitraryPortType } from './arbitraries';

describe('Property 4: optional wrapping is assignable', () => {
  it('isAssignable(t, optionalOf(t)) holds for all PortType t', () => {
    fc.assert(
      fc.property(arbitraryPortType(), (t) => {
        return isAssignable(t, optionalOf(t)) === true;
      }),
      { numRuns: 100 },
    );
  });
});
