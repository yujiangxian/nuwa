// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-system, Property 7: getTool 命中与未命中
/**
 * Property 7: getTool hit and miss.
 *
 * For any ToolRegistry r: for every stored key id, getTool(r, id)!.id === id;
 * for any id not in r, getTool returns undefined (never throws).
 *
 * Validates: Requirements 8.1
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { getTool } from './registry';
import { arbitraryRegistry } from './arbitraries';

describe('Property 7: getTool hit and miss', () => {
  it('returns the matching tool for stored keys and undefined for absent ids', () => {
    fc.assert(
      fc.property(arbitraryRegistry, (r) => {
        // Hit: every stored key resolves to a tool whose id equals the key.
        for (const id of r.tools.keys()) {
          const tool = getTool(r, id);
          expect(tool).toBeDefined();
          expect(tool!.id).toBe(id);
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });

  it('returns undefined for ids not present in the registry', () => {
    fc.assert(
      fc.property(
        arbitraryRegistry,
        fc.string(),
        (r, candidate) => {
          fc.pre(!r.tools.has(candidate));
          expect(getTool(r, candidate)).toBeUndefined();
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});
