// Feature: workflow-execution-engine, Property 7: ValueStore 完整性
//
// Stepping a run from its initial state, the ValueStore only grows monotonically
// (every (key,value) of a state is preserved unchanged in the next state — no
// deletion, no overwrite, i.e. each Value_Key is written at most once), and every
// satisfied edge delivers the source endpoint's produced value to the target
// Input_Port. A recordingRegistry bounds the per-node executor invocations (the
// mechanism that keeps each Value_Key write-once).
// Validates: Requirements 4.3, 6.1, 6.2, 6.3, 6.4, 8.5.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import type { WorkflowGraph } from '../types';
import { initialState, step, stepBudget } from './index';
import {
  arbitraryValidGraph,
  arbitraryExecutionEnvironment,
  recordingRegistry,
} from './arbitraries';

/** Stable JSON encoding for value equality comparisons. */
function enc(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Upper bound on the number of distinct iteration-scope indices an executor for
 * `nodeId` can be invoked at: the product, over every LoopScope whose body
 * contains `nodeId`, of `(maxIterations + 1)` (1 when `nodeId` is outside every
 * loop body).
 *
 * Why `maxIterations + 1` rather than `maxIterations`: a loop's counter ranges
 * over `0..maxIterations`, and a body node may execute once per distinct counter
 * value — including at the base scope (counter 0) when the node is independently
 * Ready (e.g. all of its inputs are optional) in addition to each driven
 * iteration. Each such execution writes to a DISTINCT Value_Key (a different
 * iterationIndex), so the write-once-per-key invariant — verified directly by
 * the monotone / no-overwrite / write-once checks below — is never violated.
 * This count is the sound upper bound on per-node executor invocations.
 */
function enclosingIterationProduct(graph: WorkflowGraph, nodeId: string): number {
  let product = 1;
  for (const scope of graph.loopScopes) {
    if (!scope.bodyNodeIds.includes(nodeId)) continue;
    const header = graph.nodes.find((n) => n.id === scope.headerNodeId);
    const config = header?.config;
    let max = 1;
    if (config !== null && typeof config === 'object' && !Array.isArray(config)) {
      const raw = (config as { readonly maxIterations?: unknown }).maxIterations;
      if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1) max = raw;
    }
    // counter ranges 0..max → up to (max + 1) distinct iteration indices per layer.
    product *= max + 1;
  }
  return product;
}

/** All ValueStore values stored for a given endpoint (across every iteration index). */
function valuesForEndpoint(
  valueStore: ReadonlyMap<string, { readonly value: unknown }>,
  nodeId: string,
  portId: string,
): string[] {
  const prefix = `${nodeId}\u0000${portId}\u0000`;
  const out: string[] = [];
  for (const [keyStr, stored] of valueStore) {
    if (keyStr.startsWith(prefix)) out.push(enc(stored.value));
  }
  return out;
}

describe('Property 7: ValueStore integrity', () => {
  it('monotone growth, write-once, and satisfied edges deliver source values', () => {
    fc.assert(
      fc.property(
        arbitraryValidGraph({ minNodes: 1, maxNodes: 5 }).chain((graph) =>
          arbitraryExecutionEnvironment(graph, {
            answeredNodeIds: new Set(
              graph.nodes.filter((n) => n.type === 'human_input').map((n) => n.id),
            ),
          }).map((env) => ({ graph, env })),
        ),
        ({ graph, env }) => {
          const init = initialState(graph);
          if (!init.ok) return false;

          const rec = recordingRegistry(env.executorRegistry);
          const env2 = { ...env, executorRegistry: rec.registry };

          // Global write-once tracker: a Value_Key, once written, must keep its value.
          const seen = new Map<string, string>();
          let state = init.state;
          const budget = stepBudget(graph) + 5;

          for (let i = 0; i < budget; i++) {
            if (
              state.runStatus === 'Completed' ||
              state.runStatus === 'Failed' ||
              state.runStatus === 'Paused'
            ) {
              break;
            }
            const out = step(state, graph, env2);
            if (!out.ok) return false;
            const next = out.result.state;

            // Monotone + no-overwrite: every prior (key,value) survives unchanged.
            for (const [k, sv] of state.valueStore) {
              const nv = next.valueStore.get(k);
              if (nv === undefined) return false;
              if (enc(nv.value) !== enc(sv.value)) return false;
            }
            // Write-once across the whole run: a key's value never changes.
            for (const [k, sv] of next.valueStore) {
              const s = enc(sv.value);
              const prev = seen.get(k);
              if (prev !== undefined && prev !== s) return false;
              seen.set(k, s);
            }

            state = next;
            if (!out.result.progress) break;
          }

          const final = state;

          // Satisfied edges deliver the source value to the target input port: every
          // value held by the target port equals some value produced by the source.
          for (const edgeId of final.satisfiedEdges) {
            const edge = graph.edges.find((e) => e.id === edgeId);
            if (edge === undefined) continue;
            const srcVals = valuesForEndpoint(
              final.valueStore,
              edge.source.nodeId,
              edge.source.portId,
            );
            const tgtVals = valuesForEndpoint(
              final.valueStore,
              edge.target.nodeId,
              edge.target.portId,
            );
            for (const tv of tgtVals) {
              if (!srcVals.includes(tv)) return false;
            }
          }

          // Write-once mechanism: each node's executor is invoked no more than the
          // number of distinct iteration-scope indices it can occupy — the product of
          // (maxIterations + 1) over its enclosing loops (1 outside any loop). Each
          // invocation writes a distinct Value_Key, preserving write-once-per-key.
          const counts = new Map<string, number>();
          for (const call of rec.calls()) {
            counts.set(call.nodeId, (counts.get(call.nodeId) ?? 0) + 1);
          }
          for (const [nodeId, count] of counts) {
            if (count > enclosingIterationProduct(graph, nodeId)) return false;
          }

          return true;
        },
      ),
      { numRuns: 100 },
    );
    expect(true).toBe(true);
  });
});
