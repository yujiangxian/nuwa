// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * Pure helpers for deriving chat session titles.
 *
 * These functions contain no DOM/store dependencies so they can be exercised
 * directly by property-based tests.
 */

/** Default title shown for a newly created session with no user messages yet. */
export const DEFAULT_TITLE = '新对话';

/** Maximum number of Unicode code points used for an auto-generated title. */
export const TITLE_MAX_LENGTH = 20;

/**
 * Derive a session title from the first user message content.
 *
 * Behaviour:
 * - Leading/trailing whitespace is trimmed.
 * - The string is truncated to `maxLen` Unicode code points (using
 *   `Array.from`, so multi-byte characters such as emoji or CJK are never
 *   split mid-character).
 * - If the trimmed content is empty, `DEFAULT_TITLE` is returned.
 *
 * The returned string always has at most `maxLen` code points.
 *
 * @param content first user message content
 * @param maxLen  maximum code-point length (defaults to {@link TITLE_MAX_LENGTH})
 */
export function deriveTitle(content: string, maxLen: number = TITLE_MAX_LENGTH): string {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return DEFAULT_TITLE;
  }
  // Split by Unicode code points so multi-byte characters stay intact.
  const codePoints = Array.from(trimmed);
  if (codePoints.length <= maxLen) {
    return trimmed;
  }
  return codePoints.slice(0, maxLen).join('');
}
