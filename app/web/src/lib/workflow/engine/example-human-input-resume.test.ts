// Feature: workflow-execution-engine — example/edge test: human_input pause & resume.
// Validates: Requirements 12.1, 12.2, 13.1
//
// With a no-response provider the run pauses at the human_input node and records it
// in `pendingHumanInput`. Injecting a responding provider resumes the run to a
// terminal state with the node Completed. The resumed final state is semantically
// equal to an uninterrupted run that had the response available from the start.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { initialState, run, step, stateEquals } from './index';
import type { ExecutionEnvironment, HumanInputProvider, NodeExecutorRegistry } from './index';
import { arbitraryNodeExecutorRegistry, arbitraryHumanInputProvider } from './arbitraries';
import { validateGraph } from '../validate';
import type { Port, PortType, WorkflowGraph, WorkflowNode } from '../types';

const JSON_T: PortType = { kind: 'json' };
function inPort(id: string, required: boolean): Port {
  return { id, direction: 'input', portType: JSON_T, required };
}
function outPort(id: string): Port {
  return { id, direction: 'output', portType: JSON_T, required: false };
}

// H (human_input, entry) -> Z (transform sink, depends on the human response).
const human: WorkflowNode = {
  id: 'H',
  type: 'human_input',
  config: {},
  inputs: [],
  outputs: [outPort('response')],
};
const sink: WorkflowNode = {
  id: 'Z',
  type: 'transform',
  config: {},
  inputs: [inPort('in', true)],
  outputs: [outPort('out')],
};

const graph: WorkflowGraph = {
  nodes: [human, sink],
  edges: [
    { id: 'e1', source: { nodeId: 'H', portId: 'response' }, target: { nodeId: 'Z', portId: 'in' } },
  ],
  loopScopes: [],
  entryNodeId: 'H',
};

/** Compose an env reusing one fixed executor registry, varying only the human provider. */
function buildEnv(registry: NodeExecutorRegistry, provider: HumanInputProvider): ExecutionEnvironment {
  return {
    executorRegistry: registry,
    conditionEvaluator: () => ({ ok: true, value: false }),
    humanInputProvider: provider,
    errorPolicy: 'block_downstream',
  };
}

describe('example: human_input pause then resume', () => {
  it('is a valid graph', () => {
    expect(validateGraph(graph).valid).toBe(true);
  });

  it('pauses on no response, resumes on a response, and matches an uninterrupted run (R12.1, R12.2, R13.1)', () => {
    const init = initialState(graph);
    expect(init.ok).toBe(true);
    if (!init.ok) return;

    // A single, shared executor registry so executor-produced values are identical
    // across the interrupted and uninterrupted runs (the arbitrary is deterministic).
    const registry = fc.sample(arbitraryNodeExecutorRegistry(graph), 1)[0];
    const noResponse = fc.sample(arbitraryHumanInputProvider(graph), 1)[0]; // answers nobody
    const responding = fc.sample(
      arbitraryHumanInputProvider(graph, { answeredNodeIds: new Set(['H']) }),
      1,
    )[0];

    // 1. No-response provider: the run pauses at H with pendingHumanInput recorded.
    const pausedOutcome = run(init.state, graph, buildEnv(registry, noResponse));
    expect(pausedOutcome.ok).toBe(true);
    if (!pausedOutcome.ok) return;
    const pausedState = pausedOutcome.result.state;
    expect(pausedState.runStatus).toBe('Paused');
    expect(pausedState.pendingHumanInput).toBe('H');
    expect(pausedState.nodeStatus.get('H')).not.toBe('Completed');

    // 2. Inject a responding provider and resume. `run` stops at a Paused boundary
    //    (R10.1), so resume is driven by a `step` that transitions Paused -> Running
    //    (decision priority 2), after which `run` drives the rest to completion.
    const respEnv = buildEnv(registry, responding);
    const resumeStep = step(pausedState, graph, respEnv);
    expect(resumeStep.ok).toBe(true);
    if (!resumeStep.ok) return;
    expect(resumeStep.result.progress).toBe(true);
    expect(resumeStep.result.state.runStatus).toBe('Running');
    expect(resumeStep.result.state.pendingHumanInput).toBeNull();

    const resumedOutcome = run(resumeStep.result.state, graph, respEnv);
    expect(resumedOutcome.ok).toBe(true);
    if (!resumedOutcome.ok) return;
    const resumedState = resumedOutcome.result.state;
    expect(resumedState.runStatus).toBe('Completed');
    expect(resumedState.nodeStatus.get('H')).toBe('Completed');
    expect(resumedState.nodeStatus.get('Z')).toBe('Completed');
    expect(resumedState.pendingHumanInput).toBeNull();

    // 3. An uninterrupted run with the response available from the start.
    const uninterruptedOutcome = run(init.state, graph, respEnv);
    expect(uninterruptedOutcome.ok).toBe(true);
    if (!uninterruptedOutcome.ok) return;
    const uninterruptedState = uninterruptedOutcome.result.state;
    expect(uninterruptedState.runStatus).toBe('Completed');

    // Pause-then-resume reaches the same terminal state as running straight through.
    expect(stateEquals(resumedState, uninterruptedState)).toBe(true);
  });
});
