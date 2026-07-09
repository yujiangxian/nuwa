// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-graph-model — example test for emptyGraph() (R1.6)
import { describe, it, expect } from 'vitest';

import { emptyGraph } from './graph';

describe('emptyGraph()', () => {
  it('has empty nodes/edges/loopScopes and a null entryNodeId', () => {
    const g = emptyGraph();
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
    expect(g.loopScopes).toEqual([]);
    expect(g.entryNodeId).toBeNull();
  });
});
