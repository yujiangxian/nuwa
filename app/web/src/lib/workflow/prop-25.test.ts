// Feature: workflow-graph-model, Property 25: 可达/不可达分区
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { reachableNodes, unreachableNodes, orphanNodes } from './analyze';
import { forwardEdges } from './graph';
import { arbitraryWorkflowGraph } from './arbitraries';

describe('Property 25: reachable/unreachable partition', () => {
  it('entry is reachable when present; reachable and unreachable partition all node ids; orphans are non-entry with no forward incoming edge', () => {
    fc.assert(
      fc.property(arbitraryWorkflowGraph(), (g) => {
        const reachable = reachableNodes(g);
        const unreachable = new Set(unreachableNodes(g));
        const orphans = orphanNodes(g);

        const allIds = new Set(g.nodes.map((n) => n.id));

        // EntryNode belongs to the reachable set when it exists in the graph.
        if (g.entryNodeId !== null && allIds.has(g.entryNodeId)) {
          if (!reachable.has(g.entryNodeId)) return false;
        }

        // reachable ∩ unreachable = ∅
        for (const id of reachable) {
          if (unreachable.has(id)) return false;
        }

        // reachable ∪ unreachable = all node ids
        const union = new Set<string>([...reachable, ...unreachable]);
        if (union.size !== allIds.size) return false;
        for (const id of allIds) {
          if (!union.has(id)) return false;
        }

        // Every orphan is non-entry and has no forward incoming edge.
        const hasForwardIncoming = new Set<string>();
        for (const e of forwardEdges(g)) {
          if (allIds.has(e.target.nodeId)) hasForwardIncoming.add(e.target.nodeId);
        }
        for (const id of orphans) {
          if (id === g.entryNodeId) return false;
          if (hasForwardIncoming.has(id)) return false;
        }

        return true;
      }),
      { numRuns: 100 },
    );
  });
});
