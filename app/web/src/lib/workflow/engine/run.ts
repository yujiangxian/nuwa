// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * Workflow execution engine — run-to-completion driver (`engine/run.ts`).
 *
 * Feature: workflow-execution-engine
 *
 * `run(state, graph, env)` repeatedly applies `step` until the run settles, and
 * `stepBudget(graph)` computes a defensive hard upper bound on the number of
 * micro-steps. The driver is pure and deterministic: it never consults a clock,
 * never mutates its inputs, and returns the same RunOutcome for the same
 * `(state, graph, env)` (design "关键算法" + dispatcher 3.5, R10.x, R11.x).
 */

import type { WorkflowGraph, WorkflowNode } from '../types';
import type { ExecutionEnvironment, ExecutionState, RunOutcome } from './types';
import { ExecutorErrorCode } from './types';
import { step } from './step';
import { validateGraph } from '../validate';
import { getNode } from '../graph';

// ---------------------------------------------------------------------------
// Step budget (defensive upper bound)
// ---------------------------------------------------------------------------

/**
 * Read a loop header node's `maxIterations` defensively from its opaque config; default 1.
 * Mirrors the reader in `step.ts`: the config is treated as opaque, and only a positive
 * integer is honoured — any other shape falls back to a single iteration.
 */
function maxIterationsOf(node: WorkflowNode): number {
  const config = node.config;
  if (config !== null && typeof config === 'object' && !Array.isArray(config)) {
    const raw = (config as { readonly maxIterations?: unknown }).maxIterations;
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1) return raw;
  }
  return 1;
}

/**
 * Compute the Step_Budget upper bound (R11.2):
 *
 *   budget = (nodeCount * (1 + product(maxIterations over all LoopScopes))) + margin
 *   margin = nodeCount + edgeCount
 *
 * The margin covers the extra micro-steps spent on condition routing, skip marking,
 * and pause/resume transitions, so a legal bounded graph always terminates well within
 * the budget. The budget is a defensive hard ceiling only — a normal run should never
 * reach it. It depends solely on the static graph shape (never on a clock).
 */
export function stepBudget(graph: WorkflowGraph): number {
  const nodeCount = graph.nodes.length;
  const edgeCount = graph.edges.length;

  // Product of every LoopScope's maxIterations, read defensively from each header's config.
  let iterationProduct = 1;
  for (const scope of graph.loopScopes) {
    const header = getNode(graph, scope.headerNodeId);
    iterationProduct *= header !== undefined ? maxIterationsOf(header) : 1;
  }

  const margin = nodeCount + edgeCount;
  // Guarantee at least one step so a valid empty graph can take its single
  // convergence step and settle to Completed (R10.3, R16.5); for any non-empty
  // graph the formula already yields a value >= 1, so this only relaxes the
  // defensive ceiling for the degenerate empty graph.
  return Math.max(1, nodeCount * (1 + iterationProduct) + margin);
}

// ---------------------------------------------------------------------------
// Run-to-completion driver
// ---------------------------------------------------------------------------

/**
 * Repeatedly apply `step` until the run settles (R10.1, R10.2, R11.1, R11.2). The loop
 * stops as soon as any of the following holds:
 *  - RunStatus reaches a Terminal_Status (`Completed`/`Failed`) or becomes `Paused`;
 *  - a step reports `progress=false` (convergence / no further progress);
 *  - the applied step count reaches `stepBudget(graph)` (defensive hard ceiling).
 *
 * A step that errors (which should not happen for a valid graph) is propagated as-is.
 * Returns a RunResult with the final state and the number of steps applied.
 *
 * If `graph` fails validation, returns an INVALID_GRAPH error without executing
 * anything (R1.5). Deterministic for the same `(state, graph, env)`; never uses a clock.
 */
export function run(
  state: ExecutionState,
  graph: WorkflowGraph,
  env: ExecutionEnvironment,
): RunOutcome {
  // Reject an unvalidated graph up front (R1.5): never advance any node.
  if (!validateGraph(graph).valid) {
    return {
      ok: false,
      error: {
        code: ExecutorErrorCode.INVALID_GRAPH,
        message: 'Cannot run: the graph is invalid.',
      },
    };
  }

  const budget = stepBudget(graph);
  let current = state;
  let steps = 0;

  // Note: `Paused` is NOT a hard stop here. A Paused run is resumable: when the
  // env now supplies the awaited Human_Input_Response, `step` (via its Paused
  // branch) makes progress and the loop continues to a terminal status; when no
  // response is available, that same step reports `progress=false` and the loop
  // breaks below, leaving the run settled at Paused. This lets a caller resume a
  // previously-paused (and possibly serialized/deserialized) state simply by
  // calling `run` again with a responding env (R12.2, R13.1).
  while (
    current.runStatus !== 'Completed' &&
    current.runStatus !== 'Failed' &&
    steps < budget
  ) {
    const outcome = step(current, graph, env);
    if (!outcome.ok) {
      // Propagate an unexpected step error (should not occur for a valid graph).
      return outcome;
    }

    steps += 1;
    current = outcome.result.state;

    // Convergence: a step with no progress means the run cannot advance further
    // (this is also how a Paused run with no available response settles).
    if (!outcome.result.progress) break;
  }

  return { ok: true, result: { state: current, steps } };
}
