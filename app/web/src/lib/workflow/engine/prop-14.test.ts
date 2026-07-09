// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-execution-engine, Property 14: 恢复等价性与幂等性
//
// Validates: Requirements 12.4, 13.1, 13.2, 13.4
//
// Pausing at a human_input node, serialize/deserialize round-tripping the paused
// state, then resuming with a responding env to a terminal status yields the SAME
// final ExecutionState (stateEquals) as running uninterrupted with the responding env
// from the start. Resuming the same paused state with the same response any number of
// times produces the same final state (idempotence).

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { NODE_TYPES } from '../types';
import type { JsonValue, NodeType, Port, PortType, WorkflowGraph, WorkflowNode } from '../types';
import { validateGraph } from '../validate';
import {
  initialState,
  run,
  serializeState,
  deserializeState,
  stateEquals,
} from './index';
import type {
  ExecutionEnvironment,
  HumanInputProvider,
  NodeExecutor,
  NodeExecutorRegistry,
} from './index';

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

/** Build a valid linear chain with a single human_input node (see Property 13). */
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

function envWith(provider: HumanInputProvider): ExecutionEnvironment {
  return {
    executorRegistry: makeRegistry(),
    conditionEvaluator: () => ({ ok: true, value: true }),
    humanInputProvider: provider,
    errorPolicy: 'block_downstream',
  };
}

const normalType = fc.constantFrom<NodeType>('llm', 'tool', 'transform');

describe('Property 14: resume equivalence and idempotence', () => {
  it('serialize/resume equals uninterrupted run and resuming is idempotent', () => {
    const arb = fc.record({
      before: fc.array(normalType, { maxLength: 2 }),
      after: fc.array(normalType, { minLength: 1, maxLength: 2 }),
    });

    fc.assert(
      fc.property(arb, ({ before, after }) => {
        const { graph } = buildHumanChain(before, after);
        expect(validateGraph(graph).valid).toBe(true);

        const init = initialState(graph);
        expect(init.ok).toBe(true);
        if (!init.ok) return;

        // 1. Run with no response until the engine pauses at the human_input node.
        const paused = run(init.state, graph, envWith(noResponse));
        expect(paused.ok).toBe(true);
        if (!paused.ok) return;
        expect(paused.result.state.runStatus).toBe('Paused');

        // 2. Serialize -> deserialize the paused state (R13.1 round-trip).
        const de = deserializeState(serializeState(paused.result.state));
        expect(de.ok).toBe(true);
        if (!de.ok) return;

        // 3. Resume with a responding env to a terminal status.
        const resumed = run(de.state, graph, envWith(respond));
        expect(resumed.ok).toBe(true);
        if (!resumed.ok) return;
        expect(resumed.result.state.runStatus).not.toBe('Paused');

        // 4. Uninterrupted run with the responding env from the very start.
        const uninterrupted = run(init.state, graph, envWith(respond));
        expect(uninterrupted.ok).toBe(true);
        if (!uninterrupted.ok) return;

        // Resume-equivalence: the two final states are semantically equal (R13.1, R13.4).
        expect(stateEquals(resumed.result.state, uninterrupted.result.state)).toBe(true);

        // Idempotence: resuming the same paused state again yields the same result
        // (R12.4, R13.2).
        const resumedAgain = run(de.state, graph, envWith(respond));
        expect(resumedAgain.ok).toBe(true);
        if (!resumedAgain.ok) return;
        expect(stateEquals(resumed.result.state, resumedAgain.result.state)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
