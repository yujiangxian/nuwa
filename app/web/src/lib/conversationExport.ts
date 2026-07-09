// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * Export_Module — pure logic for conversation export / import.
 *
 * This module has zero dependencies on the DOM, Chat_Store (Zustand) or
 * IndexedDB so it can be driven directly by fast-check property tests
 * (Requirement 8.3). All functions are pure: time/randomness are injected by
 * the caller (e.g. `exportedAt`), never read internally.
 */
import type { ChatSession, ChatMessage } from '@/store/types';

/** Current export format version (Format_Version). Fixed to "1" for this feature. */
export const FORMAT_VERSION = '1';

/** The set of Format_Versions that Export_Module is able to import (Supported_Version). */
export const SUPPORTED_VERSIONS: readonly string[] = ['1'];

/**
 * The export/import payload for a single conversation: session metadata plus
 * its messages in append order. This is the shared shape passed between
 * Export_Module and Chat_Store.
 */
export interface ExportedSession {
  session: ChatSession;
  messages: ChatMessage[];
}

/** Top-level structure of the exported JSON file (Export_Bundle). */
export interface ExportBundle {
  formatVersion: string;
  /** ISO 8601 timestamp; injected by the caller (keeps this a pure function). */
  exportedAt: string;
  sessions: ExportedSession[];
}

/** parseImportBundle error categories (Req 3.2–3.4 / 6.2–6.4). */
export type ImportErrorKind = 'syntax' | 'structure' | 'version';

/** Import failure result (Import_Error). */
export interface ImportError {
  kind: ImportErrorKind;
  /** User-facing Chinese message. */
  message: string;
}

/** parseImportBundle return type: a discriminated union carrying normalized sessions on success. */
export type ParseResult =
  | { ok: true; sessions: ExportedSession[] }
  | { ok: false; error: ImportError };

/**
 * Normalize a single message, keeping only `role` / `content` plus any present
 * optional fields (`audioUrl` / `voiceName` / `duration`) so JSON round-trips
 * losslessly without leaking unknown keys.
 */
function normalizeMessage(msg: ChatMessage): ChatMessage {
  const out: ChatMessage = { id: msg.id, role: msg.role, content: msg.content };
  if (typeof msg.audioUrl === 'string') out.audioUrl = msg.audioUrl;
  if (typeof msg.voiceName === 'string') out.voiceName = msg.voiceName;
  if (typeof msg.duration === 'string') out.duration = msg.duration;
  return out;
}

/**
 * Normalize a single session's metadata, keeping the documented fields
 * (`id` / `title` / `characterId` / `voiceId` / `updatedAt`). The original `id`
 * is retained in the bundle for reference but is ignored on import (Chat_Store
 * reassigns a fresh, unique id).
 */
function normalizeSession(session: ChatSession): ChatSession {
  return {
    id: session.id,
    title: session.title,
    characterId: session.characterId,
    voiceId: session.voiceId,
    updatedAt: session.updatedAt,
    pinned: session.pinned === true,
  };
}

/**
 * Build an Export_Bundle (the step before `JSON.stringify`, returns the object
 * so the caller can serialize it).
 *
 * Pure function: `exportedAt` is injected by the caller rather than read from
 * `Date.now()`, so identical input produces identical output (testable). Session
 * order and message order are preserved as-is (Req 1.2, 1.4). Each ExportedSession
 * keeps only the documented fields (title/characterId/voiceId/updatedAt and each
 * message's role/content; the optional fields audioUrl/voiceName/duration pass
 * through to support lossless round-trips).
 *
 * @param sessions  sessions to export (length 1 for single-session export)
 * @param exportedAt ISO 8601 timestamp
 */
export function buildExportBundle(
  sessions: ExportedSession[],
  exportedAt: string,
): ExportBundle {
  return {
    formatVersion: FORMAT_VERSION,
    exportedAt,
    sessions: sessions.map((entry) => ({
      session: normalizeSession(entry.session),
      messages: entry.messages.map(normalizeMessage),
    })),
  };
}

/** Display name for user messages in Markdown export. */
const USER_DISPLAY_NAME = '我';
/** Fallback display name for assistant messages whose character is unknown. */
const ASSISTANT_FALLBACK_NAME = '助手';

/**
 * Render a list of sessions into deterministic Markdown text (Markdown_Export).
 *
 * - Each session is rendered with its `title` as a heading section;
 * - Each message renders "sender display name + content"; user messages use
 *   「我」, assistant messages use `characterNameOf(characterId)` (falling back
 *   to 「助手」 when it returns `undefined`, Req 2.3);
 * - Messages are laid out in array order (= append order, Req 2.4);
 * - Output is deterministic for identical input (Req 2.5): no clock/random
 *   sources are read and the line separators are fixed.
 *
 * @param sessions        sessions to export
 * @param characterNameOf injected character-name resolver (characterId → name | undefined)
 */
