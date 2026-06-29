import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import fc from 'fast-check';
import MarkdownMessage from '@/components/MarkdownMessage';

/**
 * Property-based test：不完整 Markdown 渲染健壮性（任务 6.6）。
 *
 * 复用项目既有 fast-check@3.23.2，属性测试至少运行 100 次随机迭代。
 * 任意 Markdown 源的任意前缀截断（未闭合围栏/强调等）渲染不应抛出未捕获异常。
 */

afterEach(() => {
  cleanup();
});

/**
 * 一段较完整、涵盖多种构造的 Markdown 源，用于取任意前缀模拟流式逐字到达。
 * 前缀截断会自然产生未闭合的围栏、强调、链接、表格等不完整构造。
 */
const FULL_MARKDOWN = [
  '# 标题',
  '',
  '这是**加粗**与*斜体*与`行内代码`混合的段落，还有 ~~删除线~~。',
  '',
  '- 列表项一',
  '- 列表项二',
  '  - 嵌套项',
  '',
  '1. 有序一',
  '2. 有序二',
  '',
  '> 引用块文本',
  '',
  '[链接文本](https://example.com/path?q=1)',
  '',
  '```ts',
  'const greeting: string = "hello";',
  'function add(a: number, b: number) {',
  '  return a + b;',
  '}',
  '```',
  '',
  '| 列A | 列B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '- [ ] 未完成任务',
  '- [x] 已完成任务',
].join('\n');

describe('MarkdownMessage 不完整 Markdown 渲染健壮性', () => {
  it('Property 11: 不完整 Markdown 渲染健壮性', () => {
    // Feature: markdown-message-rendering, Property 11: 不完整 Markdown 渲染健壮性 —— 任意 Markdown 源的任意前缀截断渲染不抛未捕获异常
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: FULL_MARKDOWN.length }),
        (cut) => {
          const prefix = FULL_MARKDOWN.slice(0, cut);
          // 渲染任意前缀不应抛出未捕获异常使界面崩溃。
          expect(() => {
            const { unmount } = render(<MarkdownMessage source={prefix} streaming />);
            unmount();
          }).not.toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('未闭合围栏与未闭合强调不抛错', () => {
    expect(() => {
      const a = render(<MarkdownMessage source={'```ts\nconst x = 1'} streaming />);
      a.unmount();
      const b = render(<MarkdownMessage source={'这是 **未闭合的加粗'} streaming />);
      b.unmount();
      const c = render(<MarkdownMessage source={'[未闭合链接'} streaming />);
      c.unmount();
    }).not.toThrow();
  });
});
