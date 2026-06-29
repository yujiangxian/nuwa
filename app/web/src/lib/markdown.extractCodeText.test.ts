import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { extractCodeText } from '@/lib/markdown';

/**
 * Property-based test for `extractCodeText` in `lib/markdown.ts`.
 * 复用项目既有 fast-check@3.23.2，每条属性至少运行 100 次随机迭代。
 *
 * 思路：将任意代码内容字符串拆分为若干片段，分布到 hast 文本节点中
 * （文本节点可被任意嵌套的 element 节点——模拟 rehype-highlight 注入的
 * <span class="hljs-*"> 高亮包裹——包裹），随后断言 extractCodeText
 * 提取得到的文本严格等于原始代码内容（round-trip），且不含标签或高亮标记。
 */

// ---------------------------------------------------------------------------
// hast 节点构造
// ---------------------------------------------------------------------------

interface HastText {
  type: 'text';
  value: string;
}
interface HastElement {
  type: 'element';
  tagName: string;
  properties?: Record<string, unknown>;
  children: Array<HastText | HastElement>;
}

/** 将一个文本片段包裹进随机层级的高亮 span（模拟 rehype-highlight 产物）。 */
function wrapInSpans(text: string, depth: number): HastText | HastElement {
  let node: HastText | HastElement = { type: 'text', value: text };
  for (let i = 0; i < depth; i++) {
    node = {
      type: 'element',
      tagName: 'span',
      properties: { className: ['hljs-keyword', `hljs-token-${i}`] },
      children: [node],
    };
  }
  return node;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** 任意代码内容字符（含换行、空白、符号、CJK）。 */
const codeCharArb = fc.constantFrom(
  'a', 'b', 'c', 'Z', '0', '9', ' ', '\t', '\n',
  '{', '}', '(', ')', ';', '=', '<', '>', '/', '"', "'",
  '你', '好', 'λ',
);

/** 任意代码内容字符串（可空）。 */
const codeStringArb = fc.array(codeCharArb, { maxLength: 40 }).map((cs) => cs.join(''));

describe('extractCodeText', () => {
  it('Property 8: 代码复制源文本提取 round-trip', () => {
    // Feature: markdown-message-rendering, Property 8: 代码复制源文本提取 round-trip —— 任意代码内容字符串经包裹/提取后等于原文，不含标签或高亮标记
    fc.assert(
      fc.property(
        codeStringArb,
        // 每个片段的嵌套深度（决定 span 包裹层数）
        fc.array(fc.nat({ max: 3 }), { minLength: 1, maxLength: 6 }),
        (code, depths) => {
          // 将 code 切分为 depths.length 个连续片段（片段之和 === code）。
          const n = depths.length;
          const chars = Array.from(code);
          const fragments: string[] = [];
          const base = Math.floor(chars.length / n);
          let idx = 0;
          for (let i = 0; i < n; i++) {
            const take = i === n - 1 ? chars.length - idx : base;
            fragments.push(chars.slice(idx, idx + take).join(''));
            idx += take;
          }

          // 构造 code 元素：children 为各片段（部分被 hljs span 包裹）。
          const codeNode: HastElement = {
            type: 'element',
            tagName: 'code',
            properties: { className: ['hljs', 'language-ts'] },
            children: fragments.map((frag, i) => wrapInSpans(frag, depths[i])),
          };

          // round-trip：提取结果应严格等于原始代码内容。
          const extracted = extractCodeText(codeNode);
          expect(extracted).toBe(code);
          // 不含标签名或高亮类标记。
          expect(extracted.includes('hljs')).toBe(false);
          expect(extracted.includes('<span')).toBe(false);
          expect(extracted.includes('language-')).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  // 边界与回归示例
  it('从纯文本节点提取', () => {
    expect(extractCodeText({ type: 'text', value: 'const x = 1;' })).toBe('const x = 1;');
  });

  it('从嵌套 element 节点提取（跳过标签与高亮标记）', () => {
    const node: HastElement = {
      type: 'element',
      tagName: 'code',
      properties: { className: ['hljs', 'language-js'] },
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: ['hljs-keyword'] },
          children: [{ type: 'text', value: 'const' }],
        },
        { type: 'text', value: ' x = ' },
        {
          type: 'element',
          tagName: 'span',
          properties: { className: ['hljs-number'] },
          children: [{ type: 'text', value: '42' }],
        },
        { type: 'text', value: ';' },
      ],
    };
    expect(extractCodeText(node)).toBe('const x = 42;');
  });

  it('从数组节点与字符串提取', () => {
    expect(extractCodeText(['a', { type: 'text', value: 'b' }, 'c'])).toBe('abc');
    expect(extractCodeText('plain')).toBe('plain');
  });

  it('空内容与异常输入', () => {
    expect(extractCodeText({ type: 'text', value: '' })).toBe('');
    expect(extractCodeText(null)).toBe('');
    expect(extractCodeText(undefined)).toBe('');
    expect(extractCodeText(123)).toBe('');
  });
});
