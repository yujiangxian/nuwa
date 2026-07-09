// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  isSubsequenceMatch,
  filterCommands,
  clampHighlight,
  moveHighlightIndex,
  type CommandItem,
  type CommandGroup,
} from './commandPalette';

const GROUPS: CommandGroup[] = ['navigation', 'settings', 'appearance', 'session'];

/** 生成随机 CommandItem。 */
const commandItemArb = fc.record({
  id: fc.string(),
  title: fc.string(),
  subtitle: fc.option(fc.string(), { nil: undefined }),
  keywords: fc.array(fc.string(), { maxLength: 4 }),
  group: fc.constantFrom(...GROUPS),
  run: fc.constant(() => {}),
}) as fc.Arbitrary<CommandItem>;

/** 从一段文本中随机采样一个子序列（提升命中率）。 */
function sampleSubsequence(text: string, picks: boolean[]): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    if (picks[i]) out += text[i];
  }
  return out;
}

describe('filterCommands — 属性测试', () => {
  // Feature: command-palette, Property 1: Command_Filter 契约（保序子集选择 + 匹配语义 + 幂等 + 纯性）
  it('Property 1: 保序子集 + 空查询全量 + 匹配语义 + 幂等 + 纯性', () => {
    const itemsArb = fc.array(commandItemArb, { maxLength: 12 });
    // query：含空串、随机串、以及从某项 title/keyword 采样的子序列。
    const queryArb = fc.oneof(
      fc.constant(''),
      fc.string(),
      fc.tuple(fc.string(), fc.array(fc.boolean(), { maxLength: 20 })).map(([s, picks]) =>
        sampleSubsequence(s, picks),
      ),
    );

    fc.assert(
      fc.property(itemsArb, queryArb, (items, query) => {
        const snapshot = items.slice();
        const result = filterCommands(query, items);

        // 子集且保序：每个输出元素按引用 ∈ items，且下标在 items 中严格递增。
        let lastIdx = -1;
        for (const r of result) {
          const idx = items.indexOf(r);
          expect(idx).toBeGreaterThan(lastIdx);
          lastIdx = idx;
        }

        // 空查询 → 输出深等 items（保序全量）。
        if (query.trim().length === 0) {
          expect(result).toEqual(items);
        } else {
          // 匹配语义双向：每元素「是否在输出」== 「title 或某 keyword 子序列匹配 query」。
          const q = query.trim();
          for (const item of items) {
            const shouldMatch =
              isSubsequenceMatch(q, item.title) ||
              item.keywords.some((kw) => isSubsequenceMatch(q, kw));
            expect(result.includes(item)).toBe(shouldMatch);
          }
        }

        // 幂等：filter(q, filter(q, items)) 深等 filter(q, items)。
        expect(filterCommands(query, result)).toEqual(result);

        // 纯性/确定性：调用不改 items；两次调用结果深等。
        expect(items).toEqual(snapshot);
        expect(filterCommands(query, items)).toEqual(result);
      }),
      { numRuns: 100 },
    );
  });
});

describe('clampHighlight — 边界单元测试', () => {
  it('index 越界 / 负值 / length=0（Req 4.3）', () => {
    expect(clampHighlight(5, 3)).toBe(2); // 越界夹到末尾
    expect(clampHighlight(-3, 3)).toBe(0); // 负值夹到 0
    expect(clampHighlight(1, 3)).toBe(1); // 范围内不变
    expect(clampHighlight(0, 0)).toBe(-1); // 空列表
    expect(clampHighlight(2, 0)).toBe(-1); // 空列表
  });
});

describe('moveHighlightIndex — 边界单元测试', () => {
  it('末尾 +1 回绕到 0、0 处 -1 回绕到末尾、空列表 -1（Req 4.1, 4.2）', () => {
    expect(moveHighlightIndex(2, 1, 3)).toBe(0); // 末尾向下回绕
    expect(moveHighlightIndex(0, -1, 3)).toBe(2); // 首部向上回绕
    expect(moveHighlightIndex(1, 1, 3)).toBe(2);
    expect(moveHighlightIndex(1, -1, 3)).toBe(0);
    expect(moveHighlightIndex(0, 1, 0)).toBe(-1); // 空列表
    expect(moveHighlightIndex(-1, 1, 3)).toBe(1); // -1 基准 +1
  });
});

describe('isSubsequenceMatch — 边界单元测试', () => {
  it('空 query 命中、顺序敏感、非相邻命中', () => {
    expect(isSubsequenceMatch('', 'anything')).toBe(true);
    expect(isSubsequenceMatch('abc', 'aXbXc')).toBe(true); // 非相邻命中
    expect(isSubsequenceMatch('cba', 'abc')).toBe(false); // 顺序敏感
    expect(isSubsequenceMatch('CHAT', 'Open Chat Page')).toBe(true); // 忽略大小写
    expect(isSubsequenceMatch('xyz', 'abc')).toBe(false);
  });
});
