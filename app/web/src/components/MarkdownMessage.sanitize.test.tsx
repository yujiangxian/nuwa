// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import fc from 'fast-check';
import MarkdownMessage from '@/components/MarkdownMessage';

/**
 * Property-based test：危险元素与内联事件属性净化（任务 6.4）。
 *
 * 复用项目既有 fast-check@3.23.2，属性测试至少运行 100 次随机迭代。
 * 注入 <script>/<iframe>/<object>/<embed>、on* 事件属性、原始 HTML 的源，
 * 渲染后 DOM 不应含这些元素，也不应含任何 on* 属性。
 */

afterEach(() => {
  cleanup();
});

/** 危险元素与原始 HTML 注入片段。 */
const dangerousArb = fc.constantFrom(
  '<script>alert(1)</script>',
  '<script src="https://evil.example/x.js"></script>',
  '<iframe src="https://evil.example"></iframe>',
  '<object data="x.swf"></object>',
  '<embed src="x.swf">',
  '<img src=x onerror="alert(1)">',
  '<div onclick="steal()">click</div>',
  '<a href="javascript:alert(1)" onmouseover="x()">bad</a>',
  '<body onload="alert(1)">',
  '<svg onload="alert(1)"></svg>',
  '<form action="x"><input onfocus="x()"></form>',
  '<style>body{display:none}</style>',
);

/** 与危险注入交织的良性 Markdown 片段。 */
const benignArb = fc.constantFrom(
  '正常段落文本。',
  '# 标题',
  '**加粗**',
  '`code`',
  '- 列表项',
  '[安全链接](https://example.com)',
  '',
);

const sourceArb = fc
  .array(fc.oneof(dangerousArb, benignArb), { minLength: 1, maxLength: 6 })
  .map((parts) => parts.join('\n\n'));

const FORBIDDEN_TAGS = ['script', 'iframe', 'object', 'embed', 'style'];

/** 检查任意元素是否带有 on* 内联事件属性。 */
function hasInlineEventHandler(root: Element): boolean {
  const all = root.querySelectorAll('*');
  for (const el of Array.from(all)) {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) return true;
    }
  }
  return false;
}

describe('MarkdownMessage 危险元素与内联事件属性净化', () => {
  it('Property 4: 危险元素与内联事件属性净化', () => {
    // Feature: markdown-message-rendering, Property 4: 危险元素与内联事件属性净化 —— 注入危险元素/on* 事件属性/原始 HTML 的源，渲染后 DOM 不含这些元素与任何 on* 属性
    fc.assert(
      fc.property(sourceArb, (source) => {
        const { container, unmount } = render(<MarkdownMessage source={source} />);
        const content = container.querySelector('.md-content') as Element;
        expect(content).not.toBeNull();

        // 不存在任何可执行/可嵌入元素
        for (const tag of FORBIDDEN_TAGS) {
          expect(content.querySelector(tag)).toBeNull();
        }
        // 不存在任何 on* 内联事件属性
        expect(hasInlineEventHandler(content)).toBe(false);

        unmount();
      }),
      { numRuns: 100 },
    );
  });

  it('原始 <script> 被作为文本转义而非可执行元素', () => {
    const { container } = render(
      <MarkdownMessage source={'前缀\n\n<script>alert(1)</script>\n\n后缀'} />,
    );
    const content = container.querySelector('.md-content') as Element;
    expect(content.querySelector('script')).toBeNull();
  });
});
