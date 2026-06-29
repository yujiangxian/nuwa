/**
 * workflow-node-types — config validation aggregator (R8, design algorithm 3 & 6).
 *
 * Feature: workflow-node-types
 *
 * This module is the top-level aggregator of the nodeTypes sub-spec. It refines
 * the opaque `WorkflowNode.config` (a `JsonValue`) into a `TypedNodeConfig`
 * branch (`refineConfig`, algorithm 6), runs the matching per-type sub-check plus
 * the port-contract check, collects ALL violations without short-circuiting, sorts
 * them stably, and returns a `ConfigValidationResult` (`validateNodeConfig`,
 * algorithm 3).
 *
 * Every export is a pure function: no I/O, no mutable global state, no
 * time/random dependency, and none of them ever throw (totality).
 */

import type { Port, WorkflowNode } from '../types';
import {
  ConfigErrorCode,
  type ConfigError,
  type ConfigValidationResult,
  type TypedNodeConfig,
  type LlmConfig,
  type ConditionConfig,
  type ToolConfig,
  type TransformConfig,
  type HumanInputConfig,
  type LoopConfig,
} from './configTypes';
import { typeOfExpression, type Expression, type InputTypeEnv } from './expression';
import { expectedPorts } from './expectedPorts';
import { isAssignable, portTypeEquals, T_BOOLEAN } from '../portType';
import { getOutputPort } from '../graph';

// ---------------------------------------------------------------------------
// Error builders — each carries a non-empty message and location.nodeId (R16.1).
// ---------------------------------------------------------------------------

function configTypeMismatch(nodeId: string, message: string): ConfigError {
  return { code: ConfigErrorCode.CONFIG_TYPE_MISMATCH, message, location: { nodeId } };
}

function missingFieldError(nodeId: string, field: string): ConfigError {
  return {
    code: ConfigErrorCode.MISSING_REQUIRED_FIELD,
    message: `Required field "${field}" is missing or empty.`,
    location: { nodeId, field },
  };
}

function numericError(nodeId: string, field: string, detail: string): ConfigError {
  return {
    code: ConfigErrorCode.NUMERIC_OUT_OF_RANGE,
    message: `Field "${field}" ${detail}.`,
    location: { nodeId, field },
  };
}

function arityError(nodeId: string, message: string): ConfigError {
  return { code: ConfigErrorCode.PORT_ARITY_MISMATCH, message, location: { nodeId } };
}

function portContractError(nodeId: string, portId: string | undefined, message: string): ConfigError {
  return {
    code: ConfigErrorCode.PORT_CONTRACT_MISMATCH,
    message,
    location: portId === undefined ? { nodeId } : { nodeId, portId },
  };
}

function dupArgError(nodeId: string, argName: string): ConfigError {
  return {
    code: ConfigErrorCode.DUPLICATE_ARGUMENT_BINDING,
    message: `Duplicate argument binding name "${argName}".`,
    location: { nodeId, field: argName },
  };
}

function exprTypeError(nodeId: string, message: string, exprPortId?: string): ConfigError {
  return {
    code: ConfigErrorCode.EXPRESSION_TYPE_ERROR,
    message,
    location: exprPortId === undefined ? { nodeId } : { nodeId, exprPortId },
  };
}

function unknownInputError(nodeId: string, message: string, exprPortId?: string): ConfigError {
  return {
    code: ConfigErrorCode.EXPRESSION_UNKNOWN_INPUT,
    message,
    location: exprPortId === undefined ? { nodeId } : { nodeId, exprPortId },
  };
}

// ---------------------------------------------------------------------------
// Small total helpers.
// ---------------------------------------------------------------------------

/** Build an Input_Type_Environment (Port_Id -> PortType) from a node's input ports. */
function envFromPorts(ports: readonly Port[]): InputTypeEnv {
  return new Map(ports.map((p) => [p.id, p.portType] as const));
}

/** Runtime guard: the value is shaped like an Expression (has a string `node` tag). */
function isExpressionLike(v: unknown): v is Expression {
  return typeof v === 'object' && v !== null && typeof (v as { node?: unknown }).node === 'string';
}

// ---------------------------------------------------------------------------
// 6.1 refineConfig (design algorithm 6, R1.5)
// ---------------------------------------------------------------------------

/**
 * Refine the opaque `WorkflowNode.config` into a `TypedNodeConfig`. When the
 * config is not an object, lacks a `kind` discriminator, or its `kind` does not
 * equal `node.type`, returns a `CONFIG_TYPE_MISMATCH` failure (R1.5). Never throws.
 */
