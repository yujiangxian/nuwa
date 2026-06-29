/**
 * Workflow execution engine — micro-step reducer (`engine/step.ts`).
 *
 * Feature: workflow-execution-engine
 *
 * `step(state, graph, env)` advances an ExecutionState by exactly one deterministic
 * micro-step (design "关键算法 1–6"). The reducer is pure: it never mutates its
 * inputs and returns the same StepOutcome for the same `(state, graph, env)`. All
 * external behaviour (node execution, condition evaluation, human input) is obtained
 * deterministically through the injected `ExecutionEnvironment`.
 *
 * Decision priority (top to bottom, design dispatcher 3.5):
 *  0. graph fails validation              -> { ok:false, INVALID_GRAPH }
 *  1. runStatus is Completed/Failed        -> no progress, state unchanged
 *  2. runStatus is Paused                  -> resume if a response is available, else stay paused
 *  3. otherwise select the unique ReadyNode and dispatch by node type
 *  4. no ReadyNode and not terminal/paused -> convergence (settle the final RunStatus)
 */

import type { JsonValue, WorkflowGraph, WorkflowNode } from '../types';
import type {
  ExecutionEnvironment,
  ExecutionState,
  NodeExecutor,
  NodeExecutorRegistry,
  StepOutcome,
} from './types';
import { ExecutorErrorCode } from './types';
import {
  incrementLoopCounter,
  readyNodeIds,
  recomputeReady,
  valueKeyToString,
  withNodeStatus,
  withRunStatus,
  withSatisfiedEdge,
  withValue,
} from './state';
import { validateGraph } from '../validate';
import { topologicalOrder } from '../analyze';
import { getNode, incomingEdges, outgoingEdges } from '../graph';
import { expectedPorts, refineConfig } from '../nodeTypes';

// ---------------------------------------------------------------------------
// 3.5 Top-level `step` dispatcher
// ---------------------------------------------------------------------------

/**
 * Advance the ExecutionState by one deterministic micro-step. See the file header
 * for the decision priority. `progress` is true iff this step advanced at least one
 * node status or one LoopCounter (a pure RunStatus convergence reports `false`).
 */
export function step(
  state: ExecutionState,
  graph: WorkflowGraph,
  env: ExecutionEnvironment,
): StepOutcome {
  // 0. Reject an unvalidated graph (R1.5): never execute any node.
  if (!validateGraph(graph).valid) {
    return {
      ok: false,
      error: {
        code: ExecutorErrorCode.INVALID_GRAPH,
        message: 'Cannot step: the graph is invalid.',
      },
    };
  }

  // 1. Terminal run status: nothing changes (R10.3, R10.4).
  if (state.runStatus === 'Completed' || state.runStatus === 'Failed') {
    return { ok: true, result: { state, progress: false } };
  }

  // 2. Paused: resume when the provider now has a response, otherwise stay paused (R12.2, R12.3).
  if (state.runStatus === 'Paused') {
    return stepPaused(state, graph, env);
  }

  // From here on the run is actively advancing. Idle transitions to Running on the
  // first advance; an already-Running state is unaffected.
  const base = withRunStatus(state, 'Running');

  // 3. Select the unique ReadyNode by the deterministic Ready_Selection_Rule.
  const selected = selectReadyNode(graph, readyNodeIds(base));
  if (selected !== null) {
    const node = getNode(graph, selected);
    if (node === undefined) {
      // Should not happen for a validated graph; settle defensively as an internal failure.
      const next = withRunStatus(
        propagateFailure(graph, base, env, selected, ExecutorErrorCode.INTERNAL),
        'Failed',
      );
      return { ok: true, result: { state: next, progress: true } };
    }
    return { ok: true, result: { state: dispatchNode(base, graph, env, node), progress: true } };
  }

  // 4. No ReadyNode and not terminal/paused: converge the final RunStatus (R3.6, R14.4).
  return { ok: true, result: { state: converge(state), progress: false } };
}

