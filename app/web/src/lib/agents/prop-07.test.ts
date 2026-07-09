// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-definition-registry, Property 7: getAgent 命中与未命中
import { describe, it } from 'vitest';
import fc from 'fast-check';
import { getAgent } from './registry';
import { arbitraryRegistry } from './arbitraries';

describe('Property 7: getAgent hit and miss', () => {
  it('returns the matching definition for present ids and undefined for absent ids', () => {
    // **Validates: Requirements 9.1**
    fc.assert(
      fc.property(arbitraryRegistry, (r) => {
        // Hit: for every key id in r, getAgent returns a definition whose id === id.
        for (const id of r.agents.keys()) {
          const found = getAgent(r, id);
          if (found === undefined) return false;
          if (found.id !== id) return false;
        }
        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('returns undefined (never throws) for ids that are not in the registry', () => {
    // **Validates: Requirements 9.1**
    fc.assert(
      fc.property(
        arbitraryRegistry,
        fc.string(),
        (r, candidate) => {
          // Constrain the candidate id to one that is genuinely absent from r.
          if (r.agents.has(candidate)) return true;
          return getAgent(r, candidate) === undefined;
        }
      ),
      { numRuns: 100 }
    );
  });
});
