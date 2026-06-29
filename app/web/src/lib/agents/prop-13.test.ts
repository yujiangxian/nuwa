// Feature: agent-definition-registry, Property 13: 注册表合法蕴含逐项合法
import { describe, it } from 'vitest';
import fc from 'fast-check';
import { validateAgent, validateRegistry } from './validate';
import { listAgents } from './registry';
import { arbitraryRegistry } from './arbitraries';

describe('Property 13: a valid registry implies every entry is individually valid', () => {
  it('when validateRegistry(r).valid holds, every listAgents(r) entry is itself valid', () => {
    // **Validates: Requirements 11.2, 11.6**
    fc.assert(
      fc.property(arbitraryRegistry, (r) => {
        // arbitraryRegistry is built from valid agents, so it should always be valid.
        fc.pre(validateRegistry(r).valid);
        return listAgents(r).every((a) => validateAgent(a).valid === true);
      }),
      { numRuns: 100 }
    );
  });
});