/**
 * Paused handling (key algorithm 5, step 2). When the Human_Input_Provider has a
 * response for the pending node, write it to the node's `response` output, mark the
 * node Completed, clear `pendingHumanInput`, set RunStatus back to Running and
 * propagate. Otherwise the state is unchanged and `progress` is false.
 */
function stepPaused(
  state: ExecutionState,
  graph: WorkflowGraph,
  env: ExecutionEnvironment,
): StepOutcome {
  const pending = state.pendingHumanInput;
  if (pending !== null) {
    const node = getNode(graph, pending);
    const response = node !== undefined ? env.humanInputProvider(node) : undefined;
    if (node !== undefined && response !== undefined) {
      let next = withRunStatus(state, 'Running');
      next = { ...next, pendingHumanInput: null };
      next = withNodeStatus(next, pending, 'Completed');
      next = writeAndPropagate(graph, next, pending, new Map([['response', response]]), null);
      return { ok: true, result: { state: next, progress: true } };
    }
  }
  // Still waiting for a response: remain paused.
  return { ok: true, result: { state, progress: false } };
}

/**
 * Dispatch a selected ReadyNode by its NodeType (design dispatcher 3.5 step 3):
 *  - human_input -> pause or resume-complete (key algorithm 5);
 *  - condition   -> evaluate boolean, route the taken branch, skip the rest (algorithm 3);
 *  - loop        -> evaluate the break condition, iterate or exit (algorithm 4);
 *  - normal      -> invoke the NodeExecutor, complete or fail (algorithm 2 / 6).
 */
function dispatchNode(
  base: ExecutionState,
  graph: WorkflowGraph,
  env: ExecutionEnvironment,
  node: WorkflowNode,
): ExecutionState {
  switch (node.type) {
    case 'human_input':
      return stepHumanInput(base, graph, env, node);
    case 'condition':
      return stepCondition(base, graph, env, node);
    case 'loop':
      return stepLoop(base, graph, env, node.id);
    default:
      // llm / tool / transform: ordinary executor-driven nodes.
      return stepNormal(base, graph, env, node);
  }
}

// ---------------------------------------------------------------------------
// 3.1 Ready selection, input gathering, output validation, propagation
// ---------------------------------------------------------------------------

/**
 * Ready_Selection_Rule (key algorithm 1, R3.2–R3.4): among all Ready node ids pick
 * the one with the smallest `(topologicalOrder position, Node_Id)` pair. Nodes not in
 * the forward topological order (e.g. trapped in a back-edge cycle) get position +∞.
 * The result is independent of the incidental enumeration order of `readyIds`.
 */
function selectReadyNode(graph: WorkflowGraph, readyIds: readonly string[]): string | null {
  if (readyIds.length === 0) return null;

  const order = topologicalOrder(graph);
  const pos = new Map<string, number>();
  order.forEach((id, index) => pos.set(id, index));

  let best: string | null = null;
  let bestPos = Number.POSITIVE_INFINITY;
  for (const id of readyIds) {
    const p = pos.get(id) ?? Number.POSITIVE_INFINITY;
    if (best === null || p < bestPos || (p === bestPos && id < best)) {
      best = id;
      bestPos = p;
    }
  }
  return best;
}

/**
 * Assemble the input port value map passed to a NodeExecutor (R3.5, R5.1). For each
 * input port of the node, look up its Value_Key in the current iteration scope and,
 * when present, include it. The resulting key set is exactly the node's input ports
 * that already hold a produced value in this iteration scope.
 */
function gatherInputs(
  graph: WorkflowGraph,
  state: ExecutionState,
  nodeId: string,
  iterationIndex: number,
): ReadonlyMap<string, JsonValue> {
  const inputs = new Map<string, JsonValue>();
  const node = getNode(graph, nodeId);
  if (node === undefined) return inputs;

  for (const port of node.inputs) {
    const keyStr = valueKeyToString({ endpoint: { nodeId, portId: port.id }, iterationIndex });
    const stored = state.valueStore.get(keyStr);
    if (stored !== undefined) inputs.set(port.id, stored.value);
  }
  return inputs;
}

