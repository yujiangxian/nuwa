// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * Workflow graph model — graph mutation operations (Graph_Mutator, R17).
 *
 * Feature: workflow-graph-model
 *
 * Pure, side-effect-free mutation operations over a WorkflowGraph. Every
 * function is PURE and MUST NOT mutate its input graph (R17.1): each returns a
 * brand-new WorkflowGraph produced by shallow-copying the top-level arrays and
 * replacing only the affected elements (structural sharing for the rest).
 *
 * Each function returns a `MutationResult` discriminating success (`ok: true`
 * with the new graph) from failure (`ok: false` with a `MutationError`).
 *
 * Mutations do NOT run full validation here (kept pure and composable); callers
 * run `validateGraph` on demand.
 *
 * This module depends only on the data model types declared in `./types` and
 * the `getNode`/`getEdge` accessors from `./graph`.
 */

import type {
  MutationResult,
  NodeConfig,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
} from './types';
import { ErrorCode } from './types';
import { getEdge, getNode } from './graph';

// ---------------------------------------------------------------------------
// 8.1 addNode (R17.2–R17.3)
// ---------------------------------------------------------------------------

/**
 * Add a node to the graph.
 *
 * If `node.id` is not already present, return a success result whose graph has
 * the node appended (input graph unchanged). If a node with the same id already
 * exists, reject with a `DUPLICATE_NODE_ID` error (R17.2, R17.3).
 */
export function addNode(g: WorkflowGraph, node: WorkflowNode): MutationResult {
  if (getNode(g, node.id) !== undefined) {
    return {
      ok: false,
      error: {
        code: ErrorCode.DUPLICATE_NODE_ID,
        message: `A node with id "${node.id}" already exists in the graph.`,
      },
    };
  }
  // Shallow-copy the nodes array and append; everything else is shared.
  return {
    ok: true,
    graph: {
      ...g,
      nodes: [...g.nodes, node],
    },
  };
}

// ---------------------------------------------------------------------------
// 8.2 removeNode — cascade edge removal (R17.4)
// ---------------------------------------------------------------------------

/**
 * Remove the node with `nodeId` together with every edge that has `nodeId` as
 * its source or target endpoint (cascade removal, R17.4).
 *
 * Removing a non-existent node is a safe no-op that still succeeds, returning
 * an equivalent new graph. This supports idempotency (R17.8): calling
 * `removeNode` twice with the same id yields a graph semantically equal to a
 * single call.
 */
export function removeNode(g: WorkflowGraph, nodeId: string): MutationResult {
  return {
    ok: true,
    graph: {
      ...g,
      nodes: g.nodes.filter((n) => n.id !== nodeId),
      // Cascade: drop any edge touching the removed node on either endpoint.
      edges: g.edges.filter(
        (e) => e.source.nodeId !== nodeId && e.target.nodeId !== nodeId,
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// 8.3 addEdge (R17.5)
// ---------------------------------------------------------------------------

/**
 * Add an edge to the graph.
 *
 * If `edge.id` is not already present, return a success result whose graph has
 * the edge appended (input graph unchanged). A duplicate Edge_Id is rejected
 * with a `DUPLICATE_EDGE_ID` error (R17.5).
 */
export function addEdge(g: WorkflowGraph, edge: WorkflowEdge): MutationResult {
  if (getEdge(g, edge.id) !== undefined) {
    return {
      ok: false,
      error: {
        code: ErrorCode.DUPLICATE_EDGE_ID,
        message: `An edge with id "${edge.id}" already exists in the graph.`,
      },
    };
  }
  return {
    ok: true,
    graph: {
      ...g,
      edges: [...g.edges, edge],
    },
  };
}

// ---------------------------------------------------------------------------
// 8.4 removeEdge (R17.6)
// ---------------------------------------------------------------------------

/**
 * Remove the edge with `edgeId`.
 *
 * Removing a non-existent edge is a safe no-op that still succeeds, returning
 * an equivalent new graph (supports idempotency, R17.8).
 */
export function removeEdge(g: WorkflowGraph, edgeId: string): MutationResult {
  return {
    ok: true,
    graph: {
      ...g,
      edges: g.edges.filter((e) => e.id !== edgeId),
    },
  };
}

// ---------------------------------------------------------------------------
// 8.5 replaceNodeConfig (R17.7)
// ---------------------------------------------------------------------------

/**
 * Replace ONLY the `config` of the node with `nodeId`, keeping its `id`,
 * `type`, `inputs`, `outputs` and all other nodes/edges/loop scopes/entry node
 * unchanged (R17.7).
 *
 * If the target node does not exist, reject with a `NODE_NOT_FOUND` error.
 */
export function replaceNodeConfig(
  g: WorkflowGraph,
  nodeId: string,
  config: NodeConfig,
): MutationResult {
  if (getNode(g, nodeId) === undefined) {
    return {
      ok: false,
      error: {
        code: 'NODE_NOT_FOUND',
        message: `No node with id "${nodeId}" exists in the graph.`,
      },
    };
  }
  return {
    ok: true,
    graph: {
      ...g,
      // Replace only the matching node's config; all other nodes are shared.
      nodes: g.nodes.map((n) => (n.id === nodeId ? { ...n, config } : n)),
    },
  };
}
