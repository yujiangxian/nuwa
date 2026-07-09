// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-conversation-assembly
/**
 * Custom fast-check arbitraries (generators) for the agent-conversation-assembly
 * layer. These power the layer's property tests (prop-01..14).
 *
 * The generators reuse the prior layers' constrained shapes:
 *   - `arbitraryValidAgentDefinition` (agents layer) for legal agents whose
 *     systemPrompt is well within SYSTEM_PROMPT_MAX_LENGTH.
 *   - `arbitraryTranscript` (messages layer) for transcripts guaranteed to pass
 *     `validateTranscript`.
 *
 * This module is test-support code only: pure arbitrary definitions built on
 * `fast-check`, with no production logic, no I/O, no React and no mutable state.
 */

import fc from 'fast-check';
import type { AgentDefinition } from '../agents/types';
import type { Transcript } from '../messages/types';
import type { AssemblyOptions } from './types';
import { SYSTEM_PROMPT_MAX_LENGTH } from '../agents/types';
import { arbitraryValidAgentDefinition } from '../agents/arbitraries';

// —— Agents ——

/** A legal agent definition whose systemPrompt is short (within bound). */
export const arbitraryAgent: fc.Arbitrary<AgentDefinition> = arbitraryValidAgentDefinition;

/**
 * A legal agent whose systemPrompt exceeds SYSTEM_PROMPT_MAX_LENGTH. Built by
 * overwriting a valid base agent's systemPrompt with a string padded to
 * length+1 so it is guaranteed over the legal upper bound.
 */
export const arbitraryLongPromptAgent: fc.Arbitrary<AgentDefinition> =
  arbitraryValidAgentDefinition.map((agent) => ({
    ...agent,
    systemPrompt: 'x'.repeat(SYSTEM_PROMPT_MAX_LENGTH + 1),
  }));

// —— Transcripts ——

/** A transcript guaranteed to pass `validateTranscript` (reused from messages). */
export { arbitraryTranscript } from '../messages/arbitraries';

// —— Assembly options ——

/** A legal Max_Messages value: integer in [1, 20]. */
export const arbitraryMaxMessages: fc.Arbitrary<number> = fc.integer({ min: 1, max: 20 });

/**
 * Assembly options spanning: absent maxMessages (no truncation), a legal
 * maxMessages (>= 1 integer), and out-of-range maxMessages (0, -1, 1.5) that
 * `validateAssembly` must reject.
 */
export const arbitraryAssemblyOptions: fc.Arbitrary<AssemblyOptions> = fc.oneof(
  fc.constant<AssemblyOptions>({}),
  arbitraryMaxMessages.map((maxMessages) => ({ maxMessages })),
  fc.constantFrom(0, -1, 1.5).map((maxMessages) => ({ maxMessages })),
);

// Re-export the transcript type alias usage is satisfied via the type import above.
export type { Transcript };
