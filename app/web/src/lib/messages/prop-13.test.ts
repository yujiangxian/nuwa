// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-message-protocol, Property 13: normalizeMessage 幂等与不动点

import { describe, it } from 'vitest';
import fc from 'fast-check';
import { normalizeMessage, messageEquals } from './normalize';
import { arbitraryMessage } from './arbitraries';

/**
 * Property 13: normalizeMessage 幂等与不动点
 *
 * 对任意 Message m，normalizeMessage(normalizeMessage(m)) 与 normalizeMessage(m)
 * messageEquals；即已规范形式经 normalizeMessage 不变（不动点）。
 *
 * **Validates: Requirements 10.3, 10.5**
 */
describe('Property 13: normalizeMessage idempotence & fixed point', () => {
  it('normalizing an already-normalized message yields an equal message', () => {
    fc.assert(
      fc.property(arbitraryMessage, (m) => {
        const once = normalizeMessage(m);
        const twice = normalizeMessage(once);
        if (!messageEquals(twice, once)) {
          throw new Error(
            `normalizeMessage is not idempotent:\nonce=${JSON.stringify(
              once,
            )}\ntwice=${JSON.stringify(twice)}`,
          );
        }
      }),
      { numRuns: 100 },
    );
  });
});
