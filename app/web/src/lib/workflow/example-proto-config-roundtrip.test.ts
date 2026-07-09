// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-graph-model, Regression: config 含 "__proto__" 等危险键的序列化往返
//
// Guards against a prototype-pollution-style serialization bug: canonicalizeJson
// previously rebuilt config objects with `result[key] = …`, which for the
// special key "__proto__" invoked Object.prototype's __proto__ setter (mutating
// the prototype / dropping the key) instead of storing an own data property.
// As a result a node config such as `{ "__proto__": null }` was silently lost
// during serialize, breaking the round-trip semantic equality (Property 34).
//
// These deterministic examples pin the fix: configs carrying "__proto__",
// "constructor" and "prototype" keys (and nested occurrences) must survive a
// serialize → deserialize round-trip with graphEquals, and serialize must be a
// byte-level fixed point.
// Validates: Requirements 18.3, 18.4, 18.7

import { describe, it, expect } from 'vitest';

import { serialize, deserialize } from './serialize';
import { graphEquals } from './graph';
import type { JsonValue, WorkflowGraph } from './types';

/** Build a single-node graph whose llm node carries the given config. */
function graphWithConfig(config: JsonValue): WorkflowGraph {
  return {
    nodes: [{ id: 'n1', type: 'llm', config, inputs: [], outputs: [] }],
    edges: [],
    loopScopes: [],
    entryNodeId: null,
  };
}

/** Assert the graph round-trips (deserialize∘serialize ≅ g) and serialize is a fixed point. */
function expectRoundTrip(g: WorkflowGraph): void {
  const s1 = serialize(g);
  const result = deserialize(s1);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(graphEquals(result.graph, g)).toBe(true);
  // Byte-level fixed point (R18.4).
  expect(serialize(result.graph)).toBe(s1);
}

describe('Regression: dangerous JSON keys survive the serialization round-trip', () => {
  it('config with an own "__proto__" key (null value) round-trips', () => {
    // Computed key uses DefineOwnProperty semantics, creating an OWN property
    // named "__proto__" (unlike the literal `{ __proto__: … }` form).
    const config: JsonValue = { ['__proto__']: null } as unknown as JsonValue;
    expect(Object.keys(config as object)).toEqual(['__proto__']);
    expectRoundTrip(graphWithConfig(config));
  });

  it('config with "__proto__" mapped to a nested object round-trips', () => {
    const config: JsonValue = { ['__proto__']: { polluted: true } } as unknown as JsonValue;
    expectRoundTrip(graphWithConfig(config));
  });

  it('config with "constructor" and "prototype" keys round-trips', () => {
    const config: JsonValue = {
      constructor: 'not-a-constructor',
      prototype: 42,
      nested: { ['__proto__']: 'x' } as unknown as JsonValue,
    };
    expectRoundTrip(graphWithConfig(config));
  });

  it('serialized output actually contains the "__proto__" key', () => {
    const s = serialize(graphWithConfig({ ['__proto__']: null } as unknown as JsonValue));
    expect(s).toContain('"__proto__":null');
  });
});
