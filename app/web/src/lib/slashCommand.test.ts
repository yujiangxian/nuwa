// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  isSlashActive,
  parseSlashQuery,
  buildSlashText,
  buildBuiltinCommands,
  buildPresetCommands,
  buildCommandCatalog,
  filterCommands,
  clampHighlightIndex,
  buildInsertedPresetText,
  EMPTY_HIGHLIGHT,
  type CommandItem,
} from '@/lib/slashCommand';
import type { PromptPreset } from '@/store/uiStore';

/**
 * Property-based tests for the pure slash-command logic in `lib/slashCommand.ts`.
 * Each property uses fast-check with at least 100 iterations and is labelled
 * with its design Property number and the requirements it validates.
 */

// A rich character pool mixing plain text, ASCII whitespace, the ideographic
// (full-width) space, multibyte CJK characters, an emoji and the slash so
// generated strings exercise empty / whitespace-only / newline / multibyte /
// leading-slash cases (mirrors the promptPreset.test.ts convention).
const richChar = fc.constantFrom(
  'a', 'B', '1', '/', ' ', '\t', '\n', '\r', '\u3000',
  '你', '好', '世', '界', '😀', 'é',
);
const anyText = fc.stringOf(richChar, { maxLength: 40 });
// Strings guaranteed to contain no newline (for the query round-trip property).
const noNewlineChar = fc.constantFrom(
  'a', 'B', '1', '/', ' ', '\t', '\u3000', '你', '好', '😀', 'é',
);
const noNewlineText = fc.stringOf(noNewlineChar, { maxLength: 40 });
// Active-state text: leading '/' + a newline-free remainder.
const activeText = noNewlineText.map((rest) => `/${rest}`);

const presetArb: fc.Arbitrary<PromptPreset> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 12 }),
  title: fc.stringOf(richChar, { maxLength: 20 }),
  content: fc.stringOf(richChar, { maxLength: 60 }),
});
const presetsArb = fc.array(presetArb, { maxLength: 12 });
const queryArb = fc.stringOf(richChar, { maxLength: 8 });

