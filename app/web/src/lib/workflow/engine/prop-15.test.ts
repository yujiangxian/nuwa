// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-execution-engine, Property 15: 恢复不重跑已完成节点
//
// Validates: Requirements 13.3
//
// From a serialized, then deserialized, Paused ExecutionState, resuming to terminal
// never re-invokes the NodeExecutor of any already-Completed node.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { NODE_TYPES } from '../types';
import type { JsonValue, NodeType, Port, PortType, WorkflowGraph, WorkflowNode } from '../types';
import { validateGraph } from '../validate';
import { initialState, run, serializeState, deserializeState } from './index';
import type {
  ExecutionEnvironment,
  HumanInputProvider,
  NodeExecutor,
  NodeExecutorRegistry,
} from './index';
import { recordingRegistry } from './arbitraries';

const J: PortType = { kind: 'json' };

const successExecutor: NodeExecutor = (node) => {
  const outputs = new Map<string, JsonValue>();
  for (const p of node.outputs) outputs.set(p.id, { src: node.id, port: p.id });
  return { ok: true, outputs };
};

function inputPort(id: string, required: boolean): Port {
  return { id, direction: 'input', portType: J, required };
}
function outputPort(id: string): Port {
  return { id, direction: 'output', portType: J, required: false };
}

/**
 * Build a valid linear chain with at least one normal node BEFORE the human_input
 * node, guaranteeing that some node is Completed by the time the run pauses.
 */
function buildHumanChain(
  before: readonly NodeType[],
  after: readonly NodeType[],
): { readonly graph: WorkflowGraph; readonly humanId: string } {
  const types: NodeType[] = [...before, 'human_input', ...after];
  const humanIndex = before.length;
  const ids = types.map((_, i) => `n${i}`);

  const nodes: WorkflowNode[] = types.map((type, i) => {
    const isHuman = i === humanIndex;
    const inputs: Port[] = i === 0 ? [] : [inputPort('in', true)];
    const outputs: Port[] = [outputPort(isHuman ? 'response' : 'out')];
    return { id: ids[i], type, config: {}, inputs, outputs };
  });

  const edges = types.slice(1).map((_, idx) => {
    const i = idx + 1;
    const srcIsHuman = i - 1 === humanIndex;
    return {
      id: `e${idx}`,
      source: { nodeId: ids[i - 1], portId: srcIsHuman ? 'response' : 'out' },
      target: { nodeId: ids[i], portId: 'in' },
    };
  });

  const graph: WorkflowGraph = { nodes, edges, loopScopes: [], entryNodeId: ids[0] };
  return { graph, humanId: ids[humanIndex] };
}

function makeRegistry(): NodeExecutorRegistry {
  const byType = new Map<NodeType, NodeExecutor>();
  for (const t of NODE_TYPES) byType.set(t, successExecutor);
  return { byType };
}

const noResponse: HumanInputProvider = () => undefined;
const respond: HumanInputProvider = (node) => ({ answer: node.id });

const normalType = fc.constantFrom<NodeType>('llm', 'tool', 'transform');

describe('Property 15: resume does not re-run completed nodes', () => {
  it('no already-Completed node is invoked while resuming from a serialized paused state', () => {
    const arb = fc.record({
      // At least one node runs (and Completes) before the pause.
      before: fc.array(normalType, { minLength: 1, maxLength: 2 }),
      after: fc.array(normalType, { minLength: 1, maxLength: 2 }),
    });

    fc.assert(
      fc.property(arb, ({ before, after }) => {
        const { graph } = buildHumanChain(before, after);
        expect(validateGraph(graph).valid).toBe(true);

        const init = initialState(graph);
        expect(init.ok).toBe(true);
        if (!init.ok) return;

        // Run with no response to reach a Paused state with some Completed nodes.
        const pausedEnv: ExecutionEnvironment = {
          executorRegistry: makeRegistry(),
          conditionEvaluator: () => ({ ok: true, value: true }),
          humanInputProvider: noResponse,
          errorPolicy: 'block_downstream',
        };
        const paused = run(init.state, graph, pausedEnv);
        expect(paused.ok).toBe(true);
        if (!paused.ok) return;
        expect(paused.result.state.runStatus).toBe('Paused');

        // Serialize -> deserialize the paused state.
        const de = deserializeState(serializeState(paused.result.state));
        expect(de.ok).toBe(true);
        if (!de.ok) return;

        // Collect the nodes already Completed in the paused snapshot.
        const completedBefore = new Set<string>();
        for (const [id, status] of de.state.nodeStatus) {
          if (status === 'Completed') completedBefore.add(id);
        }
        // There must be at least one completed node to make the assertion meaningful.
        expect(completedBefore.size).toBeGreaterThan(0);

        // Resume with a recording registry and a responding provider.
        const rec = recordingRegistry(makeRegistry());
        const resumeEnv: ExecutionEnvironment = {
          executorRegistry: rec.registry,
          conditionEvaluator: () => ({ ok: true, value: true }),
          humanInputProvider: respond,
          errorPolicy: 'block_downstream',
        };
        const resumed = run(de.state, graph, resumeEnv);
        expect(resumed.ok).toBe(true);
        if (!resumed.ok) return;

        // No already-Completed node was re-invoked during the resume (R13.3).
        for (const call of rec.calls()) {
          expect(completedBefore.has(call.nodeId)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });
});
