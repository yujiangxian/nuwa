// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * workflow-node-types — default configuration factory.
 *
 * Feature: workflow-node-types
 *
 * This middle-layer module produces, for each `NodeType`, a VALID default
 * `TypedNodeConfig` together with its canonical default input/output port sets.
 * The defaults are designed so that the assembled `WorkflowNode` passes
 * `validateNodeConfig` (round-trip validity, R10.2), the discriminator `kind`
 * equals the requested `NodeType` (R1.3 / R10.3), and the default port sets are
 * exactly `expectedPorts(t, defaultConfig)` (R10.4).
 *
 * It is a pure, deterministic function: the same `NodeType` always yields the
 * same `DefaultConfig` (R10.5). No I/O, no mutable global state, no time/random.
 */

import type { NodeType, Port } from '../types';
import type { TypedNodeConfig } from './configTypes';
import { expectedPorts } from './expectedPorts';
import { T_STRING } from '../portType';

/**
 * Default config factory output (R10.1): a `TypedNodeConfig` plus the default
 * input/output port sets.
 */
export interface DefaultConfig {
  readonly config: TypedNodeConfig;
  readonly inputs: readonly Port[];
  readonly outputs: readonly Port[];
}

/**
 * Build the valid default `TypedNodeConfig` for a given `NodeType`.
 *
 * Each branch is constructed so that the per-type sub-checks of
 * `validateNodeConfig` pass:
 *   - llm: non-empty `modelId`, `temperature` ∈ [0, 2], integer `maxTokens` ≥ 1;
 *   - condition: a `litBool` expression that types to boolean;
 *   - tool: non-empty `toolName`, no argument bindings;
 *   - transform: an expression whose inferred type matches the declared
 *     `outputType` (both `string`), with no declared inputs;
 *   - human_input: non-empty `prompt`, a `string` response type;
 *   - loop: integer `maxIterations` ≥ 1, a `litBool` break condition (boolean).
 *
 * The discriminator `kind` always equals `nodeType` (R1.3 / R10.3).
 */
function defaultTypedConfig(nodeType: NodeType): TypedNodeConfig {
  switch (nodeType) {
    case 'llm':
      return {
        kind: 'llm',
        modelId: 'default-model',
        systemPrompt: '',
        temperature: 0.7,
        maxTokens: 512,
      };
    case 'condition':
      return {
        kind: 'condition',
        condition: { node: 'litBool', value: true }, // types to boolean
      };
    case 'tool':
      return {
        kind: 'tool',
        toolName: 'default-tool',
        argumentBindings: [],
      };
    case 'transform':
      return {
        kind: 'transform',
        transform: { node: 'litString', value: '' }, // inferred output = string
        declaredInputs: [],
        outputType: T_STRING, // matches the inferred string output
      };
    case 'human_input':
      return {
        kind: 'human_input',
        prompt: '请输入',
        responseType: T_STRING,
      };
    case 'loop':
      return {
        kind: 'loop',
        maxIterations: 10,
        breakCondition: { node: 'litBool', value: true }, // types to boolean
      };
    default: {
      // Exhaustiveness guard: adding a NodeType without a branch fails to compile.
      const _exhaustive: never = nodeType;
      return _exhaustive;
    }
  }
}

/**
 * Default configuration factory (R10.1). Produces a valid default config and the
 * default ports for the given `NodeType`.
 *
 * Round-trip validity (R10.2): a `WorkflowNode` built from this output passes
 * `validateNodeConfig`.
 * The default port sets are exactly `expectedPorts(t, defaultConfig)` (R10.4),
 * so port-contract checks succeed by construction.
 * Determinism (R10.5): the same `NodeType` always returns the same `DefaultConfig`.
 */
export function defaultConfig(nodeType: NodeType): DefaultConfig {
  const config = defaultTypedConfig(nodeType);
  // Default ports are exactly the derived expected ports (R10.4), keeping the
  // factory in lock-step with the port-contract derivation.
  const ports = expectedPorts(nodeType, config);
  return {
    config,
    inputs: ports.inputs,
    outputs: ports.outputs,
  };
}
