// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import fc from 'fast-check';
import MarkdownMessage from '@/components/MarkdownMessage';

/**
 * Property-based test：纯文本语义保留（任务 6.2）。
 *
 * 复用项目既有 fast-check@3.23.2，属性测试至少运行 100 次随机迭代。
 * 渲染层属性使用 @testing-library/react + jsdom。
 */

afterEach(() => {
  cleanup();
});

/**
 * 生成不含 Markdown 元字符、且无首尾/连续空白的随机纯文本。
 *
 * 策略：生成若干「词」（由安全字符组成，不含 # * ` _ - [ ] ( ) > | 等元字符，
 * 也不含 < & \ ! 等会被转义/特殊处理的字符与换行），再以单个空格连接。
 * 这样既排除了 Markdown 元字符，也避免了首尾空白与连续空白被规整化的歧义。
 */
const SAFE_CHARS = [
  // 拉丁字母
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'X', 'Y', 'Z',
  // 数字
  '0', '1', '2', '9',
  // 安全标点（不属于 Markdown 元字符；注意 '+' 是 GFM 无序列表标记，与 '-'/'*' 同属元字符，故排除）
  '.', ',', ':', ';', '?', '/', '=', '@', '$', '%',
  // 中文字符（验证非 ASCII 文本语义保留）
  '你', '好', '世', '界', '女', '娲',
];

const wordArb = fc.stringOf(fc.constantFrom(...SAFE_CHARS), { minLength: 1, maxLength: 12 });
const textArb = fc
  .array(wordArb, { minLength: 1, maxLength: 8 })
  .map((words) => words.join(' '))
  // GFM treats "1. foo" as an ordered list, which drops the "1. " from visible text.
  .filter((text) => !/(?:^|\s)\d+\.\s/.test(text));

describe('MarkdownMessage 纯文本语义保留', () => {
  it('Property 1: 纯文本语义保留', () => {
    // Feature: markdown-message-rendering, Property 1: 纯文本语义保留 —— 不含 Markdown 元字符的随机文本作为 Assistant_Message 渲染后，容器可见文本应包含该原始文本
    fc.assert(
      fc.property(textArb, (text) => {
        const { container, unmount } = render(<MarkdownMessage source={text} />);
        const content = container.querySelector('.md-content');
        expect(content).not.toBeNull();
        // 渲染容器的可见文本内容应包含原始文本（呈现为普通段落，语义不丢失）。
        expect(content?.textContent ?? '').toContain(text);
        unmount();
      }),
      { numRuns: 100 },
    );
  });

  it('纯文本不产生 Markdown 元素（无标题/强调/列表等）', () => {
    const { container } = render(<MarkdownMessage source="hello world 你好世界" />);
    const content = container.querySelector('.md-content');
    expect(content?.querySelector('h1, h2, strong, em, ul, ol, code')).toBeNull();
    expect(content?.textContent).toContain('hello world 你好世界');
  });
});
