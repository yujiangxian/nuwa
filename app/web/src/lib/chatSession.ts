// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * Pure helpers for selecting and presenting chat sessions.
 *
 * `pickLatestSession` is store/DOM independent so it can be exercised by
 * property-based tests; `formatRelativeTime` is a display helper used by the UI.
 */
import type { ChatSession } from '@/store/types';

/**
 * Select the session with the most recent `updatedAt`.
 *
 * `updatedAt` is an ISO 8601 timestamp string; for valid ISO timestamps
 * lexicographic ordering matches chronological ordering, so a string compare
 * is sufficient. Returns `null` for an empty collection.
 *
 * The returned session is always a member of the input collection.
 *
 * @param sessions candidate sessions
 */
export function pickLatestSession(sessions: ChatSession[]): ChatSession | null {
  let latest: ChatSession | null = null;
  for (const session of sessions) {
    if (latest === null || session.updatedAt > latest.updatedAt) {
      latest = session;
    }
  }
  return latest;
}

/**
 * Format an ISO 8601 timestamp into a human-friendly relative time string.
 *
 * - within 1 minute  -> "刚刚"
 * - within 1 hour     -> "N 分钟前"
 * - within 24 hours   -> "N 小时前"
 * - previous calendar day -> "昨天"
 * - otherwise         -> a localized date such as "2024/1/2"
 *
 * Invalid timestamps are returned unchanged.
 */
export function formatRelativeTime(iso: string): string {
  const then = new Date(iso);
  const ts = then.getTime();
  if (Number.isNaN(ts)) {
    return iso;
  }

  const now = new Date();
  const diffMs = now.getTime() - ts;
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) {
    return '刚刚';
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} 分钟前`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} 小时前`;
  }

  // Compare by calendar day to decide "昨天" vs. an absolute date.
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
  if (dayDiff === 1) {
    return '昨天';
  }

  return then.toLocaleDateString();
}
