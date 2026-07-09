// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-system, Example: 空注册表的 size/listTools/getTool 行为
/**
 * Example & boundary test (R4.2, R8.1): an empty registry has size 0, an empty
 * listing, and getTool returns undefined for any id (never throws).
 */

import { describe, it, expect } from 'vitest';
import { emptyRegistry, size, listTools, getTool } from './registry';

describe('Example: empty registry', () => {
  it('size of an empty registry is 0', () => {
    expect(size(emptyRegistry())).toBe(0);
  });

  it('listTools of an empty registry is empty', () => {
    expect(listTools(emptyRegistry())).toEqual([]);
  });

  it('getTool on an empty registry returns undefined', () => {
    expect(getTool(emptyRegistry(), 'x')).toBeUndefined();
  });
});
