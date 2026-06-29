// Feature: workflow-graph-model, Property 8: 类型表示往返恒等
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { formatPortType, parsePortType, portTypeEquals } from './portType';
import { arbitraryPortType } from './arbitraries';

describe('Property 8: type representation round-trip identity', () => {
  it('portTypeEquals(parsePortType(formatPortType(t)), t) holds for all t', () => {
    fc.assert(
      fc.property(arbitraryPortType(), (t) => {
        const parsed = parsePortType(formatPortType(t));
        return parsed !== null && portTypeEquals(parsed, t);
      }),
      { numRuns: 100 },
    );
  });
});
