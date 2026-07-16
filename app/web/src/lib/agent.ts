// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * Pure helpers for Agent definitions (persona + local pipeline binding).
 */
import type { Agent } from '@/store/types';
import { validateName, type NameValidation, NAME_MAX_LENGTH } from '@/lib/character';

export { validateName, NAME_MAX_LENGTH };
export type { NameValidation };

export function generateAgentId(existing: Agent[]): string {
  const taken = new Set(existing.map((a) => a.id));
  let id = '';
  do {
    id = `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  } while (taken.has(id));
  return id;
}

export function needsAgentSeeding(stored: Agent[]): boolean {
  return stored.length === 0;
}

export function pickNextAgentId(
  agents: Agent[],
  removedId: string,
  currentId: string,
): string | null {
  const remaining = agents.filter((a) => a.id !== removedId);
  if (remaining.length === 0) return null;
  if (currentId !== removedId && remaining.some((a) => a.id === currentId)) {
    return currentId;
  }
  return remaining[0].id;
}
