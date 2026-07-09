// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-node-types, Property 19: 端口推导——每类型基数与键集合
import { describe, it } from 'vitest';
import fc from 'fast-check';

import {
  expectedPorts,
  inferTransformOutputType,
  type ToolConfig,
  type HumanInputConfig,
  type TransformConfig,
} from './index';
import { arbitraryTypedConfig } from './arbitraries';

/** Order-insensitive set equality over string id arrays. */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) {
    return false;
  }
  for (const x of sa) {
    if (!sb.has(x)) {
      return false;
    }
  }
  return true;
}

/** Structural deep equality of two PortType values. */
function portTypeEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao).sort();
  const bk = Object.keys(bo).sort();
  if (ak.length !== bk.length) {
    return false;
  }
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i] || !portTypeEqual(ao[ak[i]], bo[bk[i]])) {
      return false;
    }
  }
  return true;
}

const arbCase = fc
  .constantFrom<'condition' | 'tool' | 'human_input' | 'transform'>(
    'condition',
    'tool',
    'human_input',
    'transform',
  )
  .chain((kind) => arbitraryTypedConfig(kind).map((config) => ({ kind, config })));

describe('Property 19: expectedPorts cardinality and key sets per node type', () => {
  it('derives the per-type contract (condition / tool / human_input / transform)', () => {
    fc.assert(
      fc.property(arbCase, ({ kind, config }) => {
        const ep = expectedPorts(kind, config);
        switch (kind) {
          case 'condition':
            // Exactly the two boolean branches {true, false} (R11.2).
            return ep.outputs.length === 2 && sameSet(ep.outputs.map((p) => p.id), ['true', 'false']);
          case 'tool': {
            // Exactly one `result` output, and the input id set equals the
            // (de-duplicated) argumentBindings Port_Id set (R11.3).
            const c = config as ToolConfig;
            const okOut = ep.outputs.length === 1 && ep.outputs[0].id === 'result';
            const okIn = sameSet(
              ep.inputs.map((p) => p.id),
              c.argumentBindings.map((b) => b.portId),
            );
            return okOut && okIn;
          }
          case 'human_input': {
            // Exactly one `response` output typed as the configured responseType (R11.4).
            const c = config as HumanInputConfig;
            return (
              ep.outputs.length === 1 &&
              ep.outputs[0].id === 'response' &&
              portTypeEqual(ep.outputs[0].portType, c.responseType)
            );
          }
          case 'transform': {
            // Exactly one `output` typed as the inferred output type (R11.5).
            const c = config as TransformConfig;
            return (
              ep.outputs.length === 1 &&
              ep.outputs[0].id === 'output' &&
              portTypeEqual(ep.outputs[0].portType, inferTransformOutputType(c))
            );
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
