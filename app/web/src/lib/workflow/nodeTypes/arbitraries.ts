// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * workflow-node-types — custom fast-check arbitraries (test-time only).
 *
 * Feature: workflow-node-types
 *
 * This module is imported exclusively by the property-based tests. It provides
 * the generators described in the design "Testing Strategy / 自定义 Arbitraries":
 *
 *   - `arbitraryExpression`           : depth-limited recursive Expression AST.
 *   - `arbitraryInputTypeEnv`         : Port_Id -> PortType typing environments.
 *   - `arbitraryWellTypedExpression`  : expressions that type under an env AND
 *                                       whose output is assignable to a target.
 *   - `arbitraryTypedConfig`          : per-kind mostly-valid TypedNodeConfig.
 *   - `arbitraryNodeOfType`           : a valid WorkflowNode built from
 *                                       `defaultConfig(t)` with a random id.
 *   - `arbitraryConfigMutation`       : a single-point violation injected into a
 *                                       valid node plus the expected ConfigErrorCode.
 *   - `arbitraryReorderedConfig`      : a semantically-equivalent permutation.
 *
 * The base layer `arbitraryPortType` is reused for port / response / env types.
 * Everything here is pure and deterministic given a fast-check seed.
 */

import fc from 'fast-check';

import type { JsonValue, NodeType, Port, PortType, WorkflowNode } from '../types';
import { T_STRING, T_NUMBER, T_BOOLEAN, T_JSON, isAssignable } from '../portType';
import { arbitraryPortType } from '../arbitraries';
import {
  typeOfExpression,
  type Expression,
  type InputTypeEnv,
  type CompareOp,
  type LogicOp,
  type ArithOp,
} from './expression';
import {
  ConfigErrorCode,
  type TypedNodeConfig,
  type LlmConfig,
  type ConditionConfig,
  type ToolConfig,
  type TransformConfig,
  type HumanInputConfig,
  type LoopConfig,
  type ArgumentBinding,
  type InputPortDecl,
} from './configTypes';
import { defaultConfig } from './defaults';

// ===========================================================================
// Shared pools and operator generators
// ===========================================================================

/** Small Port_Id pool shared by expression / env / binding generators. */
const PORT_ID_POOL = ['p0', 'p1', 'p2', 'p3'] as const;

const arbCompareOp: fc.Arbitrary<CompareOp> = fc.constantFrom('eq', 'ne', 'lt', 'le', 'gt', 'ge');
const arbLogicOp: fc.Arbitrary<LogicOp> = fc.constantFrom('and', 'or');
const arbArithOp: fc.Arbitrary<ArithOp> = fc.constantFrom('add', 'sub', 'mul', 'div');

/** Map a base type kind to its canonical PortType constant. */
function baseTypeOf(kind: 'string' | 'number' | 'boolean' | 'json'): PortType {
  switch (kind) {
    case 'string':
      return T_STRING;
    case 'number':
      return T_NUMBER;
    case 'boolean':
      return T_BOOLEAN;
    case 'json':
      return T_JSON;
  }
}

// ===========================================================================
// 9.1 arbitraryExpression — depth-limited recursive AST
// ===========================================================================

/**
 * Generate a depth-limited recursive `Expression`. Leaves are literals
 * (`litString` / `litNumber` / `litBool`) or an `inputRef` drawn from a small
 * Port_Id pool. Inner nodes (`field` / `compare` / `logic` / `not` / `arith`)
 * recurse with a strictly smaller `maxDepth`, which guarantees termination.
 *
 * The generated expression is NOT guaranteed to be well-typed — that is the job
 * of `arbitraryWellTypedExpression`. This generator exercises the totality and
 * determinism properties of the typer over arbitrary syntax.
 */