/**
 * Validate that a successful NodeExecutor output's port-id set matches the node's
 * expected output ports (else it is an INVALID_OUTPUT failure). Expected ports are
 * derived via `expectedPorts` from the refined typed config; when the config cannot
 * be refined into a well-formed typed config the node's declared output ports are
 * used as the fallback contract so the check stays total.
 */
function validateExecutorOutputs(
  node: WorkflowNode,
  outputs: ReadonlyMap<string, JsonValue>,
): boolean {
  const expected = expectedOutputPortIds(node);
  if (expected.size !== outputs.size) return false;
  for (const id of expected) {
    if (!outputs.has(id)) return false;
  }
  return true;
}

/** Derive the expected output Port_Id set for a node (expectedPorts, with a defensive fallback). */
function expectedOutputPortIds(node: WorkflowNode): ReadonlySet<string> {
  const refined = refineConfig(node);
  if (refined.ok) {
    try {
      return new Set(expectedPorts(node.type, refined.config).outputs.map((p) => p.id));
    } catch {
      // The refined config passed only the discriminator check; fall through to declared ports.
    }
  }
  return new Set(node.outputs.map((p) => p.id));
}

/**
 * Complete a node and propagate its outputs (key algorithm 2, R4.1–R4.4). The node
 * is assumed already marked Completed by the caller (so the Satisfied_Edge_Set source
 * invariant R17.6 holds). Writes every output value (write-once), satisfies every
 * outgoing edge, copies values to downstream input ports, and recomputes readiness.
 */
function completeAndPropagate(
  graph: WorkflowGraph,
  state: ExecutionState,
  nodeId: string,
  outputs: ReadonlyMap<string, JsonValue>,
  iterationIndex: number,
): ExecutionState {
  return writeAndPropagate(graph, state, nodeId, outputs, null, iterationIndex);
}

/**
 * Core value-production + propagation routine shared by normal completion, condition
 * routing, loop stepping and human-input resume.
 *
 * `portFilter` restricts which output ports' edges are satisfied/propagated (used to
 * route only the taken condition branch, or only the loop's `body_in`/`exit` port);
 * `null` activates every output port.
 *
 * Behaviour (algorithm 2, generalised):
 *  1. Write each activated output value under the source node's Value_Key (write-once, R6.4).
 *  2. For each outgoing edge on an activated port: add it to the Satisfied_Edge_Set and
 *     copy the source value into the target Input_Port's Value_Key, computed at the
 *     *target* node's current iteration scope (so values cross loop scopes correctly).
 *  3. Re-arm a loop header whose back-edge just became satisfied (so it can re-evaluate).
 *  4. Recompute readiness so newly-eligible Pending downstream nodes become Ready.
 */
function writeAndPropagate(
  graph: WorkflowGraph,
  state: ExecutionState,
  nodeId: string,
  outputs: ReadonlyMap<string, JsonValue>,
  portFilter: ReadonlySet<string> | null,
  iterationIndex?: number,
): ExecutionState {
  const srcIndex = iterationIndex ?? currentIterationIndex(graph, state, nodeId);
  let next = state;

  // 1. Write the activated output values at the source node's iteration scope.
  for (const [portId, value] of outputs) {
    if (portFilter !== null && !portFilter.has(portId)) continue;
    next = withValue(next, { endpoint: { nodeId, portId }, iterationIndex: srcIndex }, value);
  }

  // 2. Satisfy outgoing edges on activated ports and propagate values downstream.
  for (const edge of outgoingEdges(graph, nodeId)) {
    if (portFilter !== null && !portFilter.has(edge.source.portId)) continue;
    next = withSatisfiedEdge(next, edge.id);

    const value = outputs.get(edge.source.portId);
    if (value !== undefined) {
      const targetIndex = currentIterationIndex(graph, next, edge.target.nodeId);
      next = withValue(
        next,
        { endpoint: { nodeId: edge.target.nodeId, portId: edge.target.portId }, iterationIndex: targetIndex },
        value,
      );
    }

    // 3. A satisfied back-edge into a loop header re-arms that header for re-evaluation.
    if (isBackEdge(graph, edge) && next.nodeStatus.get(edge.target.nodeId) === 'Completed') {
      next = withNodeStatus(next, edge.target.nodeId, 'Pending');
    }
  }

  // 4. Promote newly-eligible Pending downstream nodes to Ready.
  return recomputeReady(graph, next);
}

