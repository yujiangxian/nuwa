// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-system, Property 11: 校验结果 valid 当且仅当无错误且错误良构
/**
 * Property 11: valid iff errors empty, and errors are well-formed.
 *
 * For any ToolDefinition t, validateTool(t).valid === (errors.length === 0),
 * and every error has a non-empty message and an object location. For any
 * ToolRegistry r, validateRegistry(r).valid === (errors.length === 0).
 *
 * Validates: Requirements 9.7, 10.4, 11.6
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { validateTool, validateRegistry } from './validate';
import { arbitraryToolDefinition, arbitraryRegistry } from './arbitraries';

describe('Property 11: valid iff errors empty and errors well-formed', () => {
  it('validateTool: valid iff no errors, each error well-formed', () => {
    fc.assert(
      fc.property(arbitraryToolDefinition, (t) => {
        const result = validateTool(t);
        expect(result.valid).toBe(result.errors.length === 0);

        for (const err of result.errors) {
          expect(typeof err.message).toBe('string');
          expect(err.message.length).toBeGreaterThan(0);
          expect(typeof err.location).toBe('object');
          expect(err.location).not.toBeNull();
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });

  it('validateRegistry: valid iff no errors', () => {
    fc.assert(
      fc.property(arbitraryRegistry, (r) => {
        const result = validateRegistry(r);
        expect(result.valid).toBe(result.errors.length === 0);
        return true;
      }),
      { numRuns: 100 },
    );
  });
});
