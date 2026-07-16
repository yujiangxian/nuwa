// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * API base URL helpers — pure functions (no axios / store imports).
 * Empty base ⇒ same-origin / Vite proxy relative paths.
 */

/** Trim + strip trailing slashes. Empty input stays empty. */
export function normalizeApiBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/**
 * Join API base with a path starting with `/`.
 * When base is empty, returns the path unchanged (relative).
 */
export function joinApiUrl(base: string, path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  const b = normalizeApiBaseUrl(base);
  return b ? `${b}${p}` : p;
}
