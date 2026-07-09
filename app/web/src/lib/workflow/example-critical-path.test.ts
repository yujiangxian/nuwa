// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-graph-model — example test for criticalPath single node (R16.4)
import { describe, it, expect } from 'vitest';

import { criticalPath } from './analyze';
import type { WorkflowGraph, WorkflowNode } from './types';

describe('criticalPath() with only the entry node', () => {
  it('returns a path containing exactly the entry node', () => {
    const entry: WorkflowNode = {
      id: 'entry',
      type: 'tool',
      config: null,
      inputs: [],
      outputs: [],
    };
    const g: WorkflowGraph = {
      nodes: [entry],
      edges: [],
      loopScopes: [],
      entryNodeId: 'entry',
    };
    expect(criticalPath(g)).toEqual(['entry']);
  });
});
