// Feature: workflow-graph-model, Property 7: optional 不可解包到裸基础类型
import { describe, it } from 'vitest';
import fc from 'fast-check';

import {
  isAssignable,
  optionalOf,
  T_BOOLEAN,
  T_MESSAGE,
  T_NUMBER,
  T_STRING,
} from './portType';
import { arbitraryPortType } from './arbitraries';
import type { PortType } from './types';

describe('Property 7: optional cannot be unwrapped into a bare base type', () => {
  it('isAssignable(optionalOf(a), b) is false for non-json base b', () => {
    // The non-json base types; json is excluded because it is the global top type.
    const nonJsonBases: readonly PortType[] = [T_STRING, T_NUMBER, T_BOOLEAN, T_MESSAGE];
    fc.assert(
      fc.property(
        arbitraryPortType(),
        fc.constantFrom(...nonJsonBases),
        (a, b) => {
          return isAssignable(optionalOf(a), b) === false;
        },
      ),
      { numRuns: 100 },
    );
  });
});
