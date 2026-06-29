// Feature: workflow-execution-engine, Property 13: human_input 暂停与响应恢复
//
// Validates: Requirements 10.5, 12.1, 12.2, 12.3
//
// For a Valid_Graph containing a human_input node: when the provider gives NO
// response, `run` ends Paused with pendingHumanInput pointing at that node, the node
// is not Completed, and no downstream node executor is invoked while paused. When the
// provider DOES respond, the response is written to the node's `response` output, the
// node becomes Completed, pendingHumanInput is cleared, and RunStatus leaves Paused.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { NODE_TYPES } from '../types';
import type { JsonValue, NodeType, Port, PortType, WorkflowGraph, WorkflowNode } from '../types';
import { validateGraph } from '../validate';
import { initialState, run, valueKeyToString } from './index';
import type {
  ExecutionEnvironment,
  HumanInputProvider,
  NodeExecutor,
  NodeExecutorRegistry,
} from './index';
import { recordingRegistry } from './arbitraries';

const J: PortType = { kind: 'json' };

// Deterministic success executor producing exactly the node's declared output ports
// (the engine's expected-port fallback for opaque configs is the declared port set).
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
 * Build a valid linear chain: `before` normal nodes, then a single human_input node,
 * then `after` normal nodes. Each node feeds the next through one edge; the
 * human_input node emits via its `response` output, normal nodes via `out`.
 */
function buildHumanChain(
  before: readonly NodeType[],
  after: readonly NodeType[],
): { readonly graph: WorkflowGraph; readonly humanId: string; readonly afterIds: readonly string[] } {
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
  return { graph, humanId: ids[humanIndex], afterIds: ids.slice(humanIndex + 1) };
}

function makeRegistry(): NodeExecutorRegistry {
  const byType = new Map<NodeType, NodeExecutor>();
  for (const t of NODE_TYPES) byType.set(t, successExecutor);
  return { byType };
}

const normalType = fc.constantFrom<NodeType>('llm', 'tool', 'transform');

describe('Property 13: human_input pause and response resume', () => {
  it('pauses with no response and completes the node on a provided response', () => {
    const arb = fc.record({
      before: fc.array(normalType, { maxLength: 2 }),
      after: fc.array(normalType, { minLength: 1, maxLength: 2 }),
    });

    fc.assert(
      fc.property(arb, ({ before, after }) => {
        const { graph, humanId, afterIds } = buildHumanChain(before, after);
        // Sanity: the constructed graph is genuinely valid.
        expect(validateGraph(graph).valid).toBe(true);

        const init = initialState(graph);
        expect(init.ok).toBe(true);
        if (!init.ok) return;

        // --- No response: the run pauses at the human_input node (R12.1, R12.3, R10.5) ---
        const noResponse: HumanInputProvider = () => undefined;
        const rec = recordingRegistry(makeRegistry());
        const pausedEnv: ExecutionEnvironment = {
          executorRegistry: rec.registry,
          conditionEvaluator: () => ({ ok: true, value: true }),
          humanInputProvider: noResponse,
          errorPolicy: 'block_downstream',
        };

        const paused = run(init.state, graph, pausedEnv);
        expect(paused.ok).toBe(true);
        if (!paused.ok) return;

        const ps = paused.result.state;
        expect(ps.runStatus).toBe('Paused');
        expect(ps.pendingHumanInput).toBe(humanId);
        expect(ps.nodeStatus.get(humanId)).not.toBe('Completed');

        // No node past the pause point ran while paused (R12.3).
        const invoked = new Set(rec.calls().map((c) => c.nodeId));
        for (const id of afterIds) {
          expect(invoked.has(id)).toBe(false);
          expect(ps.nodeStatus.get(id)).not.toBe('Completed');
        }

        // --- With response: the node completes and the run leaves Paused (R12.2) ---
        const respond: HumanInputProvider = (node) => ({ answer: node.id });
        const answeredEnv: ExecutionEnvironment = {
          executorRegistry: makeRegistry(),
          conditionEvaluator: () => ({ ok: true, value: true }),
          humanInputProvider: respond,
          errorPolicy: 'block_downstream',
        };

        const answered = run(init.state, graph, answeredEnv);
        expect(answered.ok).toBe(true);
        if (!answered.ok) return;

        const as = answered.result.state;
        expect(as.runStatus).not.toBe('Paused');
        expect(as.nodeStatus.get(humanId)).toBe('Completed');
        expect(as.pendingHumanInput).toBeNull();

        // The response is written to the node's `response` output (iteration scope 0).
        const keyStr = valueKeyToString({
          endpoint: { nodeId: humanId, portId: 'response' },
          iterationIndex: 0,
        });
        const stored = as.valueStore.get(keyStr);
        expect(stored).toBeDefined();
        expect(stored?.value).toEqual({ answer: humanId });
      }),
      { numRuns: 100 },
    );
  });
});
