import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseLanguage } from '@/lib/markdown';

/**
 * Property-based test for `parseLanguage` in `lib/markdown.ts`.
 * 复用项目既有 fast-check@3.23.2，每条属性至少运行 100 次随机迭代。
 */

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** 合法语言标识符（不含空白，不以会与其它类名冲突的形式出现）。 */
const langArb = fc
  .stringOf(
    fc.constantFrom('a', 'b', 'c', 't', 's', 'j', 'p', 'y', '0', '1', '+', '#', '-'),
    { minLength: 1, maxLength: 8 },
  );

/** 不含 language- 前缀的普通类名。 */
const nonLangClassArb = fc
  .stringOf(
    fc.constantFrom('a', 'b', 'c', 'h', 'l', 'j', 's', '0', '1', '-'),
    { minLength: 1, maxLength: 10 },
  )
  // 排除恰好以 "language-" 开头的极小概率组合
  .filter((c) => !c.startsWith('language-'));

describe('parseLanguage', () => {
  it('Property 7: 语言标签解析', () => {
    // Feature: markdown-message-rendering, Property 7: 语言标签解析 —— 含 language-X 类名返回 X，无 language-* 返回 undefined
    fc.assert(
      fc.property(
        fc.oneof(
          // (1) 含 language-X 类名（与若干噪声类名混合）—— 期望返回 X
          fc.record({
            kind: fc.constant<'has'>('has'),
            lang: langArb,
            before: fc.array(nonLangClassArb, { maxLength: 3 }),
            after: fc.array(nonLangClassArb, { maxLength: 3 }),
            asArray: fc.boolean(),
          }),
          // (2) 不含 language-* 类名 —— 期望返回 undefined
          fc.record({
            kind: fc.constant<'none'>('none'),
            classes: fc.array(nonLangClassArb, { maxLength: 5 }),
            asArray: fc.boolean(),
          }),
        ),
        (input) => {
          if (input.kind === 'has') {
            const list = [...input.before, `language-${input.lang}`, ...input.after];
            const className = input.asArray ? list : list.join(' ');
            expect(parseLanguage(className)).toBe(input.lang);
          } else {
            const className = input.asArray ? input.classes : input.classes.join(' ');
            expect(parseLanguage(className)).toBeUndefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // 边界与回归示例
  it('解析 language-X 前缀返回 X', () => {
    expect(parseLanguage('language-ts')).toBe('ts');
    expect(parseLanguage('language-ts hljs')).toBe('ts');
    expect(parseLanguage('hljs language-python')).toBe('python');
    expect(parseLanguage(['hljs', 'language-rust'])).toBe('rust');
  });

  it('无 language-* 类名返回 undefined', () => {
    expect(parseLanguage('hljs')).toBeUndefined();
    expect(parseLanguage('foo bar')).toBeUndefined();
    expect(parseLanguage([])).toBeUndefined();
    expect(parseLanguage('')).toBeUndefined();
    expect(parseLanguage(undefined)).toBeUndefined();
  });
});