export function arbitraryExpression(maxDepth = 3): fc.Arbitrary<Expression> {
  const leaf: fc.Arbitrary<Expression> = fc.oneof(
    fc.string().map((value): Expression => ({ node: 'litString', value })),
    fc.double().map((value): Expression => ({ node: 'litNumber', value })),
    fc.boolean().map((value): Expression => ({ node: 'litBool', value })),
    fc.constantFrom(...PORT_ID_POOL).map((portId): Expression => ({ node: 'inputRef', portId })),
  );
  if (maxDepth <= 0) {
    return leaf;
  }
  const child = arbitraryExpression(maxDepth - 1);
  return fc.oneof(
    leaf,
    fc
      .tuple(child, fc.string())
      .map(([target, name]): Expression => ({ node: 'field', target, name })),
    fc
      .tuple(arbCompareOp, child, child)
      .map(([op, left, right]): Expression => ({ node: 'compare', op, left, right })),
    fc
      .tuple(arbLogicOp, child, child)
      .map(([op, left, right]): Expression => ({ node: 'logic', op, left, right })),
    child.map((operand): Expression => ({ node: 'not', operand })),
    fc
      .tuple(arbArithOp, child, child)
      .map(([op, left, right]): Expression => ({ node: 'arith', op, left, right })),
  );
}

// ===========================================================================
// 9.1 arbitraryInputTypeEnv — Port_Id -> PortType environment
// ===========================================================================

/**
 * Generate an Input_Type_Environment: a `Map` of (a unique subset of) the
 * Port_Id pool to randomly generated PortTypes.
 */
export function arbitraryInputTypeEnv(maxKeys = 4): fc.Arbitrary<InputTypeEnv> {
  return fc
    .uniqueArray(fc.constantFrom(...PORT_ID_POOL), { minLength: 0, maxLength: maxKeys })
    .chain((ids) =>
      fc
        .tuple(...ids.map(() => arbitraryPortType(2)))
        .map((types) => new Map(ids.map((id, i) => [id, types[i]] as const))),
    );
}

// ===========================================================================
// 9.2 arbitraryWellTypedExpression — typed and assignable to a target
// ===========================================================================

/**
 * Literal generator for a base kind. For `json` (the top type) any base literal
 * is assignable, so we pick one at random.
 */
function literalForBase(kind: 'string' | 'number' | 'boolean' | 'json'): fc.Arbitrary<Expression> {
  switch (kind) {
    case 'string':
      return fc.string().map((value): Expression => ({ node: 'litString', value }));
    case 'number':
      return fc.double().map((value): Expression => ({ node: 'litNumber', value }));
    case 'boolean':
      return fc.boolean().map((value): Expression => ({ node: 'litBool', value }));
    case 'json':
      return fc.oneof(
        fc.string().map((value): Expression => ({ node: 'litString', value })),
        fc.double().map((value): Expression => ({ node: 'litNumber', value })),
        fc.boolean().map((value): Expression => ({ node: 'litBool', value })),
      );
  }
}

/**
 * Build expressions guaranteed (by construction) to type to a base `kind` under
 * `env`. Uses literals, `inputRef`s whose env type is assignable to the target,
 * and operators whose operand types match the operator's requirement.
 */
function wellTypedBase(
  env: InputTypeEnv,
  kind: 'string' | 'number' | 'boolean' | 'json',
  depth: number,
): fc.Arbitrary<Expression> {
  const target = baseTypeOf(kind);
  const refKeys = [...env.entries()]
    .filter(([, t]) => isAssignable(t, target))
    .map(([k]) => k);
  const refArbs: fc.Arbitrary<Expression>[] = refKeys.length
    ? [fc.constantFrom(...refKeys).map((portId): Expression => ({ node: 'inputRef', portId }))]
    : [];
  const base = fc.oneof(literalForBase(kind), ...refArbs);
  if (depth <= 0) {
    return base;
  }

  const options: fc.Arbitrary<Expression>[] = [base];
  if (kind === 'boolean') {
    options.push(
      wellTypedBase(env, 'boolean', depth - 1).map(
        (operand): Expression => ({ node: 'not', operand }),
      ),
      fc
        .tuple(arbLogicOp, wellTypedBase(env, 'boolean', depth - 1), wellTypedBase(env, 'boolean', depth - 1))
        .map(([op, left, right]): Expression => ({ node: 'logic', op, left, right })),
      fc
        .tuple(arbCompareOp, wellTypedBase(env, 'number', depth - 1), wellTypedBase(env, 'number', depth - 1))
        .map(([op, left, right]): Expression => ({ node: 'compare', op, left, right })),
    );
  } else if (kind === 'number') {
    options.push(
      fc
        .tuple(arbArithOp, wellTypedBase(env, 'number', depth - 1), wellTypedBase(env, 'number', depth - 1))
        .map(([op, left, right]): Expression => ({ node: 'arith', op, left, right })),
    );
  } else if (kind === 'json') {
    options.push(
      wellTypedBase(env, 'json', depth - 1).map(
        (innerTarget): Expression => ({ node: 'field', target: innerTarget, name: 'f' }),
      ),
      wellTypedBase(env, 'boolean', depth - 1),
      wellTypedBase(env, 'number', depth - 1),
      wellTypedBase(env, 'string', depth - 1),
    );
  }
  // `string` only has literal / inputRef forms (no operator produces a string).
  return fc.oneof(...options);
}

