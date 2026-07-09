// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-execution-engine — example/edge test: loop hits maxIterations exactly.
// Validates: Requirements 8.4, 9.1
//
// An explicit loop whose break-condition evaluator is constant-false runs the body
// exactly `maxIterations` times, then leaves through the loop header's `exit` port.
// We assert the loop-body node's executor was invoked exactly `maxIterations` times
// (observed via the recording registry) and that the run ends Completed.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { initialState, run } from './index';
import type { ConditionEvaluator, ExecutionEnvironment } from './index';
import { arbitraryNodeExecutorRegistry, recordingRegistry } from './arbitraries';
import { validateGraph } from '../validate';
import type { Port, PortType, WorkflowGraph, WorkflowNode } from '../types';

const JSON_T: PortType = { kind: 'json' };

function inPort(id: string, required: boolean): Port {
  return { id, direction: 'input', portType: JSON_T, required };
}
function outPort(id: string): Port {
  return { id, direction: 'output', portType: JSON_T, required: false };
}

const MAX_ITERATIONS = 3;

// Loop header H (entry); body node B; sink X on the exit path.
//   e1: H.body_in  -> B.in       (forward, enters the body)
//   e2: B.out      -> H.body_back(well-formed back-edge: target is the loop header)
//   e3: H.exit     -> X.in       (forward, exit path)
const header: WorkflowNode = {
  id: 'H',
  type: 'loop',
  config: { maxIterations: MAX_ITERATIONS },
  inputs: [inPort('body_back', false)],
  outputs: [outPort('body_in'), outPort('exit')],
};
const body: WorkflowNode = {
  id: 'B',
  type: 'transform',
  config: {},
  inputs: [inPort('in', true)],
  outputs: [outPort('out')],
};
const sink: WorkflowNode = {
  id: 'X',
  type: 'transform',
  config: {},
  inputs: [inPort('in', true)],
  outputs: [outPort('out')],
};

const graph: WorkflowGraph = {
  nodes: [header, body, sink],
  edges: [
    { id: 'e1', source: { nodeId: 'H', portId: 'body_in' }, target: { nodeId: 'B', portId: 'in' } },
    { id: 'e2', source: { nodeId: 'B', portId: 'out' }, target: { nodeId: 'H', portId: 'body_back' } },
    { id: 'e3', source: { nodeId: 'H', portId: 'exit' }, target: { nodeId: 'X', portId: 'in' } },
  ],
  loopScopes: [{ id: 'L', headerNodeId: 'H', bodyNodeIds: ['B'] }],
  entryNodeId: 'H',
};

// Constant-false break condition: the loop only exits when the counter reaches the bound.
const constantFalse: ConditionEvaluator = () => ({ ok: true, value: false });

describe('example: loop runs exactly maxIterations times', () => {
  it('is a valid graph', () => {
    expect(validateGraph(graph).valid).toBe(true);
  });

  it('invokes the body executor exactly maxIterations times and ends Completed (R8.4, R9.1)', () => {
    const init = initialState(graph);
    expect(init.ok).toBe(true);
    if (!init.ok) return;

    const baseRegistry = fc.sample(arbitraryNodeExecutorRegistry(graph), 1)[0];
    const recording = recordingRegistry(baseRegistry);
    const env: ExecutionEnvironment = {
      executorRegistry: recording.registry,
      conditionEvaluator: constantFalse,
      humanInputProvider: () => undefined,
      errorPolicy: 'block_downstream',
    };

    const outcome = run(init.state, graph, env);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // The loop exits via `exit`, so the run completes.
    expect(outcome.result.state.runStatus).toBe('Completed');
    // The body node B ran once per iteration, exactly maxIterations times.
    const bodyCalls = recording.calls().filter((c) => c.nodeId === 'B');
    expect(bodyCalls.length).toBe(MAX_ITERATIONS);
    // The loop counter settled at maxIterations and the exit edge was satisfied.
    expect(outcome.result.state.loopCounters.get('L')).toBe(MAX_ITERATIONS);
    expect(outcome.result.state.satisfiedEdges.has('e3')).toBe(true);
    // The exit-path sink completed.
    expect(outcome.result.state.nodeStatus.get('X')).toBe('Completed');
  });
});
