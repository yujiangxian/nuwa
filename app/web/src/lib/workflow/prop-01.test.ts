// Feature: workflow-graph-model, Property 1: 可赋值关系自反性
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { isAssignable } from './portType';
import { arbitraryPortType } from './arbitraries';

describe('Property 1: assignability reflexivity', () => {
  it('isAssignable(t, t) holds for all PortType t', () => {
    fc.assert(
      fc.property(arbitraryPortType(), (t) => {
        return isAssignable(t, t) === true;
      }),
      { numRuns: 100 },
    );
  });
});