/**
 * A deterministic fallback expression that is well-typed under `env` and whose
 * output is assignable to `target`. Returns `null` when no such expression
 * exists in this AST (e.g. a bare `message`/`list` target with no matching env
 * key — those targets are never requested by this layer's generators).
 */
function fallbackExpr(env: InputTypeEnv, target: PortType): Expression | null {
  switch (target.kind) {
    case 'string':
      return { node: 'litString', value: '' };
    case 'number':
      return { node: 'litNumber', value: 0 };
    case 'boolean':
      return { node: 'litBool', value: true };
    case 'json':
      // Everything types and is assignable to json.
      return { node: 'litBool', value: true };
    case 'optional': {
      // A value assignable to the inner type is assignable to optional<inner>.
      const inner = fallbackExpr(env, target.inner);
      if (inner !== null) {
        return inner;
      }
      break;
    }
    default:
      break; // message / list: only an env reference can satisfy these.
  }
  for (const [portId, t] of env) {
    if (isAssignable(t, target)) {
      return { node: 'inputRef', portId };
    }
  }
  return null;
}

/**
 * Generate an expression that types successfully under `env` AND whose inferred
 * output type is assignable to `target` (R14.1 / R14.3). The candidate generator
 * is biased toward the target kind; every produced expression is then verified
 * with `typeOfExpression` + `isAssignable` and replaced by a guaranteed fallback
 * on the rare chance it does not satisfy the postcondition. This makes the
 * postcondition hold unconditionally.
 */
export function arbitraryWellTypedExpression(
  env: InputTypeEnv,
  target: PortType,
  maxDepth = 3,
): fc.Arbitrary<Expression> {
  const fallback: Expression = fallbackExpr(env, target) ?? { node: 'litBool', value: true };
  let candidate: fc.Arbitrary<Expression>;
  switch (target.kind) {
    case 'boolean':
      candidate = wellTypedBase(env, 'boolean', maxDepth);
      break;
    case 'number':
      candidate = wellTypedBase(env, 'number', maxDepth);
      break;
    case 'string':
      candidate = wellTypedBase(env, 'string', maxDepth);
      break;
    case 'json':
      candidate = wellTypedBase(env, 'json', maxDepth);
      break;
    default:
      // optional / list / message: rely on the deterministic fallback.
      candidate = fc.constant(fallback);
      break;
  }
  return candidate.map((expr) => {
    const r = typeOfExpression(expr, env);
    return r.ok && isAssignable(r.type, target) ? expr : fallback;
  });
}

// ===========================================================================
// 9.3 arbitraryTypedConfig — per-kind mostly-valid configs
// ===========================================================================

/** Environment seen by a condition expression (the default condition `in` port). */
const CONDITION_ENV: InputTypeEnv = new Map([['in', T_JSON]]);
/** Environment seen by a loop break condition (the default loop `body_back` port). */
const LOOP_ENV: InputTypeEnv = new Map([['body_back', T_JSON]]);

/** Generate argument bindings with unique argument names (avoids DUPLICATE by default). */
function arbitraryArgumentBindings(): fc.Arbitrary<ArgumentBinding[]> {
  return fc.uniqueArray(
    fc.record({
      portId: fc.constantFrom(...PORT_ID_POOL),
      argName: fc.string({ minLength: 1 }),
      portType: arbitraryPortType(2),
    }),
    { selector: (b) => b.argName, minLength: 0, maxLength: 3 },
  );
}

