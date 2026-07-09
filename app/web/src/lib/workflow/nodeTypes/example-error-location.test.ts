// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-node-types — example test for error location fields (R16.2–R16.4)

import { describe, it, expect } from 'vitest';

import type { Port, WorkflowNode } from '../types';
import { T_STRING } from '../portType';
import {
  ConfigErrorCode,
  defaultConfig,
  validateNodeConfig,
  type TypedNodeConfig,
} from './index';

/**
 * R16.2–R16.4: a config error must pinpoint the offending location:
 *   - a port-related error carries `location.portId`;
 *   - a field-related error carries `location.field`;
 *   - an expression-related error carries `location.exprPortId`.
 *
 * Each case below constructs a node that triggers exactly that family of error
 * and asserts the relevant location field is populated.
 */
describe('ConfigError location fields (R16.2–R16.4)', () => {
  /** Assemble a WorkflowNode from a typed config and explicit port sets. */
  function makeNode(
    id: string,
    config: TypedNodeConfig,
    inputs: readonly Port[],
    outputs: readonly Port[],
  ): WorkflowNode {
    return { id, type: config.kind, config: config as unknown as WorkflowNode['config'], inputs, outputs };
  }

  it('port-related error carries location.portId (tool: undeclared argument binding → R16.2)', () => {
    const def = defaultConfig('tool');
    // Bind a tool argument to a port id that is NOT among the node's declared
    // input ports → PORT_CONTRACT_MISMATCH located at that portId.
    const config: TypedNodeConfig = {
      kind: 'tool',
      toolName: 'my-tool',
      argumentBindings: [{ portId: 'ghost', argName: 'a', portType: T_STRING }],
    };
    // Keep node.inputs empty so 'ghost' is genuinely undeclared.
    const node = makeNode('t1', config, [], def.outputs);

    const result = validateNodeConfig(node);
    expect(result.valid).toBe(false);
    const portErr = result.errors.find(
      (e) => e.code === ConfigErrorCode.PORT_CONTRACT_MISMATCH && e.location.portId === 'ghost',
    );
    expect(portErr).toBeDefined();
    expect(portErr?.location.portId).toBe('ghost');
  });

  it('field-related error carries location.field (llm: empty modelId → R16.3)', () => {
    const def = defaultConfig('llm');
    // Empty modelId → MISSING_REQUIRED_FIELD(field=modelId). Keep all other
    // fields and ports valid so the field error is the focus.
    const config = { ...def.config, kind: 'llm', modelId: '' } as unknown as TypedNodeConfig;
    const node = makeNode('l1', config, def.inputs, def.outputs);

    const result = validateNodeConfig(node);
    expect(result.valid).toBe(false);
    const fieldErr = result.errors.find(
      (e) => e.code === ConfigErrorCode.MISSING_REQUIRED_FIELD && e.location.field === 'modelId',
    );
    expect(fieldErr).toBeDefined();
    expect(fieldErr?.location.field).toBe('modelId');
  });

  it('expression-related error carries location.exprPortId (transform: unknown inputRef → R16.4)', () => {
    const def = defaultConfig('transform');
    // Reference an input port that is not declared → EXPRESSION_UNKNOWN_INPUT
    // located at exprPortId. With no declared inputs and the inferred type
    // falling back to the declared outputType, the port contract still matches,
    // so the expression error is isolated.
    const config: TypedNodeConfig = {
      kind: 'transform',
      transform: { node: 'inputRef', portId: 'missingInput' },
      declaredInputs: [],
      outputType: T_STRING,
    };
    const node = makeNode('x1', config, def.inputs, def.outputs);

    const result = validateNodeConfig(node);
    expect(result.valid).toBe(false);
    const exprErr = result.errors.find(
      (e) => e.code === ConfigErrorCode.EXPRESSION_UNKNOWN_INPUT && e.location.exprPortId === 'missingInput',
    );
    expect(exprErr).toBeDefined();
    expect(exprErr?.location.exprPortId).toBe('missingInput');
  });
});
