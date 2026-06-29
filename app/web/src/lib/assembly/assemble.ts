// Feature: agent-conversation-assembly
//
// Deterministic, pure assembly functions: derive the system message from an
// agent, truncate history most-recent-first, and assemble the effective
// message sequence. No I/O, no mutation of inputs, same input => same output.

import type { AgentDefinition } from '../agents/types';
import type { Message, Transcript } from '../messages/types';
import type { AssemblyOptions } from './types';
import { SYSTEM_MESSAGE_ID_PREFIX } from './types';

/**
 * Derive the system message from an agent (R2): role 'system', a single text
 * part equal to systemPrompt, id = SYSTEM_MESSAGE_ID_PREFIX + agent.id.
 */
export function systemMessageOf(agent: AgentDefinition): Message {
  return {
    id: SYSTEM_MESSAGE_ID_PREFIX + agent.id,
    role: 'system',
    parts: [{ kind: 'text', text: agent.systemPrompt }],
  };
}

/**
 * Most-recent-first truncation (R5): return the trailing maxMessages messages
 * (a suffix of the original list); length is min(len, max).
 */
export function truncateHistory(
  messages: readonly Message[],
  maxMessages: number,
): readonly Message[] {
  if (messages.length <= maxMessages) {
    return [...messages]; // no truncation (R5.2)
  }
  return messages.slice(messages.length - maxMessages); // keep trailing maxMessages (R5.3)
}

/**
 * Assemble the effective message sequence (R4, R8): system message first,
 * followed by history truncated to Max_Messages when provided.
 */
export function assembleMessages(
  agent: AgentDefinition,
  transcript: Transcript,
  options?: AssemblyOptions,
): readonly Message[] {
  const system = systemMessageOf(agent);
  if (options?.maxMessages === undefined) {
    return [system, ...transcript.messages]; // no truncation (R4.3)
  }
  const max = options.maxMessages;
  if (max <= 1) {
    return [system]; // limit of 1 keeps only the system message (R8.4)
  }
  return [system, ...truncateHistory(transcript.messages, max - 1)]; // total = min(1+historyLen, max)
}