/** Generate transform input declarations with unique Port_Ids. */
function arbitraryDeclaredInputs(): fc.Arbitrary<InputPortDecl[]> {
  return fc.uniqueArray(
    fc.record({
      portId: fc.constantFrom(...PORT_ID_POOL),
      portType: arbitraryPortType(2),
      required: fc.boolean(),
    }),
    { selector: (d) => d.portId, minLength: 0, maxLength: 3 },
  );
}

const arbitraryLlmConfig: fc.Arbitrary<LlmConfig> = fc
  .record({
    modelId: fc.string({ minLength: 1 }),
    systemPrompt: fc.string(),
    temperature: fc.double({ min: 0, max: 2, noNaN: true }),
    maxTokens: fc.integer({ min: 1, max: 100000 }),
  })
  .map((r): LlmConfig => ({ kind: 'llm', ...r }));

const arbitraryConditionConfig: fc.Arbitrary<ConditionConfig> = arbitraryWellTypedExpression(
  CONDITION_ENV,
  T_BOOLEAN,
).map((condition): ConditionConfig => ({ kind: 'condition', condition }));

const arbitraryToolConfig: fc.Arbitrary<ToolConfig> = fc
  .record({
    toolName: fc.string({ minLength: 1 }),
    argumentBindings: arbitraryArgumentBindings(),
  })
  .map((r): ToolConfig => ({ kind: 'tool', toolName: r.toolName, argumentBindings: r.argumentBindings }));

const arbitraryTransformConfig: fc.Arbitrary<TransformConfig> = arbitraryDeclaredInputs().chain(
  (declaredInputs) => {
    const env: InputTypeEnv = new Map(declaredInputs.map((d) => [d.portId, d.portType] as const));
    // outputType = json (top type) keeps the inferred type assignable for any
    // well-typed transform expression, so the config stays valid.
    return arbitraryWellTypedExpression(env, T_JSON).map(
      (transform): TransformConfig => ({
        kind: 'transform',
        transform,
        declaredInputs,
        outputType: T_JSON,
      }),
    );
  },
);

const arbitraryHumanInputConfig: fc.Arbitrary<HumanInputConfig> = fc
  .record({
    prompt: fc.string({ minLength: 1 }),
    responseType: arbitraryPortType(2),
  })
  .map((r): HumanInputConfig => ({ kind: 'human_input', prompt: r.prompt, responseType: r.responseType }));

const arbitraryLoopConfig: fc.Arbitrary<LoopConfig> = fc
  .record({
    maxIterations: fc.integer({ min: 1, max: 1000 }),
    breakCondition: arbitraryWellTypedExpression(LOOP_ENV, T_BOOLEAN),
  })
  .map((r): LoopConfig => ({ kind: 'loop', maxIterations: r.maxIterations, breakCondition: r.breakCondition }));

/**
 * Per-kind config generator (design "Testing Strategy"). Produces mostly-valid
 * configs (including boundary numeric values and well-typed expressions) for the
 * requested `NodeType`.
 */
export function arbitraryTypedConfig(kind: NodeType): fc.Arbitrary<TypedNodeConfig> {
  switch (kind) {
    case 'llm':
      return arbitraryLlmConfig;
    case 'condition':
      return arbitraryConditionConfig;
    case 'tool':
      return arbitraryToolConfig;
    case 'transform':
      return arbitraryTransformConfig;
    case 'human_input':
      return arbitraryHumanInputConfig;
    case 'loop':
      return arbitraryLoopConfig;
  }
}

// ===========================================================================
// 9.3 arbitraryNodeOfType — a valid WorkflowNode from defaultConfig(t)
// ===========================================================================

/** Random non-empty node id (so `location.nodeId` is always populated). */
function arbitraryNodeId(): fc.Arbitrary<string> {
  return fc.hexaString({ minLength: 1, maxLength: 8 }).map((s) => `n_${s}`);
}

