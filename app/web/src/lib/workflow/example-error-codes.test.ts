// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-graph-model — minimal reproducer for each ErrorCode (regression locator)
// Requirements: 4.2, 4.4, 5.2, 5.4, 5.6, 6.2, 7.2, 8.2, 9.2, 9.4, 9.6, 10.3, 11.2, 11.4, 11.6, 11.8
import { describe, it, expect } from 'vitest';

import { validateGraph } from './validate';
import { ErrorCode } from './types';
import type { Port, PortType, WorkflowGraph, WorkflowNode, NodeType } from './types';

// --- tiny builders ---------------------------------------------------------

const JSON_T: PortType = { kind: 'json' };
const NUMBER_T: PortType = { kind: 'number' };
const STRING_T: PortType = { kind: 'string' };

function input(id: string, portType: PortType = JSON_T, required = false): Port {
  return { id, direction: 'input', portType, required };
}

function output(id: string, portType: PortType = JSON_T): Port {
  return { id, direction: 'output', portType, required: false };
}

function node(
  id: string,
  type: NodeType,
  inputs: readonly Port[] = [],
  outputs: readonly Port[] = [],
): WorkflowNode {
  return { id, type, config: null, inputs, outputs };
}

/** Assert that validateGraph(g) reports the given ErrorCode at least once. */
function expectCode(g: WorkflowGraph, code: ErrorCode): void {
  const result = validateGraph(g);
  expect(result.errors.map((e) => e.code)).toContain(code);
}

// --- one minimal graph per ErrorCode --------------------------------------

