import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import fc from 'fast-check';
import MarkdownMessage from '@/components/MarkdownMessage';

/**
 * Property-based test：安全链接渲染（任务 6.5）。
 *
 * 复用项目既有 fast-check@3.23.2，属性测试至少运行 100 次随机迭代。
 * http/https/mailto 链接渲染出的 <a> 应同时具备 target="_blank" 与 rel="noopener noreferrer"。
 */

afterEach(() => {
  cleanup();
});

/** 域名标签片段（字母数字，避免引入 Markdown 特殊字符）。 */
const labelArb = fc.stringOf(
  fc.constantFrom('a', 'b', 'c', 'x', 'y', 'z', '0', '1', '2', '3'),
  { minLength: 1, maxLength: 8 },
);

/** 路径片段（不含空格与会破坏链接解析的字符）。 */
const pathArb = fc.stringOf(
  fc.constantFrom('a', 'b', 'c', '1', '2', '3', '/', '-', '_', '.'),
  { maxLength: 16 },
);

/** 生成随机合法的 http/https/mailto URL。 */
const urlArb = fc.oneof(
  // http / https
  fc.record({
    scheme: fc.constantFrom('http', 'https'),
    host: fc.array(labelArb, { minLength: 1, maxLength: 3 }).map((p) => p.join('.')),
    path: pathArb,
  }).map(({ scheme, host, path }) => `${scheme}://${host}.com${path ? '/' + path : ''}`),
  // mailto
  fc.record({
    user: labelArb,
    host: labelArb,
  }).map(({ user, host }) => `mailto:${user}@${host}.com`),
);

describe('MarkdownMessage 安全链接渲染', () => {
  it('Property 5: 安全链接渲染', () => {
    // Feature: markdown-message-rendering, Property 5: 安全链接渲染 —— http/https/mailto 链接渲染出的 <a> 同时具 target="_blank" 与 rel="noopener noreferrer"
    fc.assert(
      fc.property(urlArb, labelArb, (url, text) => {
        const source = `[${text}](${url})`;
        const { container, unmount } = render(<MarkdownMessage source={source} />);
        const anchor = container.querySelector('.md-content a');
        expect(anchor).not.toBeNull();
        expect(anchor?.getAttribute('target')).toBe('_blank');
        expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
        // href 被保留为安全链接
        expect(anchor?.getAttribute('href')).toBe(url);
        unmount();
      }),
      { numRuns: 100 },
    );
  });

  it('mailto 链接也带新标签与 rel 属性', () => {
    const { container } = render(
      <MarkdownMessage source={'[邮件](mailto:hi@example.com)'} />,
    );
    const anchor = container.querySelector('.md-content a');
    expect(anchor?.getAttribute('target')).toBe('_blank');
    expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