/**
 * Assemble a valid `WorkflowNode` from `defaultConfig(t)` — the default config
 * plus its `expectedPorts`-derived input/output port sets — with a random id.
 * The result passes `validateNodeConfig` by construction (round-trip validity),
 * making it the base for single-point mutations.
 */
export function arbitraryNodeOfType(t: NodeType): fc.Arbitrary<WorkflowNode> {
  const dc = defaultConfig(t);
  return arbitraryNodeId().map((id) => ({
    id,
    type: t,
    config: dc.config as unknown as JsonValue,
    inputs: dc.inputs,
    outputs: dc.outputs,
  }));
}

// ===========================================================================
// 9.3 arbitraryConfigMutation — single-point violation + expected code
// ===========================================================================

/** Replace a node's opaque config (accepts any shape for deliberate violations). */
function withConfig(node: WorkflowNode, config: unknown): WorkflowNode {
  return { ...node, config: config as JsonValue };
}

/** Replace a node's output port set. */
function withOutputs(node: WorkflowNode, outputs: readonly Port[]): WorkflowNode {
  return { ...node, outputs };
}

/** Replace a node's input port set. */
function withInputs(node: WorkflowNode, inputs: readonly Port[]): WorkflowNode {
  return { ...node, inputs };
}

/** A single-point mutation: the mutated node and the ConfigErrorCode it triggers. */
interface ConfigMutation {
  readonly node: WorkflowNode;
  readonly expectedCode: ConfigErrorCode;
}

/**
 * Build the applicable single-point mutations for a valid `node`. Each mutation
 * injects exactly one violation; the expected code is guaranteed to be included
 * in `validateNodeConfig`'s error set (a mutation may, as a side effect, surface
 * a related code — properties assert inclusion, not exclusivity).
 */
