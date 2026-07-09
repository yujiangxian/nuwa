// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-definition-registry, Property 11: 校验结果 valid 当且仅当无错误且错误良构
import { describe, it } from 'vitest';
import fc from 'fast-check';
import { validateAgent, validateRegistry } from './validate';
import { arbitraryAgentDefinition, arbitraryRegistry } from './arbitraries';

describe('Property 11: valid iff no errors, and errors are well-formed', () => {
  it('validateAgent: valid === (errors empty); every error has a non-empty message and an object location', () => {
    // **Validates: Requirements 10.9, 11.4, 12.5**
    fc.assert(
      fc.property(arbitraryAgentDefinition, (a) => {
        const { valid, errors } = validateAgent(a);
        if (valid !== (errors.length === 0)) return false;
        for (const e of errors) {
          if (typeof e.message !== 'string' || e.message.length === 0) return false;
          if (typeof e.location !== 'object' || e.location === null) return false;
        }
        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('validateRegistry: valid === (errors empty); every error is well-formed', () => {
    // **Validates: Requirements 10.9, 11.4, 12.5**
    fc.assert(
      fc.property(arbitraryRegistry, (r) => {
        const { valid, errors } = validateRegistry(r);
        if (valid !== (errors.length === 0)) return false;
        for (const e of errors) {
          if (typeof e.message !== 'string' || e.message.length === 0) return false;
          if (typeof e.location !== 'object' || e.location === null) return false;
        }
        return true;
      }),
      { numRuns: 100 }
    );
  });
});
