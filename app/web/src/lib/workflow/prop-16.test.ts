// Feature: workflow-graph-model, Property 16: 入口节点与可达性检出
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { validateGraph } from './validate';
import { ErrorCode, type WorkflowGraph, type WorkflowNode } from './types';
import { addEntryIncomingEdge, arbitraryValidGraph } from './arbitraries';

/** Produce a Node_Id not present among the graph's nodes. */
function freshNodeId(g: WorkflowGraph): string {
  const existing = new Set(g.nodes.map((n) => n.id));
  let i = 0;
  let id = 'ghost_entry';
  while (existing.has(id)) id = `ghost_entry_${i++}`;
  return id;
}

describe('Property 16: entry node and reachability detection', () => {
  it('missing entry -> ENTRY_NODE_NOT_FOUND; entry incoming -> ENTRY_NODE_HAS_INCOMING_EDGE; isolated node -> UNREACHABLE_NODE', () => {
    fc.assert(
      fc.property(arbitraryValidGraph({ minNodes: 2, maxNodes: 5 }), (g) => {
        // (a) Entry that does not exist in the node set.
        const missingEntry: WorkflowGraph = { ...g, entryNodeId: freshNodeId(g) };
        if (
          !validateGraph(missingEntry).errors.some((e) => e.code === ErrorCode.ENTRY_NODE_NOT_FOUND)
        ) {
          return false;
        }

        // (b) Add a forward incoming edge to the EntryNode.
        const mIncoming = addEntryIncomingEdge(g);
        if (mIncoming !== null) {
          const codes = validateGraph(mIncoming.graph).errors.map((e) => e.code);
          if (!codes.includes(ErrorCode.ENTRY_NODE_HAS_INCOMING_EDGE)) return false;
        }

        // (c) Add an isolated (unconnected) node -> unreachable from the entry.
        const isolated: WorkflowNode = {
          id: freshNodeId(g),
          type: 'tool',
          config: null,
          inputs: [],
          outputs: [],
        };
        const withIsolated: WorkflowGraph = { ...g, nodes: [...g.nodes, isolated] };
        if (
          !validateGraph(withIsolated).errors.some((e) => e.code === ErrorCode.UNREACHABLE_NODE)
        ) {
          return false;
        }

        return true;
      }),
      { numRuns: 100 },
    );
  });
});
