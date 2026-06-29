// Feature: agent-tool-system, Property 13: 注册表合法蕴含逐项合法
/**
 * Property 13: a valid registry implies each tool is individually valid.
 *
 * For any r making validateRegistry(r).valid true, every definition returned by
 * listTools(r) is itself valid under validateTool.
 *
 * Validates: Requirements 10.2, 10.6
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { listTools } from './registry';
import { validateTool, validateRegistry } from './validate';
import { arbitraryRegistry } from './arbitraries';

describe('Property 13: a valid registry implies each tool is individually valid', () => {
  it('every listed tool of a valid registry is itself valid', () => {
    fc.assert(
      fc.property(arbitraryRegistry, (r) => {
        fc.pre(validateRegistry(r).valid);
        for (const tool of listTools(r)) {
          expect(validateTool(tool).valid).toBe(true);
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });
});