// ---------------------------------------------------------------------------
// 3.2 Condition branch routing and skip marking
// ---------------------------------------------------------------------------

/**
 * Step a `condition` node: evaluate its boolean, route the taken branch and skip the
 * exclusively-untaken downstream (algorithm 3). A condition-evaluator failure is
 * propagated as a CONDITION_EVAL_FAILED node failure.
 */
function stepCondition(
  base: ExecutionState,
  graph: WorkflowGraph,
  env: ExecutionEnvironment,
  node: WorkflowNode,
): ExecutionState {
  const itIndex = currentIterationIndex(graph, base, node.id);
  const inputs = gatherInputs(graph, base, node.id, itIndex);
  const evalRes = env.conditionEvaluator(node, inputs);
  if (!evalRes.ok) {
    return propagateFailure(graph, base, env, node.id, ExecutorErrorCode.CONDITION_EVAL_FAILED);
  }

  // Mark Completed first so the satisfied taken-branch edges have a Completed source (R17.6).
  const completed = withNodeStatus(base, node.id, 'Completed');
  return routeCondition(graph, completed, node.id, evalRes.value);
}

/**
 * Condition routing (algorithm 3, R7.2–R7.5). The taken branch port is `true` when
 * `branch` is true, else `false`. Its outgoing edges are satisfied and propagated;
 * every node reachable exclusively through the untaken branch (all of whose forward
 * incoming edges are dead) is marked Skipped. Nodes also reachable by a live path are
 * preserved.
 */
function routeCondition(
  graph: WorkflowGraph,
  state: ExecutionState,
  nodeId: string,
  branch: boolean,
): ExecutionState {
  const takenPort = branch ? 'true' : 'false';
  const untakenPort = branch ? 'false' : 'true';

  // Propagate the taken branch: carry the boolean value along the taken port's edges.
  let next = writeAndPropagate(
    graph,
    state,
    nodeId,
    new Map<string, JsonValue>([[takenPort, branch]]),
    new Set([takenPort]),
  );

  // The untaken branch's outgoing edges are "dead" and never satisfied.
  const deadEdgeIds = new Set<string>(
    outgoingEdges(graph, nodeId, untakenPort).map((e) => e.id),
  );
  if (deadEdgeIds.size === 0) return next;

  // Mark every exclusively-untaken downstream node Skipped (only those not yet run).
  const dead = deadClosure(graph, deadEdgeIds, new Set<string>());
  for (const id of dead) {
    if (next.nodeStatus.get(id) === 'Pending') {
      next = withNodeStatus(next, id, 'Skipped');
    }
  }
  return next;
}

// ---------------------------------------------------------------------------
// 3.3 Loop iteration lifecycle and cross-iteration reset
// ---------------------------------------------------------------------------

/**
 * Step a `loop` header (algorithm 4). Evaluate the Break_Condition over the header's
 * inputs; when it is true OR the LoopCounter has reached `maxIterations`, exit through
 * the header's `exit` output. Otherwise increment this loop's counter, reset its body
 * nodes back to Pending (so `recomputeReady` re-arms them in the new iteration scope)
 * and enter the next round through the header's `body_in` output.
 */
