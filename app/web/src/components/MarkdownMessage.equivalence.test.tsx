import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import fc from 'fast-check';
import MarkdownMessage from '@/components/MarkdownMessage';

/**
 * Property-based test：流式与定型渲染等价（任务 6.3）。
 *
 * 复用项目既有 fast-check@3.23.2，属性测试至少运行 100 次随机迭代。
 * 同一 Markdown 源以 streaming=true 与 streaming=false 渲染应产出等价可见文本与结构。
 * 光标装饰位于 ChatPage 容器中而非组件内，故组件本身应完全等价。
 */

afterEach(() => {
  cleanup();
});

/** 由可解析的 Markdown 片段构造随机有效 Markdown 源。 */
const blockArb = fc.constantFrom(
  '# 标题一',
  '## 标题二',
  '这是一个**加粗**与*斜体*的段落。',
  '- 项目一\n- 项目二\n- 项目三',
  '1. 第一\n2. 第二',
  '> 这是一段引用。',
  '行内代码 `const x = 1` 示例。',
  '```ts\nconst n: number = 42;\nconsole.log(n);\n```',
  '[链接](https://example.com)',
  '普通段落文本。',
  '| 列A | 列B |\n| --- | --- |\n| 1 | 2 |',
  '~~删除线~~ 文本。',
  '- [ ] 未完成\n- [x] 已完成',
);

const sourceArb = fc
  .array(blockArb, { minLength: 1, maxLength: 6 })
  .map((blocks) => blocks.join('\n\n'));

/** 收集元素标签名序列（深度优先），用于比较结构等价。 */
function tagSequence(root: Element | null): string[] {
  if (!root) return [];
  const tags: string[] = [];
  root.querySelectorAll('*').forEach((el) => tags.push(el.tagName.toLowerCase()));
  return tags;
}

describe('MarkdownMessage 流式与定型渲染等价', () => {
  it('Property 3: 流式与定型渲染等价', () => {
    // Feature: markdown-message-rendering, Property 3: 流式与定型渲染等价 —— 同一 Markdown 源以 streaming=true 与 false 渲染产出等价可见文本与关键标签结构（忽略 ChatPage 容器中的光标装饰）
    fc.assert(
      fc.property(sourceArb, (source) => {
        const streamed = render(<MarkdownMessage source={source} streaming />);
        const streamedContent = streamed.container.querySelector('.md-content');
        const streamedText = streamedContent?.textContent ?? '';
        const streamedTags = tagSequence(streamedContent);
        streamed.unmount();

        const settled = render(<MarkdownMessage source={source} streaming={false} />);
        const settledContent = settled.container.querySelector('.md-content');
        const settledText = settledContent?.textContent ?? '';
        const settledTags = tagSequence(settledContent);
        settled.unmount();

        // 可见文本等价
        expect(streamedText).toBe(settledText);
        // 关键标签结构等价
        expect(streamedTags).toEqual(settledTags);
      }),
      { numRuns: 100 },
    );
  });
});
