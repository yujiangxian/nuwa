// Feature: workflow-graph-model, Property 6: optional 协变
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { isAssignable, optionalOf } from './portType';
import { arbitraryPortType } from './arbitraries';

describe('Property 6: optional covariance', () => {
  it('isAssignable(a,b) implies isAssignable(optionalOf(a), optionalOf(b))', () => {
    fc.assert(
      fc.property(arbitraryPortType(), arbitraryPortType(), (a, b) => {
        if (isAssignable(a, b)) {
          return isAssignable(optionalOf(a), optionalOf(b)) === true;
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });
});
