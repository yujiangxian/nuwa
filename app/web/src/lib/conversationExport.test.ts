// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  FORMAT_VERSION,
  buildExportBundle,
  toMarkdown,
  parseImportBundle,
  type ExportedSession,
  type ParseResult,
} from '@/lib/conversationExport';
import type { ChatSession, ChatMessage } from '@/store/types';

/**
 * Export_Module property-based tests (Properties 1–8) plus boundary unit tests.
 *
 * All properties run >=100 iterations. These tests exercise the PURE Export_Module
 * functions only (no DOM / store / IndexedDB), validating Requirement 8.3.
 */

// ---------------------------------------------------------------------------
// Shared arbitraries — random sessions with CJK and special characters.
// ---------------------------------------------------------------------------

/** Text including CJK, emoji, punctuation, whitespace and markdown-ish chars. */
const richTextArb = fc.stringOf(
  fc.constantFrom(
    ...'abcXYZ012 \n\t你好世界哲学🙂#*_`-—【】、，。！？"\'\\/'.split(''),
  ),
  { maxLength: 24 },
);

const tokenArb = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
  { minLength: 1, maxLength: 6 },
);

const messageArb: fc.Arbitrary<ChatMessage> = fc.record({
  id: tokenArb,
  role: fc.constantFrom<'user' | 'assistant'>('user', 'assistant'),
  content: richTextArb,
});

const sessionMetaArb: fc.Arbitrary<ChatSession> = fc.record({
  id: tokenArb,
  title: richTextArb,
  characterId: tokenArb,
  voiceId: tokenArb,
  updatedAt: fc
    .date({ min: new Date('2020-01-01T00:00:00.000Z'), max: new Date('2030-01-01T00:00:00.000Z') })
    .map((d) => d.toISOString()),
  pinned: fc.boolean(),
});

const exportedSessionArb: fc.Arbitrary<ExportedSession> = fc.record({
  session: sessionMetaArb,
  messages: fc.array(messageArb, { maxLength: 6 }),
});

const sessionsArb = fc.array(exportedSessionArb, { maxLength: 5 });

// ---------------------------------------------------------------------------
// Property 2: Export_Bundle 顶层结构
// ---------------------------------------------------------------------------