export function refineConfig(
  node: WorkflowNode,
): { ok: true; config: TypedNodeConfig } | { ok: false; error: ConfigError } {
  const v = node.config;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    return { ok: false, error: configTypeMismatch(node.id, `Config payload is not an object.`) };
  }
  const kind = (v as { readonly kind?: unknown }).kind;
  if (typeof kind !== 'string') {
    return { ok: false, error: configTypeMismatch(node.id, `Config is missing a "kind" discriminator.`) };
  }
  if (kind !== node.type) {
    return {
      ok: false,
      error: configTypeMismatch(node.id, `Config kind "${kind}" does not match node type "${node.type}".`),
    };
  }
  // The kind matches the node type; field-level structure is checked by the
  // per-type sub-checks (which may emit MISSING_REQUIRED_FIELD etc.).
  return { ok: true, config: v as unknown as TypedNodeConfig };
}

// ---------------------------------------------------------------------------
// 6.2 checkLlmConfig (R2.4–2.6)
// ---------------------------------------------------------------------------

export function checkLlmConfig(node: WorkflowNode, config: LlmConfig): ConfigError[] {
  const errors: ConfigError[] = [];
  // Missing/empty modelId -> MISSING_REQUIRED_FIELD(field=modelId) (R2.4).
  if (typeof config.modelId !== 'string' || config.modelId.length === 0) {
    errors.push(missingFieldError(node.id, 'modelId'));
  }
  // temperature must lie in [0, 2] (NaN/non-number also fail) (R2.5).
  if (typeof config.temperature !== 'number' || !(config.temperature >= 0 && config.temperature <= 2)) {
    errors.push(numericError(node.id, 'temperature', 'must be within the range [0, 2]'));
  }
  // maxTokens must be an integer >= 1 (R2.6).
  if (!Number.isInteger(config.maxTokens) || config.maxTokens < 1) {
    errors.push(numericError(node.id, 'maxTokens', 'must be an integer >= 1'));
  }
  return errors;
}

// ---------------------------------------------------------------------------
// 6.3 checkConditionConfig (R3.5–3.6)
// ---------------------------------------------------------------------------

export function checkConditionConfig(node: WorkflowNode, config: ConditionConfig): ConfigError[] {
  const errors: ConfigError[] = [];
  if (!isExpressionLike(config.condition)) {
    errors.push(exprTypeError(node.id, 'Condition expression is missing or malformed.'));
    return errors;
  }
  const env = envFromPorts(node.inputs);
  const r = typeOfExpression(config.condition, env);
  if (!r.ok) {
    // Unknown input -> EXPRESSION_UNKNOWN_INPUT (carry the Port_Id); otherwise a
    // type error -> EXPRESSION_TYPE_ERROR (R3.5/R3.6).
    if (r.error.code === ConfigErrorCode.EXPRESSION_UNKNOWN_INPUT) {
      errors.push(unknownInputError(node.id, r.error.message, r.error.portId));
    } else {
      errors.push(exprTypeError(node.id, r.error.message));
    }
  } else if (!isAssignable(r.type, T_BOOLEAN)) {
    errors.push(exprTypeError(node.id, 'Condition expression does not type to boolean.'));
  }
  return errors;
}

// ---------------------------------------------------------------------------
// 6.4 checkToolConfig (R4.4–4.6)
// ---------------------------------------------------------------------------

export function checkToolConfig(node: WorkflowNode, config: ToolConfig): ConfigError[] {
  const errors: ConfigError[] = [];
  // Missing/empty toolName -> MISSING_REQUIRED_FIELD(field=toolName) (R4.4).
  if (typeof config.toolName !== 'string' || config.toolName.length === 0) {
    errors.push(missingFieldError(node.id, 'toolName'));
  }
  const bindings = Array.isArray(config.argumentBindings) ? config.argumentBindings : [];
  const declaredInputIds = new Set(node.inputs.map((p) => p.id));
  // A binding portId not in the declared input ports -> PORT_CONTRACT_MISMATCH (R4.5).
  for (const b of bindings) {
    if (!declaredInputIds.has(b.portId)) {
      errors.push(
        portContractError(node.id, b.portId, `Argument binding references undeclared input port "${b.portId}".`),
      );
    }
  }
  // Duplicate argName -> DUPLICATE_ARGUMENT_BINDING, reported once per name (R4.6).
  const seen = new Set<string>();
  const reported = new Set<string>();
  for (const b of bindings) {
    if (seen.has(b.argName) && !reported.has(b.argName)) {
      errors.push(dupArgError(node.id, b.argName));
      reported.add(b.argName);
    }
    seen.add(b.argName);
  }
  return errors;
}

// ---------------------------------------------------------------------------
// 6.5 checkTransformConfig (R5.3–5.5, R14.5)
// ---------------------------------------------------------------------------

