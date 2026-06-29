// Feature: agent-tool-system, Property 20: validateArguments 合法齐备时通过且非必需缺失不报错
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

import { validateArguments } from './validate';
import type { ArgumentMap } from './types';
import type { PortType } from '../workflow/types';
import { arbitraryValidToolDefinition } from './arbitraries';

/**
 * Validates: Requirements 14.5, 14.7
 *
 * For any valid tool and an argument map that contains exactly its required
 * parameters (each typed identically to its declared parameter type) and no
 * unknown keys, validateArguments returns valid with an empty error list.
 * Omitting non-required parameters produces no error.
 */
describe('Property 20: validateArguments 合法齐备时通过且非必需缺失不报错', () => {
  it('a complete, well-typed required-only argument map passes with no errors', () => {
    fc.assert(
      fc.property(arbitraryValidToolDefinition, (t) => {
        // Build a map of exactly the required parameters, each with its
        // declared type; non-required parameters are deliberately omitted.
        const entries: ReadonlyArray<readonly [string, PortType]> = t.parameters
          .filter((p) => p.required)
          .map((p) => [p.name, p.type] as const);
        const argumentMap = new Map<string, PortType>(entries) as ArgumentMap;

        const res = validateArguments(t, argumentMap);

        expect(res.valid).toBe(true);
        expect(res.errors).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
