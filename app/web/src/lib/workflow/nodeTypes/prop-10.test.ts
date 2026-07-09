// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-node-types, Property 10: 错误结构良构（定位与描述）
//
// Property 10, Validates: Requirements 16.1, 16.5
//
// Every `ConfigError` produced by `validateNodeConfig` must be well-formed: its
// `location.nodeId` must equal the owning node's id and be non-empty (R16.1), and
// its `message` must be a non-empty string (R16.5). We exercise this over mutated
// nodes (which reliably produce errors) generated from valid base nodes.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { NODE_TYPES } from '../types';
import { validateNodeConfig } from './index';
import { arbitraryNodeOfType, arbitraryConfigMutation } from './arbitraries';

describe('Property 10: errors are well-formed (location + message)', () => {
  it('each error carries location.nodeId === node.id (non-empty) and a non-empty message', () => {
    fc.assert(
      fc.property(
        fc
          .constantFrom(...NODE_TYPES)
          .chain((t) => arbitraryNodeOfType(t))
          .chain((node) => arbitraryConfigMutation(node).map((m) => m.node)),
        (node) => {
          const result = validateNodeConfig(node);
          for (const e of result.errors) {
            expect(e.location.nodeId).toBe(node.id);
            expect(e.location.nodeId.length).toBeGreaterThan(0);
            expect(typeof e.message).toBe('string');
            expect(e.message.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
