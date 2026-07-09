// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-node-types — example test for TypedNodeConfig exhaustiveness (R1.1)

import { describe, it, expect } from 'vitest';

import { NODE_TYPES, type NodeType } from '../types';
import { defaultConfig, type TypedNodeConfig } from './index';

/**
 * R1.1: `TypedNodeConfig` is a discriminated union with exactly one branch per
 * `NodeType`, and every branch's `kind` discriminator equals its `NodeType`.
 *
 * This example test walks all six `NodeType`s, builds the default config for
 * each, and asserts the discriminator matches. A `switch` over `config.kind`
 * with a `never` exhaustiveness guard fails to compile if a branch is ever
 * dropped, so the union stays exhaustive at the type level too.
 */
describe('TypedNodeConfig union exhaustiveness (R1.1)', () => {
  it('exposes exactly the six known node types', () => {
    expect([...NODE_TYPES].sort()).toEqual(
      ['condition', 'human_input', 'llm', 'loop', 'tool', 'transform'].sort(),
    );
  });

  it('defaultConfig(t).config.kind === t for every NodeType', () => {
    for (const t of NODE_TYPES) {
      expect(defaultConfig(t).config.kind).toBe(t);
    }
  });

  it('covers all six branches in an exhaustive switch (compile-time guard)', () => {
    // Visiting every NodeType through a switch with a `never` default proves the
    // union is exhaustive: omitting a branch would be a type error.
    const visited: NodeType[] = [];
    for (const t of NODE_TYPES) {
      const config: TypedNodeConfig = defaultConfig(t).config;
      switch (config.kind) {
        case 'llm':
        case 'condition':
        case 'tool':
        case 'transform':
        case 'human_input':
        case 'loop':
          visited.push(config.kind);
          break;
        default: {
          const _exhaustive: never = config;
          void _exhaustive;
        }
      }
    }
    expect([...visited].sort()).toEqual([...NODE_TYPES].sort());
  });
});
