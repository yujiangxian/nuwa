// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * workflow-node-types — per-type port contract derivation (R11).
 *
 * Feature: workflow-node-types
 *
 * This module is a middle layer of the nodeTypes sub-spec. Given a `NodeType`
 * and its `TypedNodeConfig`, `expectedPorts` derives the canonical set of input
 * and output `Port`s that satisfy the per-type Port_Contract (design algorithm
 * 2). The result is deterministic (R11.6): the same `(nodeType, config)` always
 * yields the same `ExpectedPorts`, with ports laid out in a stable order (by
 * Port_Id lexicographic order).
 *
 * `inferTransformOutputType` derives the transform `output` port type from the
 * declared inputs by reusing the total static typer `typeOfExpression`, falling
 * back to the declared `outputType` on a typing failure so the function stays
 * total.
 *
 * Every export is a pure function. No I/O, no mutable global state, no
 * time/random dependency.
 */

import type { NodeType, Port, PortType } from '../types';
import type {
  TypedNodeConfig,
  LlmConfig,
  ConditionConfig,
  ToolConfig,
  TransformConfig,
  HumanInputConfig,
  LoopConfig,
} from './configTypes';
import { typeOfExpression, type InputTypeEnv } from './expression';
// Reuse the base layer type constructors as the single source of PortType values.
import { T_STRING, T_BOOLEAN, T_JSON, T_MESSAGE, optionalOf } from '../portType';

// ---------------------------------------------------------------------------
// 3.1 ExpectedPorts and expectedPorts
// ---------------------------------------------------------------------------

/** Port contract derivation result (R11.1): the canonical input/output port sets. */
export interface ExpectedPorts {
  readonly inputs: readonly Port[];
  readonly outputs: readonly Port[];
}

/** Build an input Port. `required` only matters for inputs (base layer R2.3). */
function inputPort(id: string, portType: PortType, required: boolean): Port {
  return { id, direction: 'input', portType, required };
}

/** Build an output Port. `required` is ignored for outputs; kept false for stability. */
function outputPort(id: string, portType: PortType): Port {
  return { id, direction: 'output', portType, required: false };
}

/**
 * Sort ports by Port_Id in lexicographic order, producing a fresh array. The
 * comparison is total and deterministic (Port_Ids are unique within a direction,
 * base layer R2.4), so the sort is stable for our purposes.
 */
function sortById(ports: readonly Port[]): readonly Port[] {
  return [...ports].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Derive the tool input ports from `argumentBindings`: dedup by Port_Id (keeping
 * the first occurrence after sorting), each becomes a required input port whose
 * type is the binding's `portType`. Sorting by Port_Id makes dedup deterministic.
 */
function toolInputPorts(bindings: ToolConfig['argumentBindings']): readonly Port[] {
  const sorted = [...bindings].sort((a, b) => (a.portId < b.portId ? -1 : a.portId > b.portId ? 1 : 0));
  const seen = new Set<string>();
  const ports: Port[] = [];
  for (const b of sorted) {
    if (seen.has(b.portId)) {
      continue; // dedup by Port_Id
    }
    seen.add(b.portId);
    ports.push(inputPort(b.portId, b.portType, true));
  }
  return ports;
}

/** Derive the transform input ports from `declaredInputs`, sorted by Port_Id. */
function transformInputPorts(decls: TransformConfig['declaredInputs']): readonly Port[] {
  return decls.map((d) => inputPort(d.portId, d.portType, d.required));
}

/**
 * Port contract derivation (R11.1, design algorithm 2). The function keys on the
 * `nodeType`; `config` is the matching `TypedNodeConfig` branch (callers ensure
 * `nodeType === config.kind`, enforced upstream by `refineConfig`). Ports are
 * returned in a stable Port_Id order, making the result deterministic (R11.6).
 */
export function expectedPorts(nodeType: NodeType, config: TypedNodeConfig): ExpectedPorts {
  let inputs: readonly Port[];
  let outputs: readonly Port[];

  switch (nodeType) {
    case 'llm': {
      // config is the matching LlmConfig branch (no llm-specific fields needed here).
      void (config as LlmConfig);
      inputs = [
        inputPort('prompt', T_STRING, true),
        inputPort('context', optionalOf(T_MESSAGE), false),
      ];
      outputs = [outputPort('completion', T_STRING), outputPort('message', T_MESSAGE)];
      break;
    }
    case 'condition': {
      void (config as ConditionConfig);
      // A single `in` json input carries the decision input; outputs are exactly
      // two boolean branches `true`/`false` (R11.2).
      inputs = [inputPort('in', T_JSON, false)];
      outputs = [outputPort('true', T_BOOLEAN), outputPort('false', T_BOOLEAN)];
      break;
    }
    case 'tool': {
      const c = config as ToolConfig;
      inputs = toolInputPorts(c.argumentBindings);
      outputs = [outputPort('result', T_JSON)]; // exactly one `result` (R11.3)
      break;
    }
    case 'transform': {
      const c = config as TransformConfig;
      inputs = transformInputPorts(c.declaredInputs);
      outputs = [outputPort('output', inferTransformOutputType(c))]; // exactly one `output` (R11.5)
      break;
    }
    case 'human_input': {
      const c = config as HumanInputConfig;
      inputs = []; // no required inputs (R6.3)
      outputs = [outputPort('response', c.responseType)]; // exactly one `response` (R11.4)
      break;
    }
    case 'loop': {
      void (config as LoopConfig);
      inputs = [inputPort('body_back', T_JSON, false)];
      outputs = [outputPort('body_in', T_JSON), outputPort('exit', T_JSON)];
      break;
    }
    default: {
      // Exhaustiveness guard: adding a NodeType without a case fails to compile.
      const _exhaustive: never = nodeType;
      return _exhaustive;
    }
  }

  return { inputs: sortById(inputs), outputs: sortById(outputs) };
}

/**
 * Infer the transform `output` port type (design algorithm 2). Build an
 * Input_Type_Environment from `declaredInputs` and run the total typer over the
 * transform expression; on success return the inferred type, otherwise fall back
 * to the declared `outputType` so the function stays total.
 */
export function inferTransformOutputType(config: TransformConfig): PortType {
  const env: InputTypeEnv = new Map(config.declaredInputs.map((d) => [d.portId, d.portType] as const));
  const r = typeOfExpression(config.transform, env);
  return r.ok ? r.type : config.outputType;
}
