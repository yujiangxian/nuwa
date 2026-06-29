// Feature: workflow-execution-engine, Property 5: 节点不在必需输入就绪前运行
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import type { ExecutionEnvironment } from './index';
import { initialState, run } from './index';
import {
  arbitraryValidGraph,
  arbitraryExecutionEnvironment,
  recordingRegistry,
} from './arbitraries';

// A valid graph plus an environment that answers every human_input node, so the run
// drives to completion and exercises as many executor calls as possible.
const arb = arbitraryValidGraph({ minNodes: 1, maxNodes: 6 }).chain((graph) => {
  const answeredNodeIds = new Set<string>(
    graph.nodes.filter((n) => n.type === 'human_input').map((n) => n.id),
  );
  return arbitraryExecutionEnvironment(graph, { answeredNodeIds }).map((env) => ({ graph, env }));
});

describe('Property 5: a node never runs before its required inputs are ready', () => {
  it('every recorded executor call already holds all required input port values', () => {
    fc.assert(
      fc.property(arb, ({ graph, env }) => {
        const init = initialState(graph);
        expect(init.ok).toBe(true);
        if (!init.ok) return;

        // Wrap the executor registry so every invocation (node id + inputs) is recorded.
        const rec = recordingRegistry(env.executorRegistry);
        const env2: ExecutionEnvironment = { ...env, executorRegistry: rec.registry };

        const out = run(init.state, graph, env2);
        expect(out.ok).toBe(true);
        if (!out.ok) return;

        // For every executor invocation, the inputs map must already contain a produced
        // value for each of the node's required input ports. Because a node only becomes
        // Ready (and thus selectable) once its required inputs are satisfied in the
        // current iteration scope and its upstreams are Completed/Skipped, the gathered
        // inputs the executor sees necessarily cover all required input port ids.
        for (const call of rec.calls()) {
          const node = graph.nodes.find((n) => n.id === call.nodeId);
          expect(node).toBeDefined();
          if (node === undefined) continue;
          for (const port of node.inputs) {
            if (port.required) {
              expect(call.inputs.has(port.id)).toBe(true);
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
