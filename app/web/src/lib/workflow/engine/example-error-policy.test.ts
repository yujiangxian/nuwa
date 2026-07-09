// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-execution-engine — example/edge test: error policy contrast.
// Validates: Requirements 14.2, 14.3, 14.4
//
// One graph with a failing node F and a downstream node D reachable only through F.
// Under `fail_fast` the run fails immediately and D is neither blocked nor run.
// Under `block_downstream` D is marked Blocked and the run still settles to Failed.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { initialState, run } from './index';
import type { ErrorPolicy, ExecutionEnvironment } from './index';
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

// Chain: A (entry) -> F (always fails) -> D (downstream, reachable only via F).
const a: WorkflowNode = { id: 'A', type: 'transform', config: {}, inputs: [], outputs: [outPort('out')] };
const f: WorkflowNode = {
  id: 'F',
  type: 'transform',
  config: {},
  inputs: [inPort('in', true)],
  outputs: [outPort('out')],
};
const d: WorkflowNode = {
  id: 'D',
  type: 'transform',
  config: {},
  inputs: [inPort('in', true)],
  outputs: [outPort('out')],
};

const graph: WorkflowGraph = {
  nodes: [a, f, d],
  edges: [
    { id: 'e1', source: { nodeId: 'A', portId: 'out' }, target: { nodeId: 'F', portId: 'in' } },
    { id: 'e2', source: { nodeId: 'F', portId: 'out' }, target: { nodeId: 'D', portId: 'in' } },
  ],
  loopScopes: [],
  entryNodeId: 'A',
};

/** Build an env whose executor for node F always fails, wrapped to record all calls. */
function buildFailingEnv(errorPolicy: ErrorPolicy): {
  env: ExecutionEnvironment;
  calls: () => ReadonlyArray<{ nodeId: string }>;
} {
  const baseRegistry = fc.sample(
    arbitraryNodeExecutorRegistry(graph, { failingNodeIds: new Set(['F']) }),
    1,
  )[0];
  const recording = recordingRegistry(baseRegistry);
  return {
    env: {
      executorRegistry: recording.registry,
      conditionEvaluator: () => ({ ok: true, value: false }),
      humanInputProvider: () => undefined,
      errorPolicy,
    },
    calls: recording.calls,
  };
}

describe('example: error policy contrast (fail_fast vs block_downstream)', () => {
  it('is a valid graph', () => {
    expect(validateGraph(graph).valid).toBe(true);
  });

  it('fail_fast: fails immediately; downstream is neither Blocked nor run (R14.3, R14.4)', () => {
    const init = initialState(graph);
    expect(init.ok).toBe(true);
    if (!init.ok) return;

    const { env, calls } = buildFailingEnv('fail_fast');
    const outcome = run(init.state, graph, env);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const s = outcome.result.state;
    expect(s.runStatus).toBe('Failed');
    expect(s.nodeStatus.get('F')).toBe('Failed');
    // Under fail_fast no further node is selected: D is left untouched (not Blocked).
    expect(s.nodeStatus.get('D')).not.toBe('Blocked');
    expect(s.nodeStatus.get('D')).not.toBe('Completed');
    // D's executor was never invoked.
    expect(calls().some((c) => c.nodeId === 'D')).toBe(false);
  });

  it('block_downstream: downstream is Blocked and the run settles to Failed (R14.2, R14.4)', () => {
    const init = initialState(graph);
    expect(init.ok).toBe(true);
    if (!init.ok) return;

    const { env, calls } = buildFailingEnv('block_downstream');
    const outcome = run(init.state, graph, env);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const s = outcome.result.state;
    expect(s.nodeStatus.get('F')).toBe('Failed');
    // D is reachable only through the failed F, so it is Blocked.
    expect(s.nodeStatus.get('D')).toBe('Blocked');
    // The whole run still settles to Failed once no non-blocked progress remains.
    expect(s.runStatus).toBe('Failed');
    // A blocked node is never executed.
    expect(calls().some((c) => c.nodeId === 'D')).toBe(false);
  });
});