function stepLoop(
  base: ExecutionState,
  graph: WorkflowGraph,
  env: ExecutionEnvironment,
  headerNodeId: string,
): ExecutionState {
  const scope = graph.loopScopes.find((s) => s.headerNodeId === headerNodeId);
  const node = getNode(graph, headerNodeId);
  if (scope === undefined || node === undefined) {
    // A loop node with no declared scope cannot iterate; settle defensively as a failure.
    return propagateFailure(graph, base, env, headerNodeId, ExecutorErrorCode.INTERNAL);
  }

  const itIndex = currentIterationIndex(graph, base, headerNodeId);
  const inputs = gatherInputs(graph, base, headerNodeId, itIndex);
  const evalRes = env.conditionEvaluator(node, inputs);
  if (!evalRes.ok) {
    return propagateFailure(graph, base, env, headerNodeId, ExecutorErrorCode.CONDITION_EVAL_FAILED);
  }

  const counter = base.loopCounters.get(scope.id) ?? 0;
  const maxIterations = maxIterationsOf(node);
  const shouldExit = evalRes.value === true || counter >= maxIterations;

  if (shouldExit) {
    // Exit the loop: complete the header and propagate through its `exit` output (R8.3, R8.4).
    const completed = withNodeStatus(base, headerNodeId, 'Completed');
    return writeAndPropagate(
      graph,
      completed,
      headerNodeId,
      new Map<string, JsonValue>([['exit', null]]),
      new Set(['exit']),
    );
  }

  // Enter the next iteration (R8.1, R8.2, R8.6, key algorithm 4 step 2):
  //  a. complete the header for this visit;
  //  b. increment this loop's counter (monotonic, <= maxIterations);
  //  c. reset the body nodes to Pending so they re-run in the new iteration scope;
  //  d. propagate through `body_in` (recomputeReady then re-arms the body).
  let next = withNodeStatus(base, headerNodeId, 'Completed');
  next = incrementLoopCounter(next, scope.id);
  const bodySet = new Set(scope.bodyNodeIds);
  for (const bodyId of scope.bodyNodeIds) {
    next = withNodeStatus(next, bodyId, 'Pending');
  }
  // Reset re-runs the body in a fresh iteration scope, so the body nodes are no
  // longer Completed. Drop any Satisfied_Edge whose SOURCE is a reset body node
  // (e.g. the loop's back-edge), otherwise the global Satisfied_Edge_Set would
  // reference a non-Completed source and violate the §17 invariant (R17.6).
  // These edges are re-satisfied when their source body node completes again in
  // the new iteration (writeAndPropagate below / subsequent steps).
  if (bodySet.size > 0) {
    const keptEdges = new Set<string>();
    for (const edgeId of next.satisfiedEdges) {
      const edge = graph.edges.find((e) => e.id === edgeId);
      if (edge !== undefined && bodySet.has(edge.source.nodeId)) continue; // drop
      keptEdges.add(edgeId);
    }
    if (keptEdges.size !== next.satisfiedEdges.size) {
      next = { ...next, satisfiedEdges: keptEdges };
    }
  }
  next = writeAndPropagate(
    graph,
    next,
    headerNodeId,
    new Map<string, JsonValue>([['body_in', null]]),
    new Set(['body_in']),
  );
  return next;
}

/** Read a loop header node's `maxIterations` defensively from its opaque config; default 1. */
function maxIterationsOf(node: WorkflowNode): number {
  const config = node.config;
  if (config !== null && typeof config === 'object' && !Array.isArray(config)) {
    const raw = (config as { readonly maxIterations?: unknown }).maxIterations;
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1) return raw;
  }
  return 1;
}

// ---------------------------------------------------------------------------
// 3.4 human_input pause/resume and failure/block propagation
// ---------------------------------------------------------------------------

/**
 * Step a `human_input` node (key algorithm 5, step 1). When the provider has no
 * response, pause the run: set RunStatus to Paused and record `pendingHumanInput`
 * without completing the node. When a response is available, complete the node by
 * writing it to the `response` output and propagating.
 */