function buildMutations(node: WorkflowNode): ConfigMutation[] {
  const cfg = node.config as unknown as TypedNodeConfig;
  const muts: ConfigMutation[] = [];

  // CONFIG_TYPE_MISMATCH applies to every node type: flip `kind` away from type.
  const wrongKind: NodeType = node.type === 'llm' ? 'tool' : 'llm';
  muts.push({
    node: withConfig(node, { ...(cfg as unknown as Record<string, unknown>), kind: wrongKind }),
    expectedCode: ConfigErrorCode.CONFIG_TYPE_MISMATCH,
  });

  switch (node.type) {
    case 'llm': {
      const c = cfg as LlmConfig;
      muts.push({
        node: withConfig(node, { ...c, modelId: '' }),
        expectedCode: ConfigErrorCode.MISSING_REQUIRED_FIELD,
      });
      muts.push({
        node: withConfig(node, { ...c, temperature: 5 }),
        expectedCode: ConfigErrorCode.NUMERIC_OUT_OF_RANGE,
      });
      muts.push({
        node: withConfig(node, { ...c, maxTokens: 0 }),
        expectedCode: ConfigErrorCode.NUMERIC_OUT_OF_RANGE,
      });
      break;
    }
    case 'condition': {
      const c = cfg as ConditionConfig;
      muts.push({
        node: withConfig(node, { ...c, condition: { node: 'litString', value: '' } }),
        expectedCode: ConfigErrorCode.EXPRESSION_TYPE_ERROR,
      });
      // Drop one output -> output arity != 2.
      muts.push({
        node: withOutputs(node, node.outputs.slice(0, 1)),
        expectedCode: ConfigErrorCode.PORT_ARITY_MISMATCH,
      });
      // Keep two outputs but break the {true, false} id set.
      muts.push({
        node: withOutputs(
          node,
          node.outputs.map((p, i) => (i === 0 ? { ...p, id: 'maybe' } : p)),
        ),
        expectedCode: ConfigErrorCode.PORT_CONTRACT_MISMATCH,
      });
      break;
    }
    case 'tool': {
      const c = cfg as ToolConfig;
      muts.push({
        node: withConfig(node, { ...c, toolName: '' }),
        expectedCode: ConfigErrorCode.MISSING_REQUIRED_FIELD,
      });
      // Two bindings sharing an argName, with a matching declared input port so
      // only the duplicate-binding rule fires.
      muts.push({
        node: withInputs(
          withConfig(node, {
            ...c,
            argumentBindings: [
              { portId: 'p0', argName: 'a', portType: T_STRING },
              { portId: 'p0', argName: 'a', portType: T_STRING },
            ],
          }),
          [{ id: 'p0', direction: 'input', portType: T_STRING, required: true }],
        ),
        expectedCode: ConfigErrorCode.DUPLICATE_ARGUMENT_BINDING,
      });
      // A binding referencing an undeclared input port.
      muts.push({
        node: withConfig(node, {
          ...c,
          argumentBindings: [{ portId: 'pX', argName: 'a', portType: T_STRING }],
        }),
        expectedCode: ConfigErrorCode.PORT_CONTRACT_MISMATCH,
      });
      break;
    }
    case 'transform': {
      const c = cfg as TransformConfig;
      // Declared outputType incompatible with the inferred (string) output.
      muts.push({
        node: withConfig(node, { ...c, outputType: T_NUMBER }),
        expectedCode: ConfigErrorCode.EXPRESSION_TYPE_ERROR,
      });
      // Transform references an undeclared input port.
      muts.push({
        node: withConfig(node, { ...c, transform: { node: 'inputRef', portId: 'pX' } }),
        expectedCode: ConfigErrorCode.EXPRESSION_UNKNOWN_INPUT,
      });
      break;
    }
    case 'human_input': {
      const c = cfg as HumanInputConfig;
      muts.push({
        node: withConfig(node, { ...c, prompt: '' }),
        expectedCode: ConfigErrorCode.MISSING_REQUIRED_FIELD,
      });
      // Make the declared `response` port type differ from responseType (string).
      muts.push({
        node: withOutputs(
          node,
          node.outputs.map((p) => (p.id === 'response' ? { ...p, portType: T_NUMBER } : p)),
        ),
        expectedCode: ConfigErrorCode.PORT_CONTRACT_MISMATCH,
      });
      break;
    }
    case 'loop': {
      const c = cfg as LoopConfig;
      muts.push({
        node: withConfig(node, { ...c, maxIterations: 0 }),
        expectedCode: ConfigErrorCode.NUMERIC_OUT_OF_RANGE,
      });
      muts.push({
        node: withConfig(node, { ...c, breakCondition: { node: 'litString', value: '' } }),
        expectedCode: ConfigErrorCode.EXPRESSION_TYPE_ERROR,
      });
      break;
    }
  }

  return muts;
}

/**
 * "Mutate-then-detect": pick one single-point violation for the given valid node
 * and return the mutated node together with the `ConfigErrorCode` it is expected
 * to trigger.
 */
export function arbitraryConfigMutation(
  node: WorkflowNode,
): fc.Arbitrary<{ node: WorkflowNode; expectedCode: ConfigErrorCode }> {
  return fc.constantFrom(...buildMutations(node));
}

// ===========================================================================
// 9.3 arbitraryReorderedConfig — semantics-preserving permutation
// ===========================================================================

/** A full-length shuffle (permutation) of an array; identity for length <= 1. */
function shuffledFull<T>(arr: readonly T[]): fc.Arbitrary<readonly T[]> {
  if (arr.length <= 1) {
    return fc.constant(arr);
  }
  return fc.shuffledSubarray([...arr], { minLength: arr.length, maxLength: arr.length });
}

/**
 * Produce a semantically-equivalent config (`configSemanticEquals` true) by
 * permuting the order-insensitive collections: `argumentBindings` for tool and
 * `declaredInputs` for transform. Configs without such arrays are returned as-is.
 */
export function arbitraryReorderedConfig(c: TypedNodeConfig): fc.Arbitrary<TypedNodeConfig> {
  switch (c.kind) {
    case 'tool':
      return shuffledFull(c.argumentBindings).map(
        (argumentBindings): TypedNodeConfig => ({ ...c, argumentBindings }),
      );
    case 'transform':
      return shuffledFull(c.declaredInputs).map(
        (declaredInputs): TypedNodeConfig => ({ ...c, declaredInputs }),
      );
    default:
      return fc.constant(c);
  }
}
