import { describe, it, expect } from 'vitest';
import { buildSanitizeSchema } from '@/lib/markdown';

/**
 * Unit tests for `buildSanitizeSchema` in `lib/markdown.ts`.
 * 验证净化白名单 schema 的安全约束（Req 4.1, 4.2, 4.5）：
 * - tagNames 不含 script/iframe/object/embed 等可执行/可嵌入元素；
 * - attributes 中 code/span 放行 className（用于 hljs-* 高亮类与 language-*）；
 * - 不放行任何 on* 内联事件属性。
 */

/** 从某标签的属性白名单条目中取出属性名（条目可能是 'attr' 或 ['attr', ...约束]）。 */
function attrName(entry: unknown): string {
  return Array.isArray(entry) ? String(entry[0]) : String(entry);
}

describe('buildSanitizeSchema', () => {
  it('tagNames 不含 script/iframe/object/embed', () => {
    const schema = buildSanitizeSchema();
    const tagNames = schema.tagNames ?? [];
    for (const dangerous of ['script', 'iframe', 'object', 'embed']) {
      expect(tagNames).not.toContain(dangerous);
    }
  });

  it('attributes 中 code/span 放行 className', () => {
    const schema = buildSanitizeSchema();
    const attributes = schema.attributes ?? {};

    const codeAttrs = (attributes.code ?? []).map(attrName);
    const spanAttrs = (attributes.span ?? []).map(attrName);

    expect(codeAttrs).toContain('className');
    expect(spanAttrs).toContain('className');
  });

  it('放行的 className 不是受限形式（允许任意 hljs-* / language-* 类）', () => {
    const schema = buildSanitizeSchema();
    const attributes = schema.attributes ?? {};

    for (const tag of ['code', 'span'] as const) {
      const entries = attributes[tag] ?? [];
      const classNameEntry = entries.find((e) => attrName(e) === 'className');
      // className 应以裸字符串形式放行（无白名单约束），否则 hljs-* 高亮类会被剥离。
      expect(classNameEntry).toBe('className');
    }
  });

  it('不放行任何 on* 内联事件属性', () => {
    const schema = buildSanitizeSchema();
    const attributes = schema.attributes ?? {};

    for (const [tag, entries] of Object.entries(attributes)) {
      for (const entry of entries ?? []) {
        const name = attrName(entry);
        expect(
          /^on/i.test(name),
          `tag <${tag}> 不应放行内联事件属性: ${name}`,
        ).toBe(false);
      }
    }
  });

  it('返回新对象，不污染共享的 defaultSchema', () => {
    const a = buildSanitizeSchema();
    const b = buildSanitizeSchema();
    expect(a).not.toBe(b);
    expect(a.attributes).not.toBe(b.attributes);
  });
});