function stepHumanInput(
  base: ExecutionState,
  graph: WorkflowGraph,
  env: ExecutionEnvironment,
  node: WorkflowNode,
): ExecutionState {
  const response = env.humanInputProvider(node);
  if (response === undefined) {
    // Pause: do not complete the node; remember which node is awaiting input (R12.1).
    let next = withRunStatus(base, 'Paused');
    next = { ...next, pendingHumanInput: node.id };
    return next;
  }

  // A response is already available: complete immediately and propagate (R12.2).
  let next = withNodeStatus(base, node.id, 'Completed');
  next = writeAndPropagate(graph, next, node.id, new Map([['response', response]]), null);
  return next;
}

/**
 * Step an ordinary node (llm / tool / transform). Resolve its NodeExecutor, gather its
 * inputs in the current iteration scope, invoke it, and either complete-and-propagate
 * on success (after validating the output port set) or propagate the failure.
 */
function stepNormal(
  base: ExecutionState,
  graph: WorkflowGraph,
  env: ExecutionEnvironment,
  node: WorkflowNode,
): ExecutionState {
  const executor = resolveExecutor(env.executorRegistry, node);
  if (executor === undefined) {
    // No executor registered for this node/type: a defensive internal failure.
    return propagateFailure(graph, base, env, node.id, ExecutorErrorCode.INTERNAL);
  }

  const itIndex = currentIterationIndex(graph, base, node.id);
  const inputs = gatherInputs(graph, base, node.id, itIndex);
  const result = executor(node, inputs, env);

  if (!result.ok) {
    return propagateFailure(graph, base, env, node.id, result.code);
  }
  if (!validateExecutorOutputs(node, result.outputs)) {
    return propagateFailure(graph, base, env, node.id, ExecutorErrorCode.INVALID_OUTPUT);
  }

  const completed = withNodeStatus(base, node.id, 'Completed');
  return completeAndPropagate(graph, completed, node.id, result.outputs, itIndex);
}

/** Resolve a NodeExecutor for a node: exact Node_Id match first, then fall back to NodeType. */
function resolveExecutor(
  registry: NodeExecutorRegistry,
  node: WorkflowNode,
): NodeExecutor | undefined {
  const byNodeId = registry.byNodeId?.get(node.id);
  if (byNodeId !== undefined) return byNodeId;
  return registry.byType.get(node.type);
}

/**
 * Failure / block propagation (algorithm 6, R14.1–R14.5). The node is marked Failed.
 * Under `fail_fast` the RunStatus is immediately set to Failed (the dispatcher then
 * selects no further node). Under `block_downstream` every node reachable exclusively
 * through the failed node (all of whose forward incoming edges trace back to the
 * failed node) is marked Blocked; the run may continue on independent branches and the
 * convergence step settles RunStatus to Failed once no non-blocked progress remains.
 */
function propagateFailure(
  graph: WorkflowGraph,
  state: ExecutionState,
  env: ExecutionEnvironment,
  nodeId: string,
  _code: ExecutorErrorCode,
): ExecutionState {
  let next = withNodeStatus(state, nodeId, 'Failed');

  if (env.errorPolicy === 'fail_fast') {
    return withRunStatus(next, 'Failed');
  }

  // block_downstream: mark the exclusively-reachable downstream nodes Blocked.
  const dead = deadClosure(graph, new Set<string>(), new Set([nodeId]));
  for (const id of dead) {
    if (id === nodeId) continue;
    const status = next.nodeStatus.get(id);
    if (status === 'Pending' || status === 'Ready') {
      next = withNodeStatus(next, id, 'Blocked');
    }
  }
  return next;
}

// ---------------------------------------------------------------------------
// Convergence and shared helpers
// ---------------------------------------------------------------------------

/**
 * Convergence (dispatcher step 4): with no ReadyNode and a non-terminal, non-paused
 * run, settle the final RunStatus. If any node is Failed the run is Failed, otherwise
 * it is Completed.
 *
 * When settling to Completed, any node still Pending can never proceed: convergence is
 * only reached once no Ready node exists and no further progress is possible, so a
 * Pending node's missing required inputs will never be produced (it sits on an
 * untaken/dead path — e.g. a condition branch that routed elsewhere, a loop body whose
 * loop exited before entering, or an input starved by a Skipped upstream). Such
 * stranded nodes are marked `Skipped` so the terminal state leaves no reachable node in
 * `Pending`/`Ready`/`Running` (design Property 24 liveness clause, R16.5). This is a
 * no-op for well-formed graphs, where proactive condition/loop routing already accounts
 * for every reachable node before convergence.
 */