export function checkTransformConfig(node: WorkflowNode, config: TransformConfig): ConfigError[] {
  const errors: ConfigError[] = [];
  const decls = Array.isArray(config.declaredInputs) ? config.declaredInputs : [];
  const env: InputTypeEnv = new Map(decls.map((d) => [d.portId, d.portType] as const));
  if (!isExpressionLike(config.transform)) {
    errors.push(exprTypeError(node.id, 'Transform expression is missing or malformed.'));
    return errors;
  }
  const r = typeOfExpression(config.transform, env);
  if (!r.ok) {
    // Unknown declared input -> EXPRESSION_UNKNOWN_INPUT(exprPortId) (R5.5);
    // otherwise an operator type error -> EXPRESSION_TYPE_ERROR.
    if (r.error.code === ConfigErrorCode.EXPRESSION_UNKNOWN_INPUT) {
      errors.push(unknownInputError(node.id, r.error.message, r.error.portId));
    } else {
      errors.push(exprTypeError(node.id, r.error.message));
    }
  } else if (config.outputType != null && !isAssignable(r.type, config.outputType)) {
    // Inferred type not assignable to the declared outputType -> EXPRESSION_TYPE_ERROR (R5.4).
    errors.push(exprTypeError(node.id, 'Transform inferred type is not assignable to the declared outputType.'));
  }
  return errors;
}

// ---------------------------------------------------------------------------
// 6.6 checkHumanInputConfig (R6.4–6.5)
// ---------------------------------------------------------------------------

export function checkHumanInputConfig(node: WorkflowNode, config: HumanInputConfig): ConfigError[] {
  const errors: ConfigError[] = [];
  // Missing/empty prompt -> MISSING_REQUIRED_FIELD(field=prompt) (R6.4).
  if (typeof config.prompt !== 'string' || config.prompt.length === 0) {
    errors.push(missingFieldError(node.id, 'prompt'));
  }
  // A declared `response` output port whose type differs from responseType
  // -> PORT_CONTRACT_MISMATCH (R6.5).
  const responsePort = getOutputPort(node, 'response');
  if (responsePort !== undefined && config.responseType != null && !portTypeEquals(responsePort.portType, config.responseType)) {
    errors.push(portContractError(node.id, 'response', 'Response output port type does not match the configured responseType.'));
  }
  return errors;
}

// ---------------------------------------------------------------------------
// 6.7 checkLoopConfig (R7.3–7.5)
// ---------------------------------------------------------------------------

