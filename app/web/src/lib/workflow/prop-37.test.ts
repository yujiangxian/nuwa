// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-graph-model, Property 37: 非法输入返回错误结果
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { deserialize } from './serialize';

/**
 * A collection of malformed-input generators. Every value produced here is
 * guaranteed NOT to be a well-formed Canonical_Json graph:
 *   - arbitrary unicode strings (almost never valid JSON, never a valid graph);
 *   - valid-JSON-but-wrong-shape values (scalars, arrays, objects missing the
 *     required fields, ports carrying invalid PortType strings).
 * `deserialize` must return `{ ok: false }` for all of them and NEVER throw.
 */
function arbitraryMalformedInput(): fc.Arbitrary<string> {
  // Valid JSON text whose decoded value is never a well-formed graph: scalars,
  // arrays, and objects with random keys (which lack the required graph fields).
  const validJsonWrongShape = fc
    .oneof(
      fc.constant<unknown>(null),
      fc.boolean(),
      fc.integer(),
      fc.double({ noNaN: true }),
      fc.string(),
      fc.array(fc.string()),
      fc.dictionary(fc.string(), fc.string()),
    )
    .map((v) => JSON.stringify(v));

  // Hand-crafted structural defects exercising specific validation branches.
  const craftedDefects = fc.constantFrom(
    '', // empty -> JSON.parse throws
    '{', // truncated object -> JSON.parse throws
    'not json at all', // free text -> JSON.parse throws
    '{"nodes": "x", "edges": [], "loopScopes": [], "entryNodeId": null}', // nodes not array
    '{"edges": [], "loopScopes": [], "entryNodeId": null}', // missing nodes
    '{"nodes": [], "edges": [], "loopScopes": []}', // missing entryNodeId
    '{"nodes": [{}], "edges": [], "loopScopes": [], "entryNodeId": null}', // node missing fields
    '{"nodes": [{"id": "a", "type": "bogus", "config": null, "inputs": [], "outputs": []}], "edges": [], "loopScopes": [], "entryNodeId": null}', // invalid node type
    '{"nodes": [{"id": "a", "type": "tool", "config": null, "inputs": [{"id": "i", "direction": "input", "portType": "list<", "required": true}], "outputs": []}], "edges": [], "loopScopes": [], "entryNodeId": null}', // invalid PortType string
    '{"nodes": [{"id": "a", "type": "tool", "config": null, "inputs": [{"id": "i", "direction": "input", "portType": "frobnicate", "required": true}], "outputs": []}], "edges": [], "loopScopes": [], "entryNodeId": null}', // unknown PortType name
    '{"nodes": [], "edges": [], "loopScopes": [], "entryNodeId": 5}', // entryNodeId wrong type
  );

  return fc.oneof(fc.string(), validJsonWrongShape, craftedDefects);
}

describe('Property 37: malformed input yields an error result, never a throw', () => {
  it('deserialize returns { ok: false } for malformed inputs and never throws', () => {
    fc.assert(
      fc.property(arbitraryMalformedInput(), (input) => {
        // Calling deserialize must never throw; any throw fails the property.
        const result = deserialize(input);
        return result.ok === false;
      }),
      { numRuns: 100 },
    );
  });
});
