/**
 * workflow-node-types — config numeric clamping and canonical normalization.
 *
 * Feature: workflow-node-types
 *
 * This middle-layer module turns an arbitrary `TypedNodeConfig` into a stable,
 * canonical form. It exposes three pure functions:
 *
 *   - `clampNumericFields(nodeType, config)` (design algorithm 4): converges
 *     out-of-range numeric fields to the nearest valid endpoint. Idempotent;
 *     leaves in-range values untouched; the result always lands in the valid
 *     range (R9.1–R9.5).
 *   - `normalizeNodeConfig(nodeType, config)` (design algorithm 5): first clamps
 *     numeric fields, then canonicalizes the representation — stable field order,
 *     `argumentBindings` sorted by (argName, portId) and de-duplicated,
 *     `transform.declaredInputs` sorted by portId and de-duplicated, and the
 *     internal `Expression` / `PortType` representations rebuilt canonically.
 *     The rewrite is representation-only and never changes semantics. It is
 *     idempotent (a fixpoint on canonical input), deterministic, and maps
 *     semantically-equivalent configs to an equal canonical form (R12.1–R12.6).
 *   - `configSemanticEquals(a, b)`: semantic equality that ignores the order of
 *     `argumentBindings` / `declaredInputs` and the field write order.
 *
 * Every export is a pure function: no I/O, no mutable global state, no time or
 * random dependency.
 */

import type { NodeType, PortType } from '../types';
import { formatPortType, portTypeEquals } from '../portType';
import type { Expression } from './expression';
import type {
  TypedNodeConfig,
  LlmConfig,
  ConditionConfig,
  ToolConfig,
  TransformConfig,
  HumanInputConfig,
  LoopConfig,
  ArgumentBinding,
  InputPortDecl,
} from './configTypes';

// ---------------------------------------------------------------------------
// 5.1 Numeric clamping — design algorithm 4 (R9)
// ---------------------------------------------------------------------------

/**
 * Clamp a Temperature value into the closed interval [0, 2].
 *
 * - In-range finite values are returned unchanged (idempotent fixed point).
 * - `+Infinity` converges to the upper endpoint 2, `-Infinity` to the lower 0
 *   (both via `min`/`max`).
 * - `NaN` is not ordered, so it is mapped to the lower endpoint 0 to keep the
 *   result inside the valid range (R9.5).
 */
function clampTemperature(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(2, Math.max(0, value));
}

/**
 * Clamp a "positive integer" field (Max_Tokens / Max_Iterations) to an integer
 * greater than or equal to 1.
 *
 * - Finite values are floored, then raised to the lower bound 1.
 * - Non-finite values (`NaN`, `±Infinity`) cannot yield a valid finite integer,
 *   so they converge to the lower bound 1 (R9.5).
 */
function clampPositiveInt(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.floor(value));
}

/**
 * Numeric field clamping (design algorithm 4, R9.2). Out-of-range numeric fields
 * are converged to the nearest endpoint of their valid interval, while in-range
 * values are preserved (R9.4). The operation is idempotent (R9.3) and its result
 * never triggers a `NUMERIC_OUT_OF_RANGE` error (R9.5).
 *
 * Valid intervals (R9.1): Temperature ∈ [0, 2]; Max_Tokens and Max_Iterations are
 * integers ≥ 1. The discriminant is read from `config.kind` (which, for a valid
 * node, equals the node type); the node type parameter is part of the documented
 * signature but unused here, so it is underscore-prefixed.
 */
export function clampNumericFields(_nodeType: NodeType, config: TypedNodeConfig): TypedNodeConfig {
  switch (config.kind) {
    case 'llm':
      return {
        ...config,
        temperature: clampTemperature(config.temperature),
        maxTokens: clampPositiveInt(config.maxTokens),
      };
    case 'loop':
      return {
        ...config,
        maxIterations: clampPositiveInt(config.maxIterations),
      };
    default:
      // condition / tool / transform / human_input carry no numeric range fields.
      return config;
  }
}

// ---------------------------------------------------------------------------
// 5.2 Representation-only canonicalization helpers
// ---------------------------------------------------------------------------

/**
 * Rebuild a `PortType` with a canonical, deterministic shape. Composite types
 * are rebuilt recursively; base types are already canonical (only a `kind`) and
 * are returned as-is. This changes representation only, never the type itself.
 */
function normalizePortType(t: PortType): PortType {
  switch (t.kind) {
    case 'list':
      return { kind: 'list', element: normalizePortType(t.element) };
    case 'optional':
      return { kind: 'optional', inner: normalizePortType(t.inner) };
    default:
      // Base kinds (string/number/boolean/json/message) are immutable and canonical.
      return t;
  }
}

