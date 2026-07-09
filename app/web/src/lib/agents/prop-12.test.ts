// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-definition-registry, Property 12: validateRegistry 重复 id 检测
import { describe, it } from 'vitest';
import fc from 'fast-check';
import { validateRegistry } from './validate';
import { AgentErrorCode } from './types';
import { arbitraryDuplicateIdRegistryValues } from './arbitraries';

describe('Property 12: validateRegistry detects duplicate ids', () => {
  it('reports an AGENT_DUPLICATE_ID error locating the duplicated Agent_Id', () => {
    // **Validates: Requirements 11.3**
    fc.assert(
      fc.property(arbitraryDuplicateIdRegistryValues, (r) => {
        // Determine the id held by two or more entry values.
        const counts = new Map<string, number>();
        for (const a of r.agents.values()) {
          counts.set(a.id, (counts.get(a.id) ?? 0) + 1);
        }
        const duplicatedIds = [...counts.entries()]
          .filter(([, c]) => c >= 2)
          .map(([id]) => id);

        const { errors } = validateRegistry(r);
        return duplicatedIds.every((dupId) =>
          errors.some(
            (e) =>
              e.code === AgentErrorCode.AGENT_DUPLICATE_ID && e.location.agentId === dupId
          )
        );
      }),
      { numRuns: 100 }
    );
  });
});
