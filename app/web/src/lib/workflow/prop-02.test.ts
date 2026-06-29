// Feature: workflow-graph-model, Property 2: 可赋值关系传递性
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { isAssignable } from './portType';
import { arbitraryPortType } from './arbitraries';

describe('Property 2: assignability transitivity', () => {
  it('isAssignable(a,b) && isAssignable(b,c) implies isAssignable(a,c)', () => {
    fc.assert(
      fc.property(
        arbitraryPortType(),
        arbitraryPortType(),
        arbitraryPortType(),
        (a, b, c) => {
          // Only the premise-satisfying triples constrain the conclusion.
          if (isAssignable(a, b) && isAssignable(b, c)) {
            return isAssignable(a, c) === true;
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});
