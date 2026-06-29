// Feature: agent-message-protocol, Example: cross-layer error code disjointness

import { describe, it, expect } from 'vitest';
import { MessageErrorCode } from './types';
import { ErrorCode } from '../workflow/types';
import { ConfigErrorCode } from '../workflow/nodeTypes/configTypes';
import { ExecutorErrorCode } from '../workflow/engine/types';
import { AgentErrorCode } from '../agents/types';
import { ToolErrorCode } from '../tools/types';
import { ResolutionErrorCode } from '../resolution/types';

/**
 * Example test confirming the MessageErrorCode value set is disjoint from each
 * of the six prior-layer error-code enums (R9.2–R9.7). Uses concrete `it`
 * assertions rather than property generation.
 */
describe('Example: MessageErrorCode is disjoint from the six prior layers', () => {
  const messageValues = new Set<string>(Object.values(MessageErrorCode));

  const otherLayers: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['ErrorCode', Object.values(ErrorCode)],
    ['ConfigErrorCode', Object.values(ConfigErrorCode)],
    ['ExecutorErrorCode', Object.values(ExecutorErrorCode)],
    ['AgentErrorCode', Object.values(AgentErrorCode)],
    ['ToolErrorCode', Object.values(ToolErrorCode)],
    ['ResolutionErrorCode', Object.values(ResolutionErrorCode)],
  ];

  for (const [name, values] of otherLayers) {
    it(`shares no value with ${name}`, () => {
      const intersection = values.filter((v) => messageValues.has(v));
      expect(intersection).toEqual([]);
    });
  }
});
