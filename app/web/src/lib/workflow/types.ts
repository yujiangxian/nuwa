// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * Workflow graph model — data model types.
 *
 * Feature: workflow-graph-model
 *
 * This module declares ALL data model types and enums for the workflow graph
 * library. It contains no logic — only type declarations plus a small number of
 * literal constants (the `NODE_TYPES` array and the `ErrorCode` enum).
 *
 * All fields are conceptually immutable and are uniformly annotated `readonly`.
 */

// ---------------------------------------------------------------------------
// Base and port types (R3.1)
// ---------------------------------------------------------------------------

/** Arbitrary JSON value (used for the opaque Node_Config payload). */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** PortType: structured port value type (R3.1). Discriminated union for exhaustive matching. */
export type PortType =
  | { readonly kind: 'string' }
  | { readonly kind: 'number' }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'json' }
  | { readonly kind: 'message' }
  | { readonly kind: 'list'; readonly element: PortType }
  | { readonly kind: 'optional'; readonly inner: PortType };

/** The five base type tags. */
export type BasePortTypeKind = 'string' | 'number' | 'boolean' | 'json' | 'message';

// ---------------------------------------------------------------------------
// Nodes, ports, edges, scopes (R1, R2)
// ---------------------------------------------------------------------------

/** The set of supported node types (R1.3). */
export const NODE_TYPES = ['llm', 'condition', 'tool', 'transform', 'human_input', 'loop'] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export type PortDirection = 'input' | 'output';

/** Port (R2.1). `required` is only meaningful for inputs; ignored on outputs (R2.3). */
export interface Port {
  readonly id: string; // Port_Id (unique within a node per direction, R2.4)
  readonly direction: PortDirection;
  readonly portType: PortType;
  readonly required: boolean; // only valid for inputs
}

/**
 * Node_Config: typed configuration payload (R1.2).
 *
 * At this data-model layer it is kept as an opaque JSON value — the concrete
 * payload structure for each NodeType is defined by higher layers (the
 * execution-layer sub-spec). Here we only require that it is a canonically
 * serializable JsonValue, and that it may carry an optional discriminator
 * field for higher-layer refinement (not enforced at this layer).
 */
export type NodeConfig = JsonValue;

/** WorkflowNode (R1.2, R2). `inputs`/`outputs` are the ports of the matching direction. */
export interface WorkflowNode {
  readonly id: string; // Node_Id (unique within the graph, R4.1)
  readonly type: NodeType;
  readonly config: NodeConfig;
  readonly inputs: readonly Port[]; // all direction === 'input'
  readonly outputs: readonly Port[]; // all direction === 'output'
}

/** Endpoint: a (Node_Id, Port_Id) pair (R1.5). */
export interface Endpoint {
  readonly nodeId: string;
  readonly portId: string;
}

/** WorkflowEdge (R1.4). `source` points to an Output_Port, `target` to an Input_Port. */
export interface WorkflowEdge {
  readonly id: string; // Edge_Id (unique within the graph, R4.3)
  readonly source: Endpoint;
  readonly target: Endpoint;
}

/** LoopScope: a loop scope declaration (glossary). */
export interface LoopScope {
  readonly id: string; // Loop_Scope_Id (unique, R11.5)
  readonly headerNodeId: string; // Loop_Header (NodeType must be 'loop', R11.1)
  readonly bodyNodeIds: readonly string[]; // Loop_Body
}

/** WorkflowGraph (R1.1). `entryNodeId` is the marked EntryNode; may be null for an empty graph. */
export interface WorkflowGraph {
  readonly nodes: readonly WorkflowNode[];
  readonly edges: readonly WorkflowEdge[];
  readonly loopScopes: readonly LoopScope[];
  readonly entryNodeId: string | null;
}

// ---------------------------------------------------------------------------
// Validation result types (R12)
// ---------------------------------------------------------------------------