describe('validateGraph minimal reproducers for every ErrorCode', () => {
  it('DUPLICATE_NODE_ID', () => {
    const g: WorkflowGraph = {
      nodes: [node('a', 'tool'), node('a', 'tool')],
      edges: [],
      loopScopes: [],
      entryNodeId: 'a',
    };
    expectCode(g, ErrorCode.DUPLICATE_NODE_ID);
  });

  it('DUPLICATE_EDGE_ID', () => {
    const g: WorkflowGraph = {
      nodes: [node('a', 'tool', [], [output('o')]), node('b', 'tool', [input('i')], [])],
      edges: [
        { id: 'e', source: { nodeId: 'a', portId: 'o' }, target: { nodeId: 'b', portId: 'i' } },
        { id: 'e', source: { nodeId: 'a', portId: 'o' }, target: { nodeId: 'b', portId: 'i' } },
      ],
      loopScopes: [],
      entryNodeId: 'a',
    };
    expectCode(g, ErrorCode.DUPLICATE_EDGE_ID);
  });

  it('EDGE_REFERENCES_MISSING_NODE', () => {
    const g: WorkflowGraph = {
      nodes: [node('a', 'tool', [], [output('o')])],
      edges: [
        { id: 'e', source: { nodeId: 'a', portId: 'o' }, target: { nodeId: 'ghost', portId: 'i' } },
      ],
      loopScopes: [],
      entryNodeId: 'a',
    };
    expectCode(g, ErrorCode.EDGE_REFERENCES_MISSING_NODE);
  });

  it('EDGE_REFERENCES_MISSING_PORT', () => {
    const g: WorkflowGraph = {
      nodes: [node('a', 'tool', [], [output('o')]), node('b', 'tool', [], [])],
      edges: [
        { id: 'e', source: { nodeId: 'a', portId: 'o' }, target: { nodeId: 'b', portId: 'nope' } },
      ],
      loopScopes: [],
      entryNodeId: 'a',
    };
    expectCode(g, ErrorCode.EDGE_REFERENCES_MISSING_PORT);
  });

  it('SELF_LOOP_EDGE', () => {
    const g: WorkflowGraph = {
      nodes: [node('a', 'tool', [input('i')], [output('o')])],
      edges: [
        { id: 'e', source: { nodeId: 'a', portId: 'o' }, target: { nodeId: 'a', portId: 'i' } },
      ],
      loopScopes: [],
      entryNodeId: 'a',
    };
    expectCode(g, ErrorCode.SELF_LOOP_EDGE);
  });

  it('INCOMPATIBLE_PORT_TYPES', () => {
    const g: WorkflowGraph = {
      nodes: [
        node('a', 'tool', [], [output('o', NUMBER_T)]),
        node('b', 'tool', [input('i', STRING_T)], []),
      ],
      edges: [
        { id: 'e', source: { nodeId: 'a', portId: 'o' }, target: { nodeId: 'b', portId: 'i' } },
      ],
      loopScopes: [],
      entryNodeId: 'a',
    };
    expectCode(g, ErrorCode.INCOMPATIBLE_PORT_TYPES);
  });

  it('INPUT_PORT_ARITY_EXCEEDED', () => {
    const g: WorkflowGraph = {
      nodes: [
        node('a', 'tool', [], [output('o1'), output('o2')]),
        node('b', 'tool', [input('i')], []),
      ],
      edges: [
        { id: 'e1', source: { nodeId: 'a', portId: 'o1' }, target: { nodeId: 'b', portId: 'i' } },
        { id: 'e2', source: { nodeId: 'a', portId: 'o2' }, target: { nodeId: 'b', portId: 'i' } },
      ],
      loopScopes: [],
      entryNodeId: 'a',
    };
    expectCode(g, ErrorCode.INPUT_PORT_ARITY_EXCEEDED);
  });

  it('MISSING_REQUIRED_INPUT', () => {
    const g: WorkflowGraph = {
      nodes: [node('a', 'tool', [input('i', JSON_T, true)], [])],
      edges: [],
      loopScopes: [],
      entryNodeId: 'a',
    };
    expectCode(g, ErrorCode.MISSING_REQUIRED_INPUT);
  });

  it('ENTRY_NODE_NOT_FOUND', () => {
    const g: WorkflowGraph = {
      nodes: [node('a', 'tool')],
      edges: [],
      loopScopes: [],
      entryNodeId: 'ghost',
    };
    expectCode(g, ErrorCode.ENTRY_NODE_NOT_FOUND);
  });

  it('ENTRY_NODE_HAS_INCOMING_EDGE', () => {
    const g: WorkflowGraph = {
      nodes: [
        node('a', 'tool', [input('i')], [output('o')]),
        node('b', 'tool', [], [output('o')]),
      ],
      edges: [
        { id: 'e', source: { nodeId: 'b', portId: 'o' }, target: { nodeId: 'a', portId: 'i' } },
      ],
      loopScopes: [],
      entryNodeId: 'a',
    };
    expectCode(g, ErrorCode.ENTRY_NODE_HAS_INCOMING_EDGE);
  });

  it('UNREACHABLE_NODE', () => {
    const g: WorkflowGraph = {
      nodes: [node('a', 'tool'), node('b', 'tool')],
      edges: [],
      loopScopes: [],
      entryNodeId: 'a',
    };
    expectCode(g, ErrorCode.UNREACHABLE_NODE);
  });

  it('CYCLE_IN_FORWARD_SUBGRAPH', () => {
    const g: WorkflowGraph = {
      nodes: [
        node('a', 'tool', [input('i')], [output('o')]),
        node('b', 'tool', [input('i')], [output('o')]),
      ],
      edges: [
        { id: 'e1', source: { nodeId: 'a', portId: 'o' }, target: { nodeId: 'b', portId: 'i' } },
        { id: 'e2', source: { nodeId: 'b', portId: 'o' }, target: { nodeId: 'a', portId: 'i' } },
      ],
      loopScopes: [],
      entryNodeId: 'a',
    };
    expectCode(g, ErrorCode.CYCLE_IN_FORWARD_SUBGRAPH);
  });

  it('INVALID_LOOP_HEADER', () => {
    const g: WorkflowGraph = {
      nodes: [node('a', 'tool')],
      edges: [],
      loopScopes: [{ id: 's', headerNodeId: 'a', bodyNodeIds: [] }],
      entryNodeId: 'a',
    };
    expectCode(g, ErrorCode.INVALID_LOOP_HEADER);
  });

  it('MALFORMED_BACK_EDGE', () => {
    // A forward-subgraph cycle with no declared (well-formed) back-edge: each
    // participating forward edge is flagged as a malformed back-edge.
    const g: WorkflowGraph = {
      nodes: [
        node('a', 'tool', [input('i')], [output('o')]),
        node('b', 'tool', [input('i')], [output('o')]),
      ],
      edges: [
        { id: 'e1', source: { nodeId: 'a', portId: 'o' }, target: { nodeId: 'b', portId: 'i' } },
        { id: 'e2', source: { nodeId: 'b', portId: 'o' }, target: { nodeId: 'a', portId: 'i' } },
      ],
      loopScopes: [],
      entryNodeId: 'a',
    };
    expectCode(g, ErrorCode.MALFORMED_BACK_EDGE);
  });

  it('DUPLICATE_LOOP_SCOPE_ID', () => {
    const g: WorkflowGraph = {
      nodes: [node('a', 'loop')],
      edges: [],
      loopScopes: [
        { id: 's', headerNodeId: 'a', bodyNodeIds: [] },
        { id: 's', headerNodeId: 'a', bodyNodeIds: [] },
      ],
      entryNodeId: 'a',
    };
    expectCode(g, ErrorCode.DUPLICATE_LOOP_SCOPE_ID);
  });

  it('LOOP_BODY_REFERENCES_MISSING_NODE', () => {
    const g: WorkflowGraph = {
      nodes: [node('a', 'loop')],
      edges: [],
      loopScopes: [{ id: 's', headerNodeId: 'a', bodyNodeIds: ['ghost'] }],
      entryNodeId: 'a',
    };
    expectCode(g, ErrorCode.LOOP_BODY_REFERENCES_MISSING_NODE);
  });
});
