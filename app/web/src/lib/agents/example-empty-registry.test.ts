// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-definition-registry, Example: 空注册表的查询行为
import { describe, it, expect } from 'vitest';
import { emptyRegistry, size, listAgents, getAgent } from './registry';

describe('example: empty registry', () => {
  it('has size 0', () => {
    expect(size(emptyRegistry())).toBe(0);
  });

  it('lists no agents', () => {
    const agents = listAgents(emptyRegistry());
    expect(agents).toEqual([]);
    expect(agents.length).toBe(0);
  });

  it('returns undefined for any id', () => {
    expect(getAgent(emptyRegistry(), 'anything')).toBeUndefined();
  });
});
