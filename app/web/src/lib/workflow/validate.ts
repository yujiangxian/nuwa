// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * Workflow graph model — graph validator (R4–R12).
 *
 * Feature: workflow-graph-model
 *
 * This module implements the Graph_Validator: a collection of pure sub-checks
 * (one per validation rule R4–R11) plus the `validateGraph` aggregator that
 * runs every sub-check, collects ALL errors without short-circuiting, and
 * returns them in a deterministic, stable order (R12).
 *
 * Every export is a pure function: it never mutates its input and returns the
 * same output for the same input. No I/O, no time/random dependency.
 */

import {
  ErrorCode,
  type ValidationError,
  type ValidationResult,
  type WorkflowGraph,
} from './types';
import {
  buildNodeIndex,
  forwardAdjacency,
  forwardEdges,
  getInputPort,
  getNode,
  getOutputPort,
  incomingEdges,
} from './graph';
import { formatPortType, isAssignable } from './portType';

// ---------------------------------------------------------------------------
// 6.1 Duplicate node ids (R4.1–4.2)
// ---------------------------------------------------------------------------

/**
 * Detect duplicate Node_Ids. Produces one `DUPLICATE_NODE_ID` error per id that
 * appears two or more times, listing the conflicting id.
 */
export function checkDuplicateNodeIds(g: WorkflowGraph): ValidationError[] {
  const duplicates = findDuplicates(g.nodes.map((n) => n.id));
  return duplicates.map((id) => ({
    code: ErrorCode.DUPLICATE_NODE_ID,
    message: `Duplicate Node_Id: "${id}" is used by more than one node.`,
    location: { nodeIds: [id] },
  }));
}

// ---------------------------------------------------------------------------
// 6.2 Duplicate edge ids (R4.3–4.4)
// ---------------------------------------------------------------------------

/**
 * Detect duplicate Edge_Ids. Produces one `DUPLICATE_EDGE_ID` error per id that
 * appears two or more times, listing the conflicting id.
 */
export function checkDuplicateEdgeIds(g: WorkflowGraph): ValidationError[] {
  const duplicates = findDuplicates(g.edges.map((e) => e.id));
  return duplicates.map((id) => ({
    code: ErrorCode.DUPLICATE_EDGE_ID,
    message: `Duplicate Edge_Id: "${id}" is used by more than one edge.`,
    location: { edgeIds: [id] },
  }));
}

// ---------------------------------------------------------------------------
// 6.3 Edge reference legality (R5)
// ---------------------------------------------------------------------------

/**
 * Check every edge's references:
 *   - both endpoints must reference existing nodes (else EDGE_REFERENCES_MISSING_NODE);
 *   - the source endpoint must resolve to an Output_Port on its node and the
 *     target endpoint to an Input_Port (else EDGE_REFERENCES_MISSING_PORT);
 *   - source and target must not be the same node (else SELF_LOOP_EDGE).
 */
