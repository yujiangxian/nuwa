// Feature: workflow-graph-model — example test for deserialize malformed input (R18.6)
import { describe, it, expect } from 'vitest';

import { deserialize } from './serialize';

describe('deserialize() on malformed input', () => {
  const malformed: ReadonlyArray<readonly [string, string]> = [
    ['empty string', ''],
    ['plain text', 'not json'],
    ['truncated object', '{'],
    ['scalar null', 'null'],
    ['scalar number', '42'],
    ['top-level array', '[]'],
    ['empty object (missing fields)', '{}'],
    ['nodes not an array', '{"nodes": "x", "edges": [], "loopScopes": [], "entryNodeId": null}'],
    ['missing entryNodeId', '{"nodes": [], "edges": [], "loopScopes": []}'],
    ['node missing fields', '{"nodes": [{}], "edges": [], "loopScopes": [], "entryNodeId": null}'],
    [
      'invalid node type',
      '{"nodes": [{"id": "a", "type": "bogus", "config": null, "inputs": [], "outputs": []}], "edges": [], "loopScopes": [], "entryNodeId": null}',
    ],
    [
      'invalid portType string',
      '{"nodes": [{"id": "a", "type": "tool", "config": null, "inputs": [{"id": "i", "direction": "input", "portType": "list<", "required": true}], "outputs": []}], "edges": [], "loopScopes": [], "entryNodeId": null}',
    ],
    ['entryNodeId wrong type', '{"nodes": [], "edges": [], "loopScopes": [], "entryNodeId": 7}'],
  ];

  for (const [label, input] of malformed) {
    it(`returns { ok: false } for ${label}`, () => {
      const result = deserialize(input);
      expect(result.ok).toBe(false);
    });
  }
});