export function toMarkdown(
  sessions: ExportedSession[],
  characterNameOf: (characterId: string) => string | undefined,
): string {
  const blocks: string[] = [];
  for (const { session, messages } of sessions) {
    const lines: string[] = [];
    // Session heading.
    lines.push(`# ${session.title}`);
    lines.push('');
    for (const msg of messages) {
      const sender =
        msg.role === 'user'
          ? USER_DISPLAY_NAME
          : characterNameOf(session.characterId) ?? ASSISTANT_FALLBACK_NAME;
      // Sender on its own bolded line, then the verbatim content, then a blank line.
      lines.push(`**${sender}：**`);
      lines.push(msg.content);
      lines.push('');
    }
    blocks.push(lines.join('\n'));
  }
  // Sessions are separated by a horizontal rule; trailing newline kept fixed.
  return blocks.join('\n---\n\n');
}

/** Error messages surfaced to the user for each Import_Error category. */
const ERROR_MESSAGES: Record<ImportErrorKind, string> = {
  syntax: '文件格式无法解析',
  structure: '文件内容结构不正确',
  version: '文件版本不受支持',
};

function importError(kind: ImportErrorKind): ParseResult {
  return { ok: false, error: { kind, message: ERROR_MESSAGES[kind] } };
}

/** True for a plain object (not null, not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate + normalize a single raw message. Returns the normalized ChatMessage
 * or `null` when the message is structurally invalid (Req 3.3).
 */
function parseMessage(raw: unknown): ChatMessage | null {
  if (!isRecord(raw)) return null;
  const { role, content } = raw;
  if (role !== 'user' && role !== 'assistant') return null;
  if (typeof content !== 'string') return null;
  const out: ChatMessage = {
    id: typeof raw.id === 'string' ? raw.id : '',
    role,
    content,
  };
  if (typeof raw.audioUrl === 'string') out.audioUrl = raw.audioUrl;
  if (typeof raw.voiceName === 'string') out.voiceName = raw.voiceName;
  if (typeof raw.duration === 'string') out.duration = raw.duration;
  return out;
}

/**
 * Validate + normalize a single raw exported-session entry. Returns the
 * normalized ExportedSession or `null` when invalid (Req 3.3).
 */
function parseEntry(raw: unknown): ExportedSession | null {
  if (!isRecord(raw)) return null;
  const { session, messages } = raw;
  if (!isRecord(session)) return null;
  if (!Array.isArray(messages)) return null;
  // Session metadata fields must be strings (buildExportBundle always emits
  // them as strings; updatedAt may be missing -> '' so Chat_Store can fall back).
  if (typeof session.title !== 'string') return null;
  if (typeof session.characterId !== 'string') return null;
  if (typeof session.voiceId !== 'string') return null;
  if (session.updatedAt !== undefined && typeof session.updatedAt !== 'string') return null;

  const parsedMessages: ChatMessage[] = [];
  for (const m of messages) {
    const parsed = parseMessage(m);
    if (parsed === null) return null;
    parsedMessages.push(parsed);
  }

  const normalizedSession: ChatSession = {
    id: typeof session.id === 'string' ? session.id : '',
    title: session.title,
    characterId: session.characterId,
    voiceId: session.voiceId,
    updatedAt: typeof session.updatedAt === 'string' ? session.updatedAt : '',
    pinned: session.pinned === true,
  };
  return { session: normalizedSession, messages: parsedMessages };
}

/**
 * Parse and validate a piece of file text (the pure-logic part of JSON_Import).
 *
 * Order (fixed): syntax → structure → version.
 * 1. JSON.parse — on failure returns `{ ok:false, error.kind:'syntax' }` (Req 3.2).
 * 2. Structure — top-level must be an object with a string `formatVersion` and
 *    an array `sessions`, where each entry has an object `session` and an array
 *    `messages` with valid field types; otherwise `'structure'` (Req 3.3).
 * 3. Version — `formatVersion ∉ SUPPORTED_VERSIONS` → `'version'` (Req 3.4).
 * 4. Normalize — on success produces a normalized ExportedSession[] (Req 3.5),
 *    preserving order.
 *
 * Failure branches never carry any session data (Req 6.1).
 */
export function parseImportBundle(text: string): ParseResult {
  // 1. Syntax.
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return importError('syntax');
  }

  // 2. Structure.
  if (!isRecord(parsed)) return importError('structure');
  if (typeof parsed.formatVersion !== 'string') return importError('structure');
  if (!Array.isArray(parsed.sessions)) return importError('structure');

  const normalized: ExportedSession[] = [];
  for (const entry of parsed.sessions) {
    const parsedEntry = parseEntry(entry);
    if (parsedEntry === null) return importError('structure');
    normalized.push(parsedEntry);
  }

  // 3. Version (checked after structure so formatVersion is known to be a string).
  if (!SUPPORTED_VERSIONS.includes(parsed.formatVersion)) return importError('version');

  // 4. Success.
  return { ok: true, sessions: normalized };
}
