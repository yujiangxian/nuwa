// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-execution-engine — example/edge test: empty & single-node graphs.
// Validates: Requirements 2.5, 4.1, 10.3, 16.5
//
// Covers the smallest possible graphs:
//   - the empty graph: initialState is well-formed and run settles to Completed;
//   - a single entry node with no required inputs: it runs in one logical step,
//     the node ends Completed and the run ends Completed.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { initialState, run, step } from './index';
import type { ExecutionEnvironment } from './index';
import { arbitraryNodeExecutorRegistry } from './arbitraries';
import { validateGraph } from '../validate';
import { emptyGraph } from '../graph';
import type { Port, PortType, WorkflowGraph, WorkflowNode } from '../types';

// --- Small inline graph-construction helpers -------------------------------

const JSON_T: PortType = { kind: 'json' };

function outPort(id: string): Port {
  return { id, direction: 'output', portType: JSON_T, required: false };
}

/** Build a deterministic ExecutionEnvironment whose executors come from the test arbitrary. */
function buildEnv(graph: WorkflowGraph): ExecutionEnvironment {
  const executorRegistry = fc.sample(arbitraryNodeExecutorRegistry(graph), 1)[0];
  return {
    executorRegistry,
    // No condition/loop nodes here; a constant evaluator keeps the env total.
    conditionEvaluator: () => ({ ok: true, value: false }),
    // No human_input nodes here.
    humanInputProvider: () => undefined,
    errorPolicy: 'block_downstream',
  };
}

describe('example: empty graph', () => {
  it('produces a well-formed Idle initialState and runs to Completed', () => {
    const graph = emptyGraph();
    expect(validateGraph(graph).valid).toBe(true);

    const init = initialState(graph);
    expect(init.ok).toBe(true);
    if (!init.ok) return; // narrow for the type checker

    // R2.5: an empty graph has an empty node-status map and starts Idle.
    expect(init.state.nodeStatus.size).toBe(0);
    expect(init.state.runStatus).toBe('Idle');

    // R10.3 / R16.5: with nothing to do the run converges to Completed.
    const env = buildEnv(graph);
    const outcome = run(init.state, graph, env);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.state.runStatus).toBe('Completed');
  });
});

describe('example: single-node graph', () => {
  // One transform node, marked as the entry, with no required inputs.
  const node: WorkflowNode = {
    id: 'A',
    type: 'transform',
    config: {}, // opaque config -> engine falls back to declared output ports
    inputs: [],
    outputs: [outPort('out')],
  };
  const graph: WorkflowGraph = {
    nodes: [node],
    edges: [],
    loopScopes: [],
    entryNodeId: 'A',
  };

  it('is a valid graph', () => {
    expect(validateGraph(graph).valid).toBe(true);
  });

  it('marks the entry node Ready in initialState (R2.5)', () => {
    const init = initialState(graph);
    expect(init.ok).toBe(true);
    if (!init.ok) return;
    expect(init.state.nodeStatus.get('A')).toBe('Ready');
    expect(init.state.runStatus).toBe('Idle');
  });

  it('completes the node in one logical step and ends Completed (R4.1, R10.3, R16.5)', () => {
    const init = initialState(graph);
    expect(init.ok).toBe(true);
    if (!init.ok) return;
    const env = buildEnv(graph);

    // A single micro-step executes the only Ready node and completes it.
    const first = step(init.state, graph, env);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.result.progress).toBe(true);
    expect(first.result.state.nodeStatus.get('A')).toBe('Completed');

    // Running to completion settles the whole run.
    const outcome = run(init.state, graph, env);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.state.runStatus).toBe('Completed');
    expect(outcome.result.state.nodeStatus.get('A')).toBe('Completed');
  });
});