describe('isSlashActive', () => {
  it('Property 1: 斜杠检测精确性', () => {
    // Feature: chat-input-slash-commands, Property 1: isSlashActive(text) 为真当且仅当
    // text 首字符为 '/' 且不含 '\n'/'\r'
    // Validates: Requirements 1.1, 1.2, 1.3, 1.4, 6.2
    fc.assert(
      fc.property(anyText, (text) => {
        const expected =
          text.length > 0 &&
          text[0] === '/' &&
          !text.includes('\n') &&
          !text.includes('\r');
        expect(isSlashActive(text)).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });
});

describe('parseSlashQuery / buildSlashText', () => {
  it('Property 2: 查询解析往返一致性', () => {
    // Feature: chat-input-slash-commands, Property 2: parseSlashQuery 与 buildSlashText 互逆
    // Validates: Requirements 1.5, 1.6, 1.7, 6.3
    fc.assert(
      fc.property(noNewlineText, (q) => {
        // 由查询重建文本再解析，得回原查询。
        expect(parseSlashQuery(buildSlashText(q))).toBe(q);
      }),
      { numRuns: 100 },
    );
    fc.assert(
      fc.property(activeText, (text) => {
        // 激活态文本解析出查询再重建，得回原文本。
        const q = parseSlashQuery(text);
        expect(q).not.toBeNull();
        expect(buildSlashText(q as string)).toBe(text);
      }),
      { numRuns: 100 },
    );
  });

  it('单个 "/" 的 Slash_Query 为空串；非激活文本解析为 null', () => {
    expect(parseSlashQuery('/')).toBe('');
    expect(parseSlashQuery('')).toBeNull();
    expect(parseSlashQuery('hello')).toBeNull();
    expect(parseSlashQuery('/has\nnewline')).toBeNull();
  });
});

describe('filterCommands', () => {
  it('Property 3: 过滤为保序子集', () => {
    // Feature: chat-input-slash-commands, Property 3: filterCommands 返回 catalog 的保序子集，
    // 空 query 返回全量，长度不超过 catalog
    // Validates: Requirements 3.1, 3.2, 3.3, 3.5, 3.7, 6.4
    fc.assert(
      fc.property(presetsArb, queryArb, (presets, query) => {
        const catalog = buildCommandCatalog(presets);
        const result = filterCommands(catalog, query);

        // 长度不超过 catalog。
        expect(result.length).toBeLessThanOrEqual(catalog.length);

        // 每个结果项均来自 catalog（引用相等），且相对顺序与 catalog 一致：
        // 在 catalog 中查找结果项的下标序列应严格递增。
        let prevIdx = -1;
        for (const item of result) {
          const idx = catalog.indexOf(item);
          expect(idx).toBeGreaterThanOrEqual(0);
          expect(idx).toBeGreaterThan(prevIdx);
          prevIdx = idx;
        }

        // 空 query 返回全量（保序）。
        if (query.length === 0) {
          expect(result).toEqual(catalog);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('Property 4: 过滤幂等性', () => {
    // Feature: chat-input-slash-commands, Property 4: filterCommands(filterCommands(c,q),q) === filterCommands(c,q)
    // Validates: Requirements 3.4, 6.5
    fc.assert(
      fc.property(presetsArb, queryArb, (presets, query) => {
        const catalog = buildCommandCatalog(presets);
        const once = filterCommands(catalog, query);
        const twice = filterCommands(once, query);
        expect(twice).toEqual(once);
      }),
      { numRuns: 100 },
    );
  });

  it('无匹配 query 时返回空列表', () => {
    const catalog = buildCommandCatalog([]);
    // catalog 内不含的字符序列。
    expect(filterCommands(catalog, '\u0000zzz')).toEqual([]);
  });
});

describe('clampHighlightIndex', () => {
  it('Property 5: 高亮下标有界', () => {
    // Feature: chat-input-slash-commands, Property 5: clampHighlightIndex 在 length>0 时落在 [0,length-1]，
    // length===0 时返回 -1（覆盖越界/负数 index 的环绕，即 ArrowUp/Down 回绕）
    // Validates: Requirements 4.3, 4.4, 4.5, 6.6
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 1000 }),
        fc.nat({ max: 50 }),
        (index, length) => {
          const result = clampHighlightIndex(index, length);
          if (length > 0) {
            expect(result).toBeGreaterThanOrEqual(0);
            expect(result).toBeLessThanOrEqual(length - 1);
          } else {
            expect(result).toBe(EMPTY_HIGHLIGHT);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('ArrowDown/ArrowUp 回绕示例', () => {
    expect(clampHighlightIndex(3, 3)).toBe(0); // 越过末项回绕到首项
    expect(clampHighlightIndex(-1, 3)).toBe(2); // 越过首项回绕到末项
    expect(clampHighlightIndex(0, 0)).toBe(EMPTY_HIGHLIGHT);
  });
});

describe('command catalog construction', () => {
  it('内置命令固定为 clear/retry/presets 三条且顺序稳定（Req 2.1）', () => {
    const builtins = buildBuiltinCommands();
    expect(builtins.map((b) => b.commandKey)).toEqual(['clear', 'retry', 'presets']);
    expect(builtins.every((b) => b.kind === 'builtin')).toBe(true);
  });

  it('标题去空白为空的预设仍以 id 派生 commandKey 并出现在目录中（Req 2.6）', () => {
    const presets: PromptPreset[] = [
      { id: 'PX-9', title: '   ', content: 'hi' },
    ];
    const cmds = buildPresetCommands(presets);
    expect(cmds).toHaveLength(1);
    expect(cmds[0].commandKey).toBe('px-9');
    expect(cmds[0].presetId).toBe('PX-9');

    const catalog = buildCommandCatalog(presets);
    expect(catalog).toHaveLength(buildBuiltinCommands().length + 1);
    expect(catalog[catalog.length - 1].presetId).toBe('PX-9');
  });

  it('Command_Catalog 长度等于 builtin 数量 + presets 数量，preset 保序在后（Req 2.3, 2.4, 2.5）', () => {
    const presets: PromptPreset[] = [
      { id: 'a', title: 'Alpha', content: 'a' },
      { id: 'b', title: 'Beta', content: 'b' },
    ];
    const catalog = buildCommandCatalog(presets);
    const builtinCount = buildBuiltinCommands().length;
    expect(catalog).toHaveLength(builtinCount + 2);
    expect(catalog.slice(0, builtinCount).every((c) => c.kind === 'builtin')).toBe(true);
    expect(catalog.slice(builtinCount).map((c) => c.presetId)).toEqual(['a', 'b']);
  });
});

describe('buildInsertedPresetText', () => {
  it('返回传入的预设 content（Req 5.1）', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (content) => {
        expect(buildInsertedPresetText(content)).toBe(content);
      }),
      { numRuns: 100 },
    );
  });
});

// 类型层面确认 CommandItem 形状（编译期断言，运行期 no-op）。
const _typecheck: CommandItem = {
  kind: 'builtin',
  commandKey: 'clear',
  title: '/clear',
  description: '',
};
void _typecheck;
