// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * integration-roadmap: fixed 18-node dependency graph and core data models.
 *
 * This module is the orchestration layer's pure data backbone. It declares the
 * TypeScript types from the design document's "Data Models" section and the
 * single source of truth `ROADMAP_GRAPH` — a `DependencyGraph` registering all
 * 18 Module_Unit nodes with their direct Upstream_Dependency lists and
 * Phase_Order (0..4).
 *
 * Conventions (per design.md):
 * - `id` equals the sub-spec directory name and is unique.
 * - An edge "A depends on B" is stored as B appearing in A.upstreams.
 * - The 4 Foundation_Module have empty upstreams and phaseOrder 0.
 * - phaseOrder(m) = max(phaseOrder of each upstream) + 1; Foundation = 0.
 *
 * Pure data only: no I/O, no side effects. Graph algorithms (isAcyclic,
 * topoPhases, readyModules, ...) live in graph.ts / state.ts (tasks 1.2/1.3).
 */

/** Execution status of a single Module_Unit. */
export type ModuleStatus = 'Pending' | 'In_Progress' | 'Done' | 'Blocked';

/**
 * Result of a single Verification_Gate.
 * - 'pass' / 'fail': gate ran and produced a verdict.
 * - 'n/a': gate does not apply (e.g. integration gate for a Foundation_Module).
 * - '-': gate has not run yet.
 */
export type GateResult = 'pass' | 'fail' | 'n/a' | '-';

/** A node in the Dependency_Graph: one Module_Unit and its build ordering. */
export interface ModuleNode {
  /** Sub-spec directory name; unique across the graph. */
  id: string;
  /** Direct Upstream_Dependency ids (modules that must finish first). */
  upstreams: string[];
  /** Topological layer / Build_Phase order, 0..4 (Foundation_Module = 0). */
  phaseOrder: number;
}

/**
 * Persisted execution state of a single Module_Unit, mirrored to ROADMAP.md.
 */
export interface ModuleState {
  id: string;
  status: ModuleStatus;
  /** The four Verification_Gate results. */
  gates: {
    build: GateResult;
    test: GateResult;
    regression: GateResult;
    integration: GateResult;
  };
  /** Current Blocker text when status is 'Blocked'; otherwise null. */
  blocker: string | null;
  /** Consecutive build attempts, used for the "two same-cause failures" rule. */
  attempts: number;
  /** Blocker from the previous failure, used to detect a same-cause repeat. */
  lastBlocker: string | null;
  /** ISO timestamp of the last status change; null if never changed. */
  updatedAt: string | null;
}

/**
 * The Dependency_Graph: all Module_Unit nodes. An edge A->B ("A depends on B")
 * is encoded as B being present in node A's `upstreams`.
 */
export interface DependencyGraph {
  nodes: ModuleNode[];
}

/** The Roadmap_State: per-module execution state keyed by module id. */
export interface RoadmapState {
  modules: Record<string, ModuleState>;
}

/**
 * The fixed 18-node Integration_Roadmap dependency graph.
 *
 * Nodes and edges follow design.md "依赖图" and "直接 Upstream_Dependency" tables
 * and fully register the edges required by Requirement 2.6. The graph is
 * acyclic; the phaseOrder values constitute a valid topological layering and
 * therefore a constructive proof of acyclicity.
 */
export const ROADMAP_GRAPH: DependencyGraph = {
  nodes: [
    // --- Phase 0: Foundation_Module (no upstreams) ---
    { id: 'voice-interaction-loop', upstreams: [], phaseOrder: 0 },
    { id: 'model-management', upstreams: [], phaseOrder: 0 },
    { id: 'ui-internationalization', upstreams: [], phaseOrder: 0 },
    { id: 'appearance-theme-mode', upstreams: [], phaseOrder: 0 },

    // --- Phase 1 ---
    { id: 'chat-session-persistence', upstreams: ['voice-interaction-loop'], phaseOrder: 1 },
    { id: 'voice-library-management', upstreams: ['voice-interaction-loop'], phaseOrder: 1 },
    {
      id: 'command-palette',
      upstreams: ['appearance-theme-mode', 'ui-internationalization'],
      phaseOrder: 1,
    },

    // --- Phase 2 ---
    { id: 'streaming-chat-output', upstreams: ['chat-session-persistence'], phaseOrder: 2 },
    { id: 'chat-history-search', upstreams: ['chat-session-persistence'], phaseOrder: 2 },
    { id: 'conversation-export-import', upstreams: ['chat-session-persistence'], phaseOrder: 2 },
    { id: 'character-persona-management', upstreams: ['voice-library-management'], phaseOrder: 2 },

    // --- Phase 3 ---
    { id: 'chat-session-organization', upstreams: ['chat-history-search'], phaseOrder: 3 },
    { id: 'chat-message-actions', upstreams: ['streaming-chat-output'], phaseOrder: 3 },
    {
      id: 'chat-generation-parameters',
      upstreams: ['model-management', 'streaming-chat-output'],
      phaseOrder: 3,
    },
    { id: 'prompt-preset-management', upstreams: ['character-persona-management'], phaseOrder: 3 },

    // --- Phase 4 ---
    { id: 'markdown-message-rendering', upstreams: ['chat-message-actions'], phaseOrder: 4 },
    {
      id: 'context-window-management',
      upstreams: ['model-management', 'chat-generation-parameters'],
      phaseOrder: 4,
    },
    {
      id: 'chat-input-slash-commands',
      upstreams: ['prompt-preset-management', 'chat-message-actions'],
      phaseOrder: 4,
    },
  ],
};