export function checkEdgeReferences(g: WorkflowGraph): ValidationError[] {
  const errors: ValidationError[] = [];
  const nodeIndex = buildNodeIndex(g);

  for (const edge of g.edges) {
    const sourceNode = nodeIndex.get(edge.source.nodeId);
    const targetNode = nodeIndex.get(edge.target.nodeId);

    // Missing node references (collect the missing node ids for this edge).
    const missingNodeIds: string[] = [];
    if (sourceNode === undefined) missingNodeIds.push(edge.source.nodeId);
    if (targetNode === undefined && edge.target.nodeId !== edge.source.nodeId) {
      missingNodeIds.push(edge.target.nodeId);
    }
    if (missingNodeIds.length > 0) {
      errors.push({
        code: ErrorCode.EDGE_REFERENCES_MISSING_NODE,
        message: `Edge "${edge.id}" references missing node(s): ${missingNodeIds
          .map((id) => `"${id}"`)
          .join(', ')}.`,
        location: { edgeIds: [edge.id], nodeIds: dedupeSorted(missingNodeIds) },
      });
    }

    // Source must be an Output_Port on an existing source node.
    if (sourceNode !== undefined && getOutputPort(sourceNode, edge.source.portId) === undefined) {
      errors.push({
        code: ErrorCode.EDGE_REFERENCES_MISSING_PORT,
        message: `Edge "${edge.id}" source does not resolve to an output port "${edge.source.portId}" on node "${edge.source.nodeId}".`,
        location: {
          edgeIds: [edge.id],
          nodeIds: [edge.source.nodeId],
          portIds: [edge.source.portId],
        },
      });
    }

    // Target must be an Input_Port on an existing target node.
    if (targetNode !== undefined && getInputPort(targetNode, edge.target.portId) === undefined) {
      errors.push({
        code: ErrorCode.EDGE_REFERENCES_MISSING_PORT,
        message: `Edge "${edge.id}" target does not resolve to an input port "${edge.target.portId}" on node "${edge.target.nodeId}".`,
        location: {
          edgeIds: [edge.id],
          nodeIds: [edge.target.nodeId],
          portIds: [edge.target.portId],
        },
      });
    }

    // Self-loop: source and target on the same node.
    if (edge.source.nodeId === edge.target.nodeId) {
      errors.push({
        code: ErrorCode.SELF_LOOP_EDGE,
        message: `Edge "${edge.id}" is a self-loop: source and target are both node "${edge.source.nodeId}".`,
        location: { edgeIds: [edge.id], nodeIds: [edge.source.nodeId] },
      });
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// 6.4 Port type compatibility (R6)
// ---------------------------------------------------------------------------

/**
 * For every reference-valid edge (source output port and target input port both
 * exist), require `isAssignable(sourceType, targetType)`. When that fails, emit
 * `INCOMPATIBLE_PORT_TYPES` recording both canonical type strings.
 */
export function checkPortTypeCompatibility(g: WorkflowGraph): ValidationError[] {
  const errors: ValidationError[] = [];
  const nodeIndex = buildNodeIndex(g);

  for (const edge of g.edges) {
    const sourceNode = nodeIndex.get(edge.source.nodeId);
    const targetNode = nodeIndex.get(edge.target.nodeId);
    if (sourceNode === undefined || targetNode === undefined) continue;

    const sourcePort = getOutputPort(sourceNode, edge.source.portId);
    const targetPort = getInputPort(targetNode, edge.target.portId);
    if (sourcePort === undefined || targetPort === undefined) continue;

    if (!isAssignable(sourcePort.portType, targetPort.portType)) {
      const fromType = formatPortType(sourcePort.portType);
      const toType = formatPortType(targetPort.portType);
      errors.push({
        code: ErrorCode.INCOMPATIBLE_PORT_TYPES,
        message: `Edge "${edge.id}" connects incompatible port types: ${fromType} is not assignable to ${toType}.`,
        location: {
          edgeIds: [edge.id],
          nodeIds: dedupeSorted([edge.source.nodeId, edge.target.nodeId]),
          portIds: dedupeSorted([edge.source.portId, edge.target.portId]),
          fromType,
          toType,
        },
      });
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// 6.5 Input port arity (R7)
// ---------------------------------------------------------------------------

/**
 * Each Input_Port may be the Target_Endpoint of at most one edge. Two or more
 * incoming edges on the same input port produce `INPUT_PORT_ARITY_EXCEEDED`.
 * Output port fan-out is unlimited and never reported.
 */
export function checkInputArity(g: WorkflowGraph): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const node of g.nodes) {
    for (const port of node.inputs) {
      const count = incomingEdges(g, node.id, port.id).length;
      if (count >= 2) {
        errors.push({
          code: ErrorCode.INPUT_PORT_ARITY_EXCEEDED,
          message: `Input port "${port.id}" on node "${node.id}" has ${count} incoming edges; at most one is allowed.`,
          location: { nodeIds: [node.id], portIds: [port.id] },
        });
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// 6.6 Required inputs (R8)
// ---------------------------------------------------------------------------

/**
 * Every `required` Input_Port must have at least one incoming edge. A required
 * input with no incoming edge produces `MISSING_REQUIRED_INPUT`. Non-required
 * inputs are exempt.
 */
export function checkRequiredInputs(g: WorkflowGraph): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const node of g.nodes) {
    for (const port of node.inputs) {
      if (!port.required) continue;
      if (incomingEdges(g, node.id, port.id).length === 0) {
        errors.push({
          code: ErrorCode.MISSING_REQUIRED_INPUT,
          message: `Required input port "${port.id}" on node "${node.id}" has no incoming edge.`,
          location: { nodeIds: [node.id], portIds: [port.id] },
        });
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// 6.7 Entry node and reachability (R9)
// ---------------------------------------------------------------------------

/**
 * For a non-empty graph:
 *   - the marked EntryNode must exist (else ENTRY_NODE_NOT_FOUND);
 *   - the EntryNode must have no incoming forward edge (else ENTRY_NODE_HAS_INCOMING_EDGE);
 *   - every node not reachable from the EntryNode in the forward subgraph is
 *     reported via a single UNREACHABLE_NODE error listing all such ids.
 */
export function checkEntryAndReachability(g: WorkflowGraph): ValidationError[] {
  // An empty graph has nothing to check (R9.1 applies to non-empty graphs).
  if (g.nodes.length === 0) return [];

  const errors: ValidationError[] = [];
  const entryId = g.entryNodeId;
  const entryNode = entryId === null ? undefined : getNode(g, entryId);

  if (entryNode === undefined) {
    errors.push({
      code: ErrorCode.ENTRY_NODE_NOT_FOUND,
      message:
        entryId === null
          ? 'The graph has nodes but no EntryNode is marked.'
          : `The marked EntryNode "${entryId}" does not exist in the node set.`,
      location: entryId === null ? {} : { nodeIds: [entryId] },
    });
    // Without a valid entry node, reachability cannot be computed.
    return errors;
  }

  // EntryNode must have no incoming forward edge.
  const incomingForward = forwardEdges(g).filter((e) => e.target.nodeId === entryNode.id);
  if (incomingForward.length > 0) {
    errors.push({
      code: ErrorCode.ENTRY_NODE_HAS_INCOMING_EDGE,
      message: `EntryNode "${entryNode.id}" has ${incomingForward.length} incoming forward edge(s).`,
      location: {
        nodeIds: [entryNode.id],
        edgeIds: dedupeSorted(incomingForward.map((e) => e.id)),
      },
    });
  }

  // Reachability over the forward subgraph from the entry node.
  const reachable = reachableFrom(g, entryNode.id);
  const unreachable = g.nodes.map((n) => n.id).filter((id) => !reachable.has(id));
  if (unreachable.length > 0) {
    errors.push({
      code: ErrorCode.UNREACHABLE_NODE,
      message: `${unreachable.length} node(s) are unreachable from EntryNode "${entryNode.id}".`,
      location: { nodeIds: dedupeSorted(unreachable) },
    });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// 6.8 Forward subgraph acyclicity (R10)
// ---------------------------------------------------------------------------

/**
 * The forward subgraph (all edges minus well-formed back-edges) must be acyclic.
 * If a cycle exists, emit `CYCLE_IN_FORWARD_SUBGRAPH` carrying the ordered
 * Node_Id sequence of one cycle (consecutive ids, including wrap-around, have a
 * forward edge between them).
 */
export function checkForwardAcyclicity(g: WorkflowGraph): ValidationError[] {
  const cycle = findForwardCycle(g);
  if (cycle === null) return [];
  return [
    {
      code: ErrorCode.CYCLE_IN_FORWARD_SUBGRAPH,
      message: `The forward subgraph contains a cycle: ${cycle.map((id) => `"${id}"`).join(' -> ')}.`,
      location: { cycle, nodeIds: dedupeSorted(cycle) },
    },
  ];
}

// ---------------------------------------------------------------------------
// 6.9 Loop scopes and back-edge well-formedness (R11)
// ---------------------------------------------------------------------------

/**
 * Validate loop scopes:
 *   - INVALID_LOOP_HEADER: the Loop_Header node is missing or its NodeType is
 *     not `loop`;
 *   - DUPLICATE_LOOP_SCOPE_ID: two or more scopes share a Loop_Scope_Id;
 *   - LOOP_BODY_REFERENCES_MISSING_NODE: a Loop_Body references a missing node;
 *   - MALFORMED_BACK_EDGE: an edge participates in a forward-subgraph cycle but
 *     is not a well-formed back-edge (well-formed back-edges are excluded from
 *     the forward subgraph and therefore never flagged).
 */
export function checkLoopScopes(g: WorkflowGraph): ValidationError[] {
  const errors: ValidationError[] = [];
  const nodeIndex = buildNodeIndex(g);

  // Duplicate loop scope ids.
  for (const id of findDuplicates(g.loopScopes.map((s) => s.id))) {
    errors.push({
      code: ErrorCode.DUPLICATE_LOOP_SCOPE_ID,
      message: `Duplicate Loop_Scope_Id: "${id}" is used by more than one loop scope.`,
      location: { loopScopeIds: [id] },
    });
  }

  for (const scope of g.loopScopes) {
    // Invalid loop header: missing node or node type is not 'loop'.
    const header = nodeIndex.get(scope.headerNodeId);
    if (header === undefined || header.type !== 'loop') {
      errors.push({
        code: ErrorCode.INVALID_LOOP_HEADER,
        message:
          header === undefined
            ? `Loop scope "${scope.id}" header node "${scope.headerNodeId}" does not exist.`
            : `Loop scope "${scope.id}" header node "${scope.headerNodeId}" has type "${header.type}", expected "loop".`,
        location: { loopScopeIds: [scope.id], nodeIds: [scope.headerNodeId] },
      });
    }

    // Loop body references missing nodes.
    const missingBody = dedupeSorted(scope.bodyNodeIds.filter((id) => !nodeIndex.has(id)));
    if (missingBody.length > 0) {
      errors.push({
        code: ErrorCode.LOOP_BODY_REFERENCES_MISSING_NODE,
        message: `Loop scope "${scope.id}" body references missing node(s): ${missingBody
          .map((id) => `"${id}"`)
          .join(', ')}.`,
        location: { loopScopeIds: [scope.id], nodeIds: missingBody },
      });
    }
  }

  // Malformed back-edges: forward edges that participate in a cycle.
  const adjacency = forwardAdjacency(g);
  for (const edge of forwardEdges(g)) {
    // Edge u->v forms a cycle iff v can reach u within the forward subgraph.
    if (forwardReaches(adjacency, edge.target.nodeId, edge.source.nodeId)) {
      errors.push({
        code: ErrorCode.MALFORMED_BACK_EDGE,
        message: `Edge "${edge.id}" forms a cycle but is not a well-formed back-edge.`,
        location: {
          edgeIds: [edge.id],
          nodeIds: dedupeSorted([edge.source.nodeId, edge.target.nodeId]),
        },
      });
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// 6.10 Aggregator with deterministic ordering (R12)
// ---------------------------------------------------------------------------

/** The fixed order in which sub-checks are run (R12.6: collect all, no short-circuit). */
const SUB_CHECKS: readonly ((g: WorkflowGraph) => ValidationError[])[] = [
  checkDuplicateNodeIds,
  checkDuplicateEdgeIds,
  checkEdgeReferences,
  checkPortTypeCompatibility,
  checkInputArity,
  checkRequiredInputs,
  checkEntryAndReachability,
  checkForwardAcyclicity,
  checkLoopScopes,
];

/** Rank of each ErrorCode by its declaration order in the enum (stable sort key). */
const ERROR_CODE_RANK: ReadonlyMap<string, number> = new Map(
  Object.values(ErrorCode).map((code, index) => [code, index]),
);

/**
 * Run every sub-check in a fixed order, collect ALL errors (no short-circuit),
 * sort them deterministically, and return the aggregated ValidationResult.
 *
 * Sort key: first by ErrorCode enum order, then by the location ids joined as
 * nodeIds -> edgeIds -> portIds -> loopScopeIds (lexicographically).
 */
export function validateGraph(g: WorkflowGraph): ValidationResult {
  const errors: ValidationError[] = [];
  for (const check of SUB_CHECKS) {
    errors.push(...check(g));
  }

  const sorted = [...errors].sort(compareErrors);
  return { valid: sorted.length === 0, errors: sorted };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Deterministic comparator for ValidationError (by code rank, then location key). */
function compareErrors(a: ValidationError, b: ValidationError): number {
  const rankA = ERROR_CODE_RANK.get(a.code) ?? Number.MAX_SAFE_INTEGER;
  const rankB = ERROR_CODE_RANK.get(b.code) ?? Number.MAX_SAFE_INTEGER;
  if (rankA !== rankB) return rankA - rankB;

  const keyA = locationKey(a);
  const keyB = locationKey(b);
  if (keyA < keyB) return -1;
  if (keyA > keyB) return 1;
  return 0;
}

/** Build the lexicographic sort key: nodeIds -> edgeIds -> portIds -> loopScopeIds. */
function locationKey(e: ValidationError): string {
  const loc = e.location;
  return [loc.nodeIds, loc.edgeIds, loc.portIds, loc.loopScopeIds]
    .map((ids) => (ids ?? []).join(','))
    .join('|');
}

/** Return the values (sorted, unique) that occur two or more times in `ids`. */
function findDuplicates(ids: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const id of ids) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const duplicates: string[] = [];
  for (const [id, count] of counts) {
    if (count >= 2) duplicates.push(id);
  }
  return duplicates.sort();
}

/** Return the unique elements of `ids` in lexicographic order. */
function dedupeSorted(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

/** Compute the set of node ids reachable from `start` over the forward subgraph. */
function reachableFrom(g: WorkflowGraph, start: string): Set<string> {
  const adjacency = forwardAdjacency(g);
  const visited = new Set<string>([start]);
  const queue: string[] = [start];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return visited;
}

/** Whether `to` is reachable from `from` (path length >= 0) over the adjacency. */
function forwardReaches(
  adjacency: ReadonlyMap<string, readonly string[]>,
  from: string,
  to: string,
): boolean {
  const visited = new Set<string>([from]);
  const queue: string[] = [from];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (current === to) return true;
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

/**
 * Find one cycle in the forward subgraph using a three-color DFS. Nodes and
 * neighbors are visited in lexicographic order for determinism. Returns the
 * ordered Node_Id sequence of a cycle, or `null` if the forward subgraph is
 * acyclic. The returned sequence [v, ..., u] satisfies: a forward edge exists
 * between each consecutive pair and from the last id back to the first.
 */
function findForwardCycle(g: WorkflowGraph): readonly string[] | null {
  const adjacency = forwardAdjacency(g);

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of adjacency.keys()) color.set(id, WHITE);

  const stack: string[] = [];
  let cycle: string[] | null = null;

  const visit = (u: string): boolean => {
    color.set(u, GRAY);
    stack.push(u);
    const neighbors = [...(adjacency.get(u) ?? [])].sort();
    for (const v of neighbors) {
      if (!color.has(v)) color.set(v, WHITE);
      const c = color.get(v);
      if (c === WHITE) {
        if (visit(v)) return true;
      } else if (c === GRAY) {
        const idx = stack.indexOf(v);
        cycle = stack.slice(idx);
        return true;
      }
    }
    stack.pop();
    color.set(u, BLACK);
    return false;
  };

  for (const start of [...adjacency.keys()].sort()) {
    if (color.get(start) === WHITE) {
      if (visit(start)) break;
    }
  }

  return cycle;
}