describe('Export_Module buildExportBundle (Property 2)', () => {
  it('Property 2: Export_Bundle 顶层结构', () => {
    // Feature: conversation-export-import, Property 2: Export_Bundle 顶层结构
    // Validates: Requirements 1.3
    fc.assert(
      fc.property(sessionsArb, fc.date().map((d) => d.toISOString()), (sessions, exportedAt) => {
        const bundle = buildExportBundle(sessions, exportedAt);
        expect(bundle.formatVersion).toBe(FORMAT_VERSION);
        expect(bundle.exportedAt).toBe(exportedAt);
        expect(Array.isArray(bundle.sessions)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: Markdown 包含全部内容且按追加顺序
// ---------------------------------------------------------------------------

describe('Export_Module toMarkdown content & order (Property 3)', () => {
  it('Property 3: Markdown 包含全部内容且按追加顺序', () => {
    // Feature: conversation-export-import, Property 3: Markdown 包含全部内容且按追加顺序
    // Validates: Requirements 2.1, 2.2, 2.4
    const nameOf = (id: string) => `角色-${id}`;
    fc.assert(
      fc.property(sessionsArb, (sessions) => {
        const md = toMarkdown(sessions, nameOf);
        // Walk every expected piece (each session's title, then each message's
        // content in append order, sessions in input order) and require it to
        // appear at or after the running cursor — robust to duplicate text.
        let cursor = 0;
        for (const { session, messages } of sessions) {
          const tIdx = md.indexOf(session.title, cursor);
          expect(tIdx).toBeGreaterThanOrEqual(0);
          cursor = tIdx + session.title.length;
          for (const msg of messages) {
            const cIdx = md.indexOf(msg.content, cursor);
            expect(cIdx).toBeGreaterThanOrEqual(0);
            cursor = cIdx + msg.content.length;
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 1: JSON 导出—导入往返一致
// ---------------------------------------------------------------------------

describe('Export_Module JSON round-trip (Property 1)', () => {
  it('Property 1: JSON 导出—导入往返一致', () => {
    // Feature: conversation-export-import, Property 1: JSON 导出—导入往返一致
    // Validates: Requirements 1.1, 1.2, 1.4, 3.5, 3.6, 5.1, 5.2, 5.3
    fc.assert(
      fc.property(sessionsArb, fc.date().map((d) => d.toISOString()), (sessions, exportedAt) => {
        const text = JSON.stringify(buildExportBundle(sessions, exportedAt));
        const parsed = parseImportBundle(text);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        // Same number of session entries (Req 5.3).
        expect(parsed.sessions.length).toBe(sessions.length);
        sessions.forEach((orig, i) => {
          const got = parsed.sessions[i];
          // Session metadata round-trips (Req 5.2).
          expect(got.session.title).toBe(orig.session.title);
          expect(got.session.characterId).toBe(orig.session.characterId);
          expect(got.session.voiceId).toBe(orig.session.voiceId);
          // Messages round-trip on role + content, order preserved (Req 5.1).
          expect(got.messages.length).toBe(orig.messages.length);
          got.messages.forEach((m, j) => {
            expect(m.role).toBe(orig.messages[j].role);
            expect(m.content).toBe(orig.messages[j].content);
          });
        });
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Markdown 发送方显示名规则
// ---------------------------------------------------------------------------

describe('Export_Module toMarkdown sender names (Property 4)', () => {
  it('Property 4: Markdown 发送方显示名规则', () => {
    // Feature: conversation-export-import, Property 4: Markdown 发送方显示名规则
    // Validates: Requirements 2.3
    fc.assert(
      fc.property(
        sessionsArb,
        // A name map: present ids resolve to a name, absent ids -> undefined.
        fc.dictionary(tokenArb, tokenArb),
        (sessions, nameMap) => {
          const characterNameOf = (id: string): string | undefined => nameMap[id];
          const md = toMarkdown(sessions, characterNameOf);
          // Walk every expected sender header in order; user -> 「我」, assistant ->
          // characterNameOf(characterId) or 「助手」 when undefined.
          let cursor = 0;
          for (const { session, messages } of sessions) {
            for (const msg of messages) {
              const sender =
                msg.role === 'user'
                  ? '我'
                  : characterNameOf(session.characterId) ?? '助手';
              const header = `**${sender}：**`;
              const idx = md.indexOf(header, cursor);
              expect(idx).toBeGreaterThanOrEqual(0);
              cursor = idx + header.length;
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: Markdown 确定性输出
// ---------------------------------------------------------------------------

describe('Export_Module toMarkdown determinism (Property 5)', () => {
  it('Property 5: Markdown 确定性输出', () => {
    // Feature: conversation-export-import, Property 5: Markdown 确定性输出
    // Validates: Requirements 2.5
    fc.assert(
      fc.property(sessionsArb, fc.dictionary(tokenArb, tokenArb), (sessions, nameMap) => {
        const nameOf = (id: string): string | undefined => nameMap[id];
        const first = toMarkdown(sessions, nameOf);
        const second = toMarkdown(sessions, nameOf);
        // Char-by-char identical output for identical input (Req 2.5).
        expect(second).toBe(first);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Helper: assert a ParseResult is a failure of a given kind carrying no data.
// ---------------------------------------------------------------------------

function expectError(result: ParseResult, kind: 'syntax' | 'structure' | 'version'): void {
  expect(result.ok).toBe(false);
  if (result.ok) return; // narrows the union; unreachable after the assert above
  expect(result.error.kind).toBe(kind);
  // Failure branch carries no session data (the union has no `sessions` field).
  expect((result as { sessions?: unknown }).sessions).toBeUndefined();
}

// ---------------------------------------------------------------------------
// Property 6: 非法 JSON 返回语法错误且不产出数据
// ---------------------------------------------------------------------------

describe('Export_Module parseImportBundle syntax errors (Property 6)', () => {
  it('Property 6: 非法 JSON 返回语法错误且不产出数据', () => {
    // Feature: conversation-export-import, Property 6: 非法 JSON 返回语法错误且不产出数据
    // Validates: Requirements 3.2
    fc.assert(
      fc.property(
        fc.string().filter((s) => {
          try {
            JSON.parse(s);
            return false; // parseable -> not a syntax-error case
          } catch {
            return true;
          }
        }),
        (text) => {
          expectError(parseImportBundle(text), 'syntax');
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: 结构不符返回结构错误且不产出数据
// ---------------------------------------------------------------------------

describe('Export_Module parseImportBundle structure errors (Property 7)', () => {
  // Each branch yields a value that is valid JSON but violates Export_Bundle
  // structure, so parseImportBundle must classify it as 'structure'.
  const validSession = { title: 't', characterId: 'c', voiceId: 'v', updatedAt: 'u' };
  const structurallyInvalidArb = fc.oneof(
    // Top-level not an object.
    fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.array(fc.integer()), fc.string()),
    // Missing formatVersion.
    fc.constant({ sessions: [] }),
    // formatVersion not a string.
    fc.constant({ formatVersion: 1, sessions: [] }),
    // sessions not an array.
    fc.constant({ formatVersion: '1', sessions: 5 }),
    // Entry missing `messages`.
    fc.constant({ formatVersion: '1', sessions: [{ session: validSession }] }),
    // Entry missing `session`.
    fc.constant({ formatVersion: '1', sessions: [{ messages: [] }] }),
    // Message with an illegal role.
    fc.constant({ formatVersion: '1', sessions: [{ session: validSession, messages: [{ role: 'system', content: 'x' }] }] }),
    // Message content not a string.
    fc.constant({ formatVersion: '1', sessions: [{ session: validSession, messages: [{ role: 'user', content: 9 }] }] }),
    // Session field with wrong type.
    fc.constant({ formatVersion: '1', sessions: [{ session: { ...validSession, title: 5 }, messages: [] }] }),
  );

  it('Property 7: 结构不符返回结构错误且不产出数据', () => {
    // Feature: conversation-export-import, Property 7: 结构不符返回结构错误且不产出数据
    // Validates: Requirements 3.3
    fc.assert(
      fc.property(structurallyInvalidArb, (value) => {
        expectError(parseImportBundle(JSON.stringify(value)), 'structure');
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8: 版本不符返回版本错误且不产出数据
// ---------------------------------------------------------------------------

describe('Export_Module parseImportBundle version errors (Property 8)', () => {
  it('Property 8: 版本不符返回版本错误且不产出数据', () => {
    // Feature: conversation-export-import, Property 8: 版本不符返回版本错误且不产出数据
    // Validates: Requirements 3.4
    // Structurally valid bundle whose formatVersion is NOT in SUPPORTED_VERSIONS.
    const unsupportedVersionArb = fc.string().filter((v) => v !== FORMAT_VERSION);
    fc.assert(
      fc.property(unsupportedVersionArb, sessionsArb, (version, sessions) => {
        // Build a valid bundle then override formatVersion with an unsupported value.
        const bundle = buildExportBundle(sessions, '2025-01-01T00:00:00.000Z');
        const tampered = { ...bundle, formatVersion: version };
        expectError(parseImportBundle(JSON.stringify(tampered)), 'version');
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Task 1.12: Export_Module boundary unit tests
// ---------------------------------------------------------------------------

describe('Export_Module boundary cases', () => {
  it('round-trips an empty session list', () => {
    const text = JSON.stringify(buildExportBundle([], '2025-01-01T00:00:00.000Z'));
    const parsed = parseImportBundle(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.sessions).toEqual([]);
  });

  it('round-trips a session with no messages', () => {
    const entry: ExportedSession = {
      session: { id: 's1', title: '空会话', characterId: 'assistant', voiceId: 'jyy', updatedAt: '2025-01-01T00:00:00.000Z', pinned: false },
      messages: [],
    };
    const parsed = parseImportBundle(JSON.stringify(buildExportBundle([entry], '2025-01-01T00:00:00.000Z')));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.sessions.length).toBe(1);
      expect(parsed.sessions[0].messages).toEqual([]);
    }
  });

  it('preserves optional message fields (audioUrl/voiceName/duration) across round-trip', () => {
    const entry: ExportedSession = {
      session: { id: 's1', title: 't', characterId: 'assistant', voiceId: 'jyy', updatedAt: '2025-01-01T00:00:00.000Z', pinned: false },
      messages: [
        { id: 'm1', role: 'assistant', content: '你好', audioUrl: '/api/audio/x.wav', voiceName: '佳怡音色', duration: '0:05' },
      ],
    };
    const parsed = parseImportBundle(JSON.stringify(buildExportBundle([entry], '2025-01-01T00:00:00.000Z')));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const m = parsed.sessions[0].messages[0];
      expect(m.audioUrl).toBe('/api/audio/x.wav');
      expect(m.voiceName).toBe('佳怡音色');
      expect(m.duration).toBe('0:05');
    }
  });

  it('classifies an illegal message role as a structure error', () => {
    const bundle = {
      formatVersion: FORMAT_VERSION,
      exportedAt: '2025-01-01T00:00:00.000Z',
      sessions: [
        {
          session: { id: 's1', title: 't', characterId: 'assistant', voiceId: 'jyy', updatedAt: '2025-01-01T00:00:00.000Z' },
          messages: [{ id: 'm1', role: 'system', content: 'x' }],
        },
      ],
    };
    const parsed = parseImportBundle(JSON.stringify(bundle));
    expectError(parsed, 'structure');
  });
});

export { sessionsArb, exportedSessionArb, richTextArb, tokenArb };