/**
 * Rebuild an `Expression` with a fixed field order. The AST is reconstructed by
 * structural induction so that two structurally identical expressions produce
 * byte-for-byte identical canonical objects. This is purely a representation
 * rewrite and never folds constants or otherwise changes semantics.
 */
function normalizeExpr(expr: Expression): Expression {
  switch (expr.node) {
    case 'litString':
      return { node: 'litString', value: expr.value };
    case 'litNumber':
      return { node: 'litNumber', value: expr.value };
    case 'litBool':
      return { node: 'litBool', value: expr.value };
    case 'inputRef':
      return { node: 'inputRef', portId: expr.portId };
    case 'field':
      return { node: 'field', target: normalizeExpr(expr.target), name: expr.name };
    case 'compare':
      return { node: 'compare', op: expr.op, left: normalizeExpr(expr.left), right: normalizeExpr(expr.right) };
    case 'logic':
      return { node: 'logic', op: expr.op, left: normalizeExpr(expr.left), right: normalizeExpr(expr.right) };
    case 'not':
      return { node: 'not', operand: normalizeExpr(expr.operand) };
    case 'arith':
      return { node: 'arith', op: expr.op, left: normalizeExpr(expr.left), right: normalizeExpr(expr.right) };
    default: {
      // Exhaustiveness guard: a new Expression branch without a case fails to compile.
      const _exhaustive: never = expr;
      return _exhaustive;
    }
  }
}