export function checkLoopConfig(node: WorkflowNode, config: LoopConfig): ConfigError[] {
  const errors: ConfigError[] = [];
  // maxIterations must be an integer >= 1 (R7.3).
  if (!Number.isInteger(config.maxIterations) || config.maxIterations < 1) {
    errors.push(numericError(node.id, 'maxIterations', 'must be an integer >= 1'));
  }
  // breakCondition: any typing failure or a non-boolean result -> EXPRESSION_TYPE_ERROR (R7.5).
  if (!isExpressionLike(config.breakCondition)) {
    errors.push(exprTypeError(node.id, 'Break condition expression is missing or malformed.'));
  } else {
    const env = envFromPorts(node.inputs);
    const r = typeOfExpression(config.breakCondition, env);
    if (!r.ok) {
      errors.push(exprTypeError(node.id, r.error.message, r.error.portId));
    } else if (!isAssignable(r.type, T_BOOLEAN)) {
      errors.push(exprTypeError(node.id, 'Break condition expression does not type to boolean.'));
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// 6.8 checkPortContract (R3.3, R3.4, R11.7)
// ---------------------------------------------------------------------------

/**
 * Compare a node's declared ports for one direction against the expected ports.
 * A cardinality difference yields a single PORT_ARITY_MISMATCH; otherwise each
 * missing or type-mismatched port yields a PORT_CONTRACT_MISMATCH.
 */
function comparePortSet(
  nodeId: string,
  direction: 'input' | 'output',
  declared: readonly Port[],
  expected: readonly Port[],
): ConfigError[] {
  if (declared.length !== expected.length) {
    return [
      arityError(
        nodeId,
        `Expected ${expected.length} ${direction} port(s) but found ${declared.length}.`,
      ),
    ];
  }
  const errors: ConfigError[] = [];
  const byId = new Map(declared.map((p) => [p.id, p] as const));
  for (const ep of expected) {
    const dp = byId.get(ep.id);
    if (dp === undefined) {
      errors.push(portContractError(nodeId, ep.id, `Missing expected ${direction} port "${ep.id}".`));
    } else if (!portTypeEquals(dp.portType, ep.portType)) {
      errors.push(portContractError(nodeId, ep.id, `${direction} port "${ep.id}" has an incompatible type.`));
    }
  }
  return errors;
}

/** condition-specific port check: exactly two outputs whose Port_Ids are {true, false}. */
function checkConditionPorts(node: WorkflowNode): ConfigError[] {
  const outputs = node.outputs;
  if (outputs.length !== 2) {
    return [arityError(node.id, `Condition node must have exactly 2 output ports but found ${outputs.length}.`)];
  }
  const ids = new Set(outputs.map((p) => p.id));
  if (ids.size === 2 && ids.has('true') && ids.has('false')) {
    return [];
  }
  const invalid = outputs.find((p) => p.id !== 'true' && p.id !== 'false');
  return [
    portContractError(node.id, invalid?.id, `Condition output ports must be exactly {true, false}.`),
  ];
}

/**
 * Port contract check (R11.7). For condition nodes the contract is fixed
 * ({true, false} outputs); for every other type the declared ports must match
 * `expectedPorts(node.type, config)` by direction, Port_Id and type.
 */
export function checkPortContract(node: WorkflowNode, config: TypedNodeConfig): ConfigError[] {
  if (config.kind === 'condition') {
    return checkConditionPorts(node);
  }
  const expected = expectedPorts(node.type, config);
  return [
    ...comparePortSet(node.id, 'input', node.inputs, expected.inputs),
    ...comparePortSet(node.id, 'output', node.outputs, expected.outputs),
  ];
}

// ---------------------------------------------------------------------------
// 6.9 validateNodeConfig (design algorithm 3, R8)
// ---------------------------------------------------------------------------

/** ConfigErrorCode in declaration order — the primary sort key (R8.5). */
const CODE_ORDER: readonly ConfigErrorCode[] = [
  ConfigErrorCode.CONFIG_TYPE_MISMATCH,
  ConfigErrorCode.MISSING_REQUIRED_FIELD,
  ConfigErrorCode.NUMERIC_OUT_OF_RANGE,
  ConfigErrorCode.PORT_ARITY_MISMATCH,
  ConfigErrorCode.PORT_CONTRACT_MISMATCH,
  ConfigErrorCode.DUPLICATE_ARGUMENT_BINDING,
  ConfigErrorCode.EXPRESSION_TYPE_ERROR,
  ConfigErrorCode.EXPRESSION_UNKNOWN_INPUT,
];

/** Build the secondary sort key from an error location. */
function locationKey(e: ConfigError): string {
  const l = e.location;
  return `${l.nodeId}|${l.portId ?? ''}|${l.field ?? ''}|${l.exprPortId ?? ''}`;
}

/**
 * Stable sort by (ConfigErrorCode declaration order, location key). The original
 * index is used as a final tie-breaker to make the sort deterministic regardless
 * of the engine's sort stability.
 */
function sortErrors(errors: readonly ConfigError[]): ConfigError[] {
  return errors
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const ca = CODE_ORDER.indexOf(a.e.code);
      const cb = CODE_ORDER.indexOf(b.e.code);
      if (ca !== cb) {
        return ca - cb;
      }
      const ka = locationKey(a.e);
      const kb = locationKey(b.e);
      if (ka < kb) return -1;
      if (ka > kb) return 1;
      return a.i - b.i;
    })
    .map((x) => x.e);
}

/** Run the matching per-type sub-check for a refined config. */
function checkByType(node: WorkflowNode, config: TypedNodeConfig): ConfigError[] {
  switch (config.kind) {
    case 'llm':
      return checkLlmConfig(node, config);
    case 'condition':
      return checkConditionConfig(node, config);
    case 'tool':
      return checkToolConfig(node, config);
    case 'transform':
      return checkTransformConfig(node, config);
    case 'human_input':
      return checkHumanInputConfig(node, config);
    case 'loop':
      return checkLoopConfig(node, config);
    default: {
      // Exhaustiveness guard: a new branch without a case fails to compile.
      const _exhaustive: never = config;
      void _exhaustive;
      return [];
    }
  }
}

/**
 * Config validation entry point (R8.1, design algorithm 3). Refines the config;
 * on a refinement failure returns the single CONFIG_TYPE_MISMATCH. Otherwise it
 * runs the matching per-type sub-check plus the port-contract check, collects ALL
 * errors (no short-circuit, R8.6), sorts them stably (R8.5) and returns the
 * result. Pure and deterministic (R8.4).
 */
export function validateNodeConfig(node: WorkflowNode): ConfigValidationResult {
  const refined = refineConfig(node);
  if (!refined.ok) {
    return { valid: false, errors: [refined.error] };
  }
  const config = refined.config;
  const errors: ConfigError[] = [...checkByType(node, config), ...checkPortContract(node, config)];
  const sorted = sortErrors(errors);
  return { valid: sorted.length === 0, errors: sorted };
}
