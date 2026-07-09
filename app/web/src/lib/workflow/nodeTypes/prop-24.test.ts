// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-node-types, Property 24: 规范化与图序列化器往返一致
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { expectedPorts, normalizeNodeConfig, type TypedNodeConfig } from './index';
import { arbitraryTypedConfig } from './arbitraries';
import { NODE_TYPES, type JsonValue, type NodeType, type WorkflowGraph, type WorkflowNode } from '../types';
import { serialize, deserialize } from '../serialize';

/** Order-insensitive structural deep equality (Object.is at the leaves). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr || bArr) {
    if (!aArr || !bArr) {
      return false;
    }
    const aa = a as unknown[];
    const ba = b as unknown[];
    if (aa.length !== ba.length) {
      return false;
    }
    for (let i = 0; i < aa.length; i++) {
      if (!deepEqual(aa[i], ba[i])) {
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
    if (ak[i] !== bk[i] || !deepEqual(ao[ak[i]], bo[bk[i]])) {
      return false;
    }
  }
  return true;
}

/**
 * Coerce every numeric value to a finite, JSON-representable value. The base
 * graph serializer is defined over Canonical_Json, which (like JSON) cannot
 * carry `Infinity` / `NaN` / `-0` — `JSON.stringify` maps them to `null` / `0`.
 * A persisted node config therefore lives in the JSON-representable number
 * space, so we sanitize the generated config to that realistic domain before
 * exercising the normalize → serialize → deserialize round-trip.
 */
function sanitizeNumbers(v: unknown): unknown {
  if (typeof v === 'number') {
    return Number.isFinite(v) && !Object.is(v, -0) ? v : 0;
  }
  if (Array.isArray(v)) {
    return v.map(sanitizeNumbers);
  }
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>)) {
      out[k] = sanitizeNumbers((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

const arbCase = fc.constantFrom(...NODE_TYPES).chain((kind: NodeType) =>
  arbitraryTypedConfig(kind).map((rawConfig) => {
    // Restrict to JSON-representable (finite) numeric literals — see sanitizeNumbers.
    const config = sanitizeNumbers(rawConfig) as TypedNodeConfig;
    const norm = normalizeNodeConfig(kind, config);
    const ports = expectedPorts(kind, norm);
    return { kind, norm, inputs: ports.inputs, outputs: ports.outputs };
  }),
);

describe('Property 24: normalized config round-trips through the graph serializer', () => {
  it('serialize + deserialize preserves the normalized node config', () => {
    fc.assert(
      fc.property(arbCase, ({ kind, norm, inputs, outputs }) => {
        const node: WorkflowNode = {
          id: 'n1',
          type: kind,
          config: norm as unknown as JsonValue,
          inputs,
          outputs,
        };
        const graph: WorkflowGraph = {
          nodes: [node],
          edges: [],
          loopScopes: [],
          entryNodeId: 'n1',
        };
        const restored = deserialize(serialize(graph));
        if (!restored.ok) {
          return false;
        }
        const roundTripped = restored.graph.nodes[0].config;
        return deepEqual(roundTripped, norm);
      }),
      { numRuns: 100 },
    );
  });
});
