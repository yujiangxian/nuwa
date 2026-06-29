// Feature: workflow-graph-model, Property 23: 分层单调递增
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { layering } from './analyze';
import { forwardEdges } from './graph';
import { arbitraryValidGraph } from './arbitraries';

describe('Property 23: layering is monotonically increasing', () => {
  it('layer(entry) === 0 and layer(v) > layer(u) for every forward edge u->v with both reachable', () => {
    fc.assert(
      fc.property(arbitraryValidGraph(), (g) => {
        const layer = layering(g);

        // The entry node of a valid graph is present and reachable, with layer 0.
        if (g.entryNodeId === null) return false;
        if (layer.get(g.entryNodeId) !== 0) return false;

        // For each forward edge u->v where both endpoints are reachable (i.e. have a
        // layer assigned), the target layer must be strictly greater than the source.
        for (const e of forwardEdges(g)) {
          const lu = layer.get(e.source.nodeId);
          const lv = layer.get(e.target.nodeId);
          if (lu === undefined || lv === undefined) continue; // unreachable endpoint
          if (!(lv > lu)) return false;
        }

        return true;
      }),
      { numRuns: 100 },
    );
  });
});
