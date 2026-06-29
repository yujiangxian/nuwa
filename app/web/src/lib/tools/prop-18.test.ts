// Feature: agent-tool-system, Property 18: 反序列化拒斥畸形输入
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

import { deserializeRegistry } from './serialize';
import { ToolErrorCode } from './types';
import { arbitraryMalformedRegistryJson } from './arbitraries';

/**
 * Validates: Requirements 13.6
 *
 * For any string s that does not conform to the Registry_Json structure,
 * deserializeRegistry(s) fails with code TOOL_MALFORMED_JSON, never throws and
 * never partially constructs a registry (no `registry` field on failure).
 */
describe('Property 18: 反序列化拒斥畸形输入', () => {
  it('rejects malformed input with TOOL_MALFORMED_JSON and no partial registry', () => {
    fc.assert(
      fc.property(arbitraryMalformedRegistryJson, (s) => {
        expect(() => deserializeRegistry(s)).not.toThrow();

        const result = deserializeRegistry(s);
        expect(result.ok).toBe(false);
        if (result.ok) return;

        expect(result.error.code).toBe(ToolErrorCode.TOOL_MALFORMED_JSON);
        // No partial construction: failure result carries no registry field.
        expect('registry' in result).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