function converge(state: ExecutionState): ExecutionState {
  let hasFailed = false;
  for (const status of state.nodeStatus.values()) {
    if (status === 'Failed') {
      hasFailed = true;
      break;
    }
  }
  if (hasFailed) {
    return withRunStatus(state, 'Failed');
  }

  // Settling to Completed: strand-skip any remaining Pending nodes (dead/untaken paths).
  let next = state;
  for (const [nodeId, status] of state.nodeStatus) {
    if (status === 'Pending') {
      next = withNodeStatus(next, nodeId, 'Skipped');
    }
  }
  return withRunStatus(next, 'Completed');
}

/**
 * Compute the "dead" closure over the Forward_Subgraph: starting from `seedNodes`
 * (treated as dead sources) and `deadEdgeIds` (edges that will never be satisfied), a
 * node joins the dead set iff it has at least one forward incoming edge and *every*
 * forward incoming edge is either a dead edge or originates from a dead node. This is
 * the shared engine for condition-skip exclusivity (R7.4/R7.5) and failure-block
 * exclusivity (R14.2): a node with any live (non-dead) incoming path is never tainted.
 * Back-edges are excluded so loops do not perturb the closure.
 */
function deadClosure(
  graph: WorkflowGraph,
  deadEdgeIds: ReadonlySet<string>,
  seedNodes: ReadonlySet<string>,
): ReadonlySet<string> {
  const dead = new Set<string>(seedNodes);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of graph.nodes) {
      const id = node.id;
      if (dead.has(id)) continue;

      const forwardIncoming = incomingEdges(graph, id).filter((e) => !isBackEdge(graph, e));
      if (forwardIncoming.length === 0) continue;

      const allDead = forwardIncoming.every(
        (e) => deadEdgeIds.has(e.id) || dead.has(e.source.nodeId),
      );
      if (allDead) {
        dead.add(id);
        changed = true;
      }
    }
  }
  return dead;
}

/** Whether `edge` is a well-formed back-edge: its target is a loop header and its source is in that loop's body. */
function isBackEdge(
  graph: WorkflowGraph,
  edge: { readonly source: { readonly nodeId: string }; readonly target: { readonly nodeId: string } },
): boolean {
  return graph.loopScopes.some(
    (s) => edge.target.nodeId === s.headerNodeId && s.bodyNodeIds.includes(edge.source.nodeId),
  );
}

/**
 * Current iteration-scope index of a node (key algorithm 4 step 1). A node outside any
 * loop body sits at the base index 0. A node enclosed by one or more LoopScopes gets the
 * composite `Σ counter_i * radix_i`, where each layer's radix is the product of the
 * `maxIterations` of all strictly inner layers. Layers are ordered innermost-first (by
 * body size), so distinct iteration combinations map to distinct indices.
 */
function currentIterationIndex(
  graph: WorkflowGraph,
  state: ExecutionState,
  nodeId: string,
): number {
  const enclosing = graph.loopScopes.filter((s) => s.bodyNodeIds.includes(nodeId));
  if (enclosing.length === 0) return 0;

  const ordered = [...enclosing].sort((a, b) => a.bodyNodeIds.length - b.bodyNodeIds.length);

  let index = 0;
  let radix = 1;
  for (const scope of ordered) {
    const counter = state.loopCounters.get(scope.id) ?? 0;
    index += counter * radix;
    const header = getNode(graph, scope.headerNodeId);
    radix *= header !== undefined ? maxIterationsOf(header) : 1;
  }
  return index;
}

// `requiredInputsSatisfied` and `upstreamGateSatisfied` are consumed indirectly through
// `recomputeReady`; they remain part of the state module's public surface.
