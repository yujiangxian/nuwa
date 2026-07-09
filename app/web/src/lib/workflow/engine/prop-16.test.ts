// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-execution-engine, Property 16: 失败处理与故障传播
//
// Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5
//
// For a Valid_Graph with a node whose executor always fails:
//  - that node becomes Failed;
//  - under `block_downstream`, the exclusively-downstream node becomes Blocked, an
//    independent live branch still Completes, and RunStatus settles to Failed;
//  - under `fail_fast`, RunStatus becomes Failed immediately and no further node runs;
//  - a Blocked node's executor is never invoked.
//
// Graph shape:
//        A ── F (fails) ── D        D is exclusively downstream of F
//         └── I                     I is an independent live branch off A

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { NODE_TYPES } from '../types';
import type { JsonValue, NodeType, Port, PortType, WorkflowGraph, WorkflowNode } from '../types';
import { validateGraph } from '../validate';
import { ExecutorErrorCode, initialState, run } from './index';
import type {
  ExecutionEnvironment,
  ErrorPolicy,
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
const failingExecutor: NodeExecutor = (node) => ({
  ok: false,
  code: ExecutorErrorCode.EXECUTOR_FAILED,
  message: `Injected failure for "${node.id}".`,
});

function inputPort(id: string): Port {
  return { id, direction: 'input', portType: J, required: true };
}
function outputPort(id: string): Port {
  return { id, direction: 'output', portType: J, required: false };
}

function buildFailureGraph(t: {
  readonly a: NodeType;
  readonly f: NodeType;
  readonly d: NodeType;
  readonly i: NodeType;
}): WorkflowGraph {
  const nodes: WorkflowNode[] = [
    { id: 'A', type: t.a, config: {}, inputs: [], outputs: [outputPort('out')] },
    { id: 'F', type: t.f, config: {}, inputs: [inputPort('in')], outputs: [outputPort('out')] },
    { id: 'D', type: t.d, config: {}, inputs: [inputPort('in')], outputs: [outputPort('out')] },
    { id: 'I', type: t.i, config: {}, inputs: [inputPort('in')], outputs: [outputPort('out')] },
  ];
  const edges = [
    { id: 'e0', source: { nodeId: 'A', portId: 'out' }, target: { nodeId: 'F', portId: 'in' } },
    { id: 'e1', source: { nodeId: 'F', portId: 'out' }, target: { nodeId: 'D', portId: 'in' } },
    { id: 'e2', source: { nodeId: 'A', portId: 'out' }, target: { nodeId: 'I', portId: 'in' } },
  ];
  return { nodes, edges, loopScopes: [], entryNodeId: 'A' };
}

function makeRegistry(failing: ReadonlySet<string>): NodeExecutorRegistry {
  const byType = new Map<NodeType, NodeExecutor>();
  for (const t of NODE_TYPES) byType.set(t, successExecutor);
  const byNodeId = new Map<string, NodeExecutor>();
  for (const id of failing) byNodeId.set(id, failingExecutor);
  return { byType, byNodeId };
}

function envFor(failing: ReadonlySet<string>, errorPolicy: ErrorPolicy): {
  readonly env: ExecutionEnvironment;
  readonly calls: () => ReadonlyArray<{ nodeId: string }>;
} {
  const rec = recordingRegistry(makeRegistry(failing));
  return {
    env: {
      executorRegistry: rec.registry,
      conditionEvaluator: () => ({ ok: true, value: true }),
      humanInputProvider: () => undefined,
      errorPolicy,
    },
    calls: rec.calls,
  };
}

// Only executor-driven node types (the failing node must be executor-driven).
const normalType = fc.constantFrom<NodeType>('llm', 'tool', 'transform');

describe('Property 16: failure handling and fault propagation', () => {
  it('blocks exclusive downstream under block_downstream and stops immediately under fail_fast', () => {
    const arb = fc.record({ a: normalType, f: normalType, d: normalType, i: normalType });

    fc.assert(
      fc.property(arb, (t) => {
        const graph = buildFailureGraph(t);
        expect(validateGraph(graph).valid).toBe(true);

        const init = initialState(graph);
        expect(init.ok).toBe(true);
        if (!init.ok) return;

        const failing = new Set<string>(['F']);

        // --- block_downstream (R14.1, R14.2, R14.4, R14.5) ---
        {
          const { env, calls } = envFor(failing, 'block_downstream');
          const res = run(init.state, graph, env);
          expect(res.ok).toBe(true);
          if (!res.ok) return;
          const s = res.result.state;

          expect(s.nodeStatus.get('F')).toBe('Failed'); // R14.1
          expect(s.nodeStatus.get('D')).toBe('Blocked'); // R14.2 (D is exclusively downstream of F)
          expect(s.nodeStatus.get('I')).toBe('Completed'); // independent live branch still runs
          expect(s.runStatus).toBe('Failed'); // R14.4

          // The Blocked node's executor was never invoked (R14.5).
          const invoked = new Set(calls().map((c) => c.nodeId));
          expect(invoked.has('D')).toBe(false);
        }

        // --- fail_fast (R14.1, R14.3, R14.5) ---
        {
          const { env, calls } = envFor(failing, 'fail_fast');
          const res = run(init.state, graph, env);
          expect(res.ok).toBe(true);
          if (!res.ok) return;
          const s = res.result.state;

          expect(s.nodeStatus.get('F')).toBe('Failed'); // R14.1
          expect(s.runStatus).toBe('Failed'); // R14.3 immediate

          // fail_fast does not block; it just stops. No node is Blocked.
          for (const status of s.nodeStatus.values()) {
            expect(status).not.toBe('Blocked');
          }
          // No further node ran past the failure: D neither completed nor was invoked.
          expect(s.nodeStatus.get('D')).not.toBe('Completed');
          const invoked = new Set(calls().map((c) => c.nodeId));
          expect(invoked.has('D')).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });
});