/** Stable enum codes for programmatic discrimination of error categories (one per rule, R4–R11). */
export enum ErrorCode {
  DUPLICATE_NODE_ID = 'DUPLICATE_NODE_ID', // R4.2
  DUPLICATE_EDGE_ID = 'DUPLICATE_EDGE_ID', // R4.4
  EDGE_REFERENCES_MISSING_NODE = 'EDGE_REFERENCES_MISSING_NODE', // R5.2
  EDGE_REFERENCES_MISSING_PORT = 'EDGE_REFERENCES_MISSING_PORT', // R5.4, R5.5
  SELF_LOOP_EDGE = 'SELF_LOOP_EDGE', // R5.6
  INCOMPATIBLE_PORT_TYPES = 'INCOMPATIBLE_PORT_TYPES', // R6.2
  INPUT_PORT_ARITY_EXCEEDED = 'INPUT_PORT_ARITY_EXCEEDED', // R7.2
  MISSING_REQUIRED_INPUT = 'MISSING_REQUIRED_INPUT', // R8.2
  ENTRY_NODE_NOT_FOUND = 'ENTRY_NODE_NOT_FOUND', // R9.2
  ENTRY_NODE_HAS_INCOMING_EDGE = 'ENTRY_NODE_HAS_INCOMING_EDGE', // R9.4
  UNREACHABLE_NODE = 'UNREACHABLE_NODE', // R9.6
  CYCLE_IN_FORWARD_SUBGRAPH = 'CYCLE_IN_FORWARD_SUBGRAPH', // R10.3
  INVALID_LOOP_HEADER = 'INVALID_LOOP_HEADER', // R11.2
  MALFORMED_BACK_EDGE = 'MALFORMED_BACK_EDGE', // R11.4
  DUPLICATE_LOOP_SCOPE_ID = 'DUPLICATE_LOOP_SCOPE_ID', // R11.6
  LOOP_BODY_REFERENCES_MISSING_NODE = 'LOOP_BODY_REFERENCES_MISSING_NODE', // R11.8
}

/** Error location info: involved ids and (where applicable) type strings. Fields filled as needed. */
export interface ErrorLocation {
  readonly nodeIds?: readonly string[];
  readonly edgeIds?: readonly string[];
  readonly portIds?: readonly string[];
  readonly loopScopeIds?: readonly string[];
  readonly cycle?: readonly string[]; // ordered node sequence for CYCLE_IN_FORWARD_SUBGRAPH
  readonly fromType?: string; // INCOMPATIBLE_PORT_TYPES: source type canonical string
  readonly toType?: string; // INCOMPATIBLE_PORT_TYPES: target type canonical string
}

export interface ValidationError {
  readonly code: ErrorCode;
  readonly message: string; // human-readable description
  readonly location: ErrorLocation;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationError[]; // empty when valid === true
}

// ---------------------------------------------------------------------------
// Analysis result types (R13–R16)
// ---------------------------------------------------------------------------

export type TopoOrder = readonly string[]; // R13
export type Layering = ReadonlyMap<string, number>; // R13.4
export type Cycle = readonly string[]; // R15: ordered node sequence
export type CriticalPath = readonly string[]; // R16

export interface AnalysisResult {
  readonly topoOrder: TopoOrder;
  readonly layering: Layering;
  readonly reachable: ReadonlySet<string>;
  readonly orphans: readonly string[];
  readonly unreachable: readonly string[];
  readonly cycles: readonly Cycle[];
  readonly criticalPath: CriticalPath;
}

// ---------------------------------------------------------------------------
// Mutation and serialization result types (R17, R18)
// ---------------------------------------------------------------------------

/** Mutation error. `code` reuses ErrorCode (e.g. DUPLICATE_NODE_ID) or a dedicated mutation code. */
export interface MutationError {
  readonly code: ErrorCode | 'NODE_NOT_FOUND' | 'EDGE_NOT_FOUND' | 'DUPLICATE_EDGE_ID';
  readonly message: string;
}

export type MutationResult =
  | { readonly ok: true; readonly graph: WorkflowGraph }
  | { readonly ok: false; readonly error: MutationError };

export interface DeserializeError {
  readonly message: string;
  readonly position?: number; // parse failure position (when available)
}

export type DeserializeResult =
  | { readonly ok: true; readonly graph: WorkflowGraph }
  | { readonly ok: false; readonly error: DeserializeError };