/**
 * Structural deep equality over JSON-like immutable values (primitives, plain
 * objects). Object keys are compared order-insensitively, so it is suitable for
 * comparing canonical Expression / PortType / binding structures regardless of
 * field write order. Uses `Object.is` at the leaves to treat `NaN` as equal to
 * itself.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao).sort();
  const bk = Object.keys(bo).sort();
  if (ak.length !== bk.length) {
    return false;
  }
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i]) {
      return false;
    }
    if (!deepEqual(ao[ak[i]], bo[bk[i]])) {
      return false;
    }
  }
  return true;
}

/** Lexicographic comparison of two strings by UTF-16 code unit (deterministic). */
function compareStrings(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/**
 * Remove adjacent fully-equal entries from a sorted array. Because the input is
 * sorted, every group of equal entries is contiguous, so a single pass collapses
 * all duplicates.
 */
function dedupeAdjacent<T>(items: readonly T[], equal: (a: T, b: T) => boolean): T[] {
  const out: T[] = [];
  for (const item of items) {
    if (out.length === 0 || !equal(out[out.length - 1], item)) {
      out.push(item);
    }
  }
  return out;
}

/**
 * Canonicalize `argumentBindings`: rebuild each binding with a fixed field order
 * and a normalized PortType, sort by (argName, portId, portType string), then
 * drop fully-equal duplicates (R12.3). Sorting before de-duplication guarantees
 * a unique, order-independent representation.
 */
function canonicalizeBindings(bindings: ReadonlyArray<ArgumentBinding>): ArgumentBinding[] {
  const rebuilt: ArgumentBinding[] = bindings.map((b) => ({
    portId: b.portId,
    argName: b.argName,
    portType: normalizePortType(b.portType),
  }));
  rebuilt.sort((a, b) => {
    const byArg = compareStrings(a.argName, b.argName);
    if (byArg !== 0) {
      return byArg;
    }
    const byPort = compareStrings(a.portId, b.portId);
    if (byPort !== 0) {
      return byPort;
    }
    // Tie-break on the canonical PortType string so equal-keyed but differently
    // typed bindings still order deterministically.
    return compareStrings(formatPortType(a.portType), formatPortType(b.portType));
  });
  return dedupeAdjacent(rebuilt, (a, b) => deepEqual(a, b));
}

/**
 * Canonicalize `declaredInputs`: rebuild each declaration with a fixed field
 * order and a normalized PortType, sort by (portId, portType string, required),
 * then drop fully-equal duplicates (R12.3).
 */
function canonicalizeInputs(inputs: ReadonlyArray<InputPortDecl>): InputPortDecl[] {
  const rebuilt: InputPortDecl[] = inputs.map((d) => ({
    portId: d.portId,
    portType: normalizePortType(d.portType),
    required: d.required,
  }));
  rebuilt.sort((a, b) => {
    const byPort = compareStrings(a.portId, b.portId);
    if (byPort !== 0) {
      return byPort;
    }
    const byType = compareStrings(formatPortType(a.portType), formatPortType(b.portType));
    if (byType !== 0) {
      return byType;
    }
    if (a.required === b.required) {
      return 0;
    }
    // Order `false` before `true` deterministically.
    return a.required ? 1 : -1;
  });
  return dedupeAdjacent(rebuilt, (a, b) => deepEqual(a, b));
}

// ---------------------------------------------------------------------------
// 5.2 normalizeNodeConfig — design algorithm 5 (R12)
// ---------------------------------------------------------------------------

/**
 * Config normalization (design algorithm 5, R12.1). The pipeline is:
 *   1. `clampNumericFields` to converge numeric ranges;
 *   2. rebuild the branch with a stable field order, sort + de-duplicate the
 *      `argumentBindings` / `declaredInputs` collections, and canonicalize the
 *      internal `Expression` and `PortType` representations.
 *
 * Properties: idempotent (R12.2), canonical forms are fixpoints (R12.5),
 * semantically-equivalent configs map to an equal canonical form (R12.3), and
 * the function is deterministic (R12.6). `nodeType` is forwarded to the clamp
 * step and retained for the documented signature.
 */
export function normalizeNodeConfig(nodeType: NodeType, config: TypedNodeConfig): TypedNodeConfig {
  const clamped = clampNumericFields(nodeType, config);
  switch (clamped.kind) {
    case 'llm':
      return {
        kind: 'llm',
        modelId: clamped.modelId,
        systemPrompt: clamped.systemPrompt,
        temperature: clamped.temperature,
        maxTokens: clamped.maxTokens,
      };
    case 'condition':
      return {
        kind: 'condition',
        condition: normalizeExpr(clamped.condition),
      };
    case 'tool':
      return {
        kind: 'tool',
        toolName: clamped.toolName,
        argumentBindings: canonicalizeBindings(clamped.argumentBindings),
      };
    case 'transform':
      return {
        kind: 'transform',
        transform: normalizeExpr(clamped.transform),
        declaredInputs: canonicalizeInputs(clamped.declaredInputs),
        outputType: normalizePortType(clamped.outputType),
      };
    case 'human_input':
      return {
        kind: 'human_input',
        prompt: clamped.prompt,
        responseType: normalizePortType(clamped.responseType),
      };
    case 'loop':
      return {
        kind: 'loop',
        maxIterations: clamped.maxIterations,
        breakCondition: normalizeExpr(clamped.breakCondition),
      };
    default: {
      const _exhaustive: never = clamped;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// 5.2 configSemanticEquals
// ---------------------------------------------------------------------------

/** Structural equality of two expressions, ignoring field write order. */
function expressionEquals(a: Expression, b: Expression): boolean {
  return deepEqual(normalizeExpr(a), normalizeExpr(b));
}

/**
 * Semantic equality of two typed node configs. It ignores the order of
 * `argumentBindings` and `declaredInputs` (compared as canonical, de-duplicated
 * sequences) and the field write order (numeric and string fields compared by
 * value). Numeric values are compared as written — this predicate does NOT apply
 * numeric clamping, so it reflects the configs' literal semantics.
 */
export function configSemanticEquals(a: TypedNodeConfig, b: TypedNodeConfig): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  switch (a.kind) {
    case 'llm': {
      const y = b as LlmConfig;
      return (
        a.modelId === y.modelId &&
        a.systemPrompt === y.systemPrompt &&
        Object.is(a.temperature, y.temperature) &&
        Object.is(a.maxTokens, y.maxTokens)
      );
    }
    case 'condition': {
      const y = b as ConditionConfig;
      return expressionEquals(a.condition, y.condition);
    }
    case 'tool': {
      const y = b as ToolConfig;
      if (a.toolName !== y.toolName) {
        return false;
      }
      return deepEqual(canonicalizeBindings(a.argumentBindings), canonicalizeBindings(y.argumentBindings));
    }
    case 'transform': {
      const y = b as TransformConfig;
      return (
        expressionEquals(a.transform, y.transform) &&
        portTypeEquals(a.outputType, y.outputType) &&
        deepEqual(canonicalizeInputs(a.declaredInputs), canonicalizeInputs(y.declaredInputs))
      );
    }
    case 'human_input': {
      const y = b as HumanInputConfig;
      return a.prompt === y.prompt && portTypeEquals(a.responseType, y.responseType);
    }
    case 'loop': {
      const y = b as LoopConfig;
      return Object.is(a.maxIterations, y.maxIterations) && expressionEquals(a.breakCondition, y.breakCondition);
    }
    default: {
      const _exhaustive: never = a;
      return _exhaustive;
    }
  }
}
