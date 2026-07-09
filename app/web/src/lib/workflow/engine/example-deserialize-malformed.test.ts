// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-execution-engine — example/edge test: malformed state deserialization.
// Validates: Requirements 15.6
//
// `deserializeState` must reject every malformed input with `{ ok: false }` and a
// readable message, and it must NEVER throw — regardless of the kind of corruption.

import { describe, it, expect } from 'vitest';

import { deserializeState, serializeState, initialState } from './index';
import { validateGraph } from '../validate';
import type { Port, PortType, WorkflowGraph, WorkflowNode } from '../types';

const JSON_T: PortType = { kind: 'json' };
function outPort(id: string): Port {
  return { id, direction: 'output', portType: JSON_T, required: false };
}

// A minimal valid graph used only to obtain a known-good canonical string as a control.
const node: WorkflowNode = { id: 'A', type: 'transform', config: {}, inputs: [], outputs: [outPort('out')] };
const graph: WorkflowGraph = { nodes: [node], edges: [], loopScopes: [], entryNodeId: 'A' };

// Each malformed input is paired with a short description for readable failure output.
const malformedInputs: ReadonlyArray<{ readonly name: string; readonly input: string }> = [
  {
    name: 'invalid JSON (unparseable)',
    input: '{ this is not json',
  },
  {
    name: 'truncated JSON',
    input: '{"nodeStatus":[],"valueStore":[',
  },
  {
    name: 'missing field (no runStatus)',
    input: JSON.stringify({
      nodeStatus: [],
      valueStore: [],
      satisfiedEdges: [],
      loopCounters: [],
      pendingHumanInput: null,
    }),
  },
  {
    name: 'wrong-typed field (nodeStatus is a number)',
    input: JSON.stringify({
      nodeStatus: 5,
      valueStore: [],
      satisfiedEdges: [],
      loopCounters: [],
      runStatus: 'Idle',
      pendingHumanInput: null,
    }),
  },
  {
    name: 'unknown ExecutionStatus enum',
    input: JSON.stringify({
      nodeStatus: [['A', 'Bogus']],
      valueStore: [],
      satisfiedEdges: [],
      loopCounters: [],
      runStatus: 'Idle',
      pendingHumanInput: null,
    }),
  },
  {
    name: 'unknown RunStatus enum',
    input: JSON.stringify({
      nodeStatus: [],
      valueStore: [],
      satisfiedEdges: [],
      loopCounters: [],
      runStatus: 'Spinning',
      pendingHumanInput: null,
    }),
  },
  {
    name: 'negative loop counter',
    input: JSON.stringify({
      nodeStatus: [],
      valueStore: [],
      satisfiedEdges: [],
      loopCounters: [['L', -1]],
      runStatus: 'Idle',
      pendingHumanInput: null,
    }),
  },
  {
    name: 'Value_Key with a non-integer iterationIndex',
    input: JSON.stringify({
      nodeStatus: [],
      valueStore: [{ key: { nodeId: 'A', portId: 'out', iterationIndex: 1.5 }, value: 1 }],
      satisfiedEdges: [],
      loopCounters: [],
      runStatus: 'Idle',
      pendingHumanInput: null,
    }),
  },
];

describe('example: deserializeState rejects malformed inputs without throwing (R15.6)', () => {
  it('accepts a known-good canonical control string (sanity check)', () => {
    expect(validateGraph(graph).valid).toBe(true);
    const init = initialState(graph);
    expect(init.ok).toBe(true);
    if (!init.ok) return;
    const canonical = serializeState(init.state);
    const result = deserializeState(canonical);
    expect(result.ok).toBe(true);
  });

  for (const { name, input } of malformedInputs) {
    it(`rejects ${name} with an error result and never throws`, () => {
      // It must not throw...
      expect(() => deserializeState(input)).not.toThrow();
      // ...and it must report a failure with a readable message.
      const result = deserializeState(input);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(typeof result.error.message).toBe('string');
      expect(result.error.message.length).toBeGreaterThan(0);
    });
  }
});
