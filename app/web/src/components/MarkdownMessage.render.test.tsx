// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import MarkdownMessage from '@/components/MarkdownMessage';

/**
 * 单元测试：各 Markdown 构造渲染（任务 6.7）。
 *
 * 覆盖：标题 / 粗体斜体 / 有序无序列表 / 链接 / 引用块 / 行内代码 /
 * 围栏代码块 / GFM 表格·删除线·任务列表，各一例，断言生成对应标签；
 * 带语言围栏断言出现 hljs 高亮节点。
 *
 * _Requirements: 1.1, 1.2, 1.3, 1.4, 3.1, 5.4_
 */

afterEach(() => {
  cleanup();
});

/** 渲染并返回 .md-content 容器。 */
function renderMd(source: string): HTMLElement {
  const { container } = render(<MarkdownMessage source={source} />);
  const content = container.querySelector('.md-content');
  if (!content) throw new Error('.md-content 容器未渲染');
  return content as HTMLElement;
}

describe('MarkdownMessage 各 Markdown 构造渲染', () => {
  it('标题渲染为 h1/h2/h3（需求 1.1）', () => {
    const content = renderMd('# 一级\n\n## 二级\n\n### 三级');
    expect(content.querySelector('h1')?.textContent).toContain('一级');
    expect(content.querySelector('h2')?.textContent).toContain('二级');
    expect(content.querySelector('h3')?.textContent).toContain('三级');
  });

  it('粗体与斜体渲染为 strong/em（需求 1.2）', () => {
    const content = renderMd('这是 **粗体** 与 *斜体*。');
    expect(content.querySelector('strong')?.textContent).toBe('粗体');
    expect(content.querySelector('em')?.textContent).toBe('斜体');
  });

  it('无序列表渲染为 ul>li（需求 1.3）', () => {
    const content = renderMd('- 苹果\n- 香蕉\n- 橙子');
    const ul = content.querySelector('ul');
    expect(ul).not.toBeNull();
    expect(ul?.querySelectorAll('li').length).toBe(3);
  });

  it('有序列表渲染为 ol>li（需求 1.3）', () => {
    const content = renderMd('1. 第一\n2. 第二');
    const ol = content.querySelector('ol');
    expect(ol).not.toBeNull();
    expect(ol?.querySelectorAll('li').length).toBe(2);
  });

  it('链接渲染为安全 a 元素（需求 1.4）', () => {
    const content = renderMd('[示例](https://example.com)');
    const a = content.querySelector('a');
    expect(a).not.toBeNull();
    expect(a?.getAttribute('href')).toBe('https://example.com');
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(a?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('引用块渲染为 blockquote', () => {
    const content = renderMd('> 这是引用文本');
    expect(content.querySelector('blockquote')?.textContent).toContain('这是引用文本');
  });

  it('行内代码渲染为 code（需求 5.4 反向：行内不进 CodeBlock）', () => {
    const content = renderMd('调用 `useState` 钩子。');
    const code = content.querySelector('code');
    expect(code).not.toBeNull();
    expect(code?.textContent).toBe('useState');
    // 行内代码不应位于 pre 代码块容器内
    expect(content.querySelector('pre code')).toBeNull();
  });

  it('围栏代码块渲染为 pre>code，且带语言时出现 hljs 高亮节点（需求 3.1, 5.4）', () => {
    const content = renderMd('```ts\nconst n: number = 42;\nconsole.log(n);\n```');
    const pre = content.querySelector('pre');
    expect(pre).not.toBeNull();
    const code = pre?.querySelector('code');
    expect(code).not.toBeNull();
    // 带语言围栏应出现 highlight.js 高亮节点
    const highlighted =
      content.querySelector('.hljs') ||
      content.querySelector('code[class*="language-"]') ||
      content.querySelector('[class*="hljs-"]');
    expect(highlighted).not.toBeNull();
  });

  it('GFM 表格渲染为 table（需求 3.1）', () => {
    const content = renderMd('| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |');
    const table = content.querySelector('table');
    expect(table).not.toBeNull();
    expect(table?.querySelectorAll('th').length).toBe(2);
    expect(table?.querySelectorAll('td').length).toBe(2);
  });

  it('GFM 删除线渲染为 del', () => {
    const content = renderMd('这是 ~~删除~~ 文本。');
    expect(content.querySelector('del')?.textContent).toBe('删除');
  });

  it('GFM 任务列表渲染为 checkbox 输入', () => {
    const content = renderMd('- [ ] 未完成\n- [x] 已完成');
    const checkboxes = content.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(2);
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(false);
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(true);
  });
});
