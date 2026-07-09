// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  resolveLocale,
  translate,
  translateIn,
  CATALOGS,
  LOCALE_LABELS,
  LABEL_TO_CODE,
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type LocaleCode,
  type TranslationCatalog,
} from './i18n';

// 合法输入集合（用于在属性测试中过滤掉合法 label/code）。
const VALID_INPUTS = new Set<string>([
  ...SUPPORTED_LOCALES,
  ...Object.keys(LABEL_TO_CODE),
]);

describe('resolveLocale — 属性测试', () => {
  // Feature: ui-internationalization, Property 1: resolveLocale 对合法输入正确归一
  it('Property 1: 合法 Display_Label / LocaleCode 正确归一', () => {
    const pairArb = fc.constantFrom(...SUPPORTED_LOCALES);
    fc.assert(
      fc.property(pairArb, (code) => {
        const label = LOCALE_LABELS[code];
        // Display_Label → 对应 LocaleCode（Req 2.1）
        expect(resolveLocale(label)).toBe(code);
        // 合法 LocaleCode 原样返回（Req 2.2）
        expect(resolveLocale(code)).toBe(code);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: ui-internationalization, Property 2: resolveLocale 对非法输入回退 Default_Locale
  it('Property 2: 非法输入回退 DEFAULT_LOCALE', () => {
    const invalidArb = fc
      .oneof(fc.string(), fc.constant(null), fc.constant(undefined))
      .filter((v) => v == null || !VALID_INPUTS.has(v));
    fc.assert(
      fc.property(invalidArb, (input) => {
        expect(resolveLocale(input as string | null | undefined)).toBe(DEFAULT_LOCALE);
      }),
      { numRuns: 100 },
    );
    // 显式边界示例
    expect(resolveLocale('')).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(null)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE);
  });

  // Feature: ui-internationalization, Property 3: resolveLocale 全函数性与确定性
  it('Property 3: 任意输入返回合法 LocaleCode、确定性、无副作用', () => {
    const anyArb = fc.oneof(fc.string(), fc.constant(null), fc.constant(undefined));
    fc.assert(
      fc.property(anyArb, (input) => {
        const before = document.documentElement.lang;
        const out = resolveLocale(input as string | null | undefined);
        // 返回值 ∈ SUPPORTED_LOCALES
        expect(SUPPORTED_LOCALES.includes(out)).toBe(true);
        // 确定性：同输入两次调用相等
        expect(resolveLocale(input as string | null | undefined)).toBe(out);
        // 无副作用：不修改 <html lang>
        expect(document.documentElement.lang).toBe(before);
      }),
      { numRuns: 100 },
    );
  });
});

describe('translate — 属性测试', () => {
  // Feature: ui-internationalization, Property 4: translate 命中当前语言目录时返回该值
  it('Property 4: 命中当前语言目录返回该目录值', () => {
    // 生成 (locale, 该 locale 目录中已定义的 key) 组合。
    const localeKeyArb = fc
      .constantFrom(...SUPPORTED_LOCALES)
      .chain((locale) =>
        fc.tuple(fc.constant(locale), fc.constantFrom(...Object.keys(CATALOGS[locale]))),
      );
    fc.assert(
      fc.property(localeKeyArb, ([locale, key]) => {
        expect(translate(locale, key)).toBe(CATALOGS[locale][key]);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: ui-internationalization, Property 5: translate 在当前语言缺失时回退默认语言
  it('Property 5: 当前语言缺失时回退 DEFAULT_LOCALE 值', () => {
    // 合成目录：仅 zh-CN 定义该键，en/ja 缺失，保证回退构造稳定不受真实目录补全影响。
    fc.assert(
      fc.property(
        fc.constantFrom<LocaleCode>('en', 'ja'),
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        (locale, key, value) => {
          const synthetic: Record<LocaleCode, TranslationCatalog> = {
            'zh-CN': { [key]: value },
            en: {},
            ja: {},
          };
          // key 在 locale(en/ja) 缺失但在 zh-CN 定义 → 回退到 zh-CN 值（Req 3.2）
          expect(translateIn(synthetic, locale, key)).toBe(value);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: ui-internationalization, Property 6: translate 在两目录均缺失时返回键本身
  it('Property 6: 两目录均缺失返回键本身', () => {
    const knownKeys = new Set<string>(Object.keys(CATALOGS[DEFAULT_LOCALE]));
    const localeArb = fc.constantFrom(...SUPPORTED_LOCALES);
    const missingKeyArb = fc.string().filter((k) => !knownKeys.has(k));
    fc.assert(
      fc.property(localeArb, missingKeyArb, (locale, key) => {
        expect(translate(locale, key)).toBe(key);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: ui-internationalization, Property 7: translate 确定性与无副作用
  it('Property 7: 相同输入两次调用相等、无副作用', () => {
    const localeArb = fc.constantFrom(...SUPPORTED_LOCALES);
    const keyArb = fc.oneof(
      fc.constantFrom(...Object.keys(CATALOGS[DEFAULT_LOCALE])),
      fc.string(),
    );
    fc.assert(
      fc.property(localeArb, keyArb, (locale, key) => {
        const before = document.documentElement.lang;
        const a = translate(locale, key);
        const b = translate(locale, key);
        expect(a).toBe(b);
        expect(document.documentElement.lang).toBe(before);
      }),
      { numRuns: 100 },
    );
  });
});

describe('翻译目录结构不变量 — 属性测试', () => {
  // Feature: ui-internationalization, Property 8: 三种语言目录共享同一键集合
  it('Property 8: 任意两个 LocaleCode 的键集合相等', () => {
    const localePairArb = fc.tuple(
      fc.constantFrom(...SUPPORTED_LOCALES),
      fc.constantFrom(...SUPPORTED_LOCALES),
    );
    fc.assert(
      fc.property(localePairArb, ([a, b]) => {
        const keysA = new Set(Object.keys(CATALOGS[a]));
        const keysB = new Set(Object.keys(CATALOGS[b]));
        expect(keysA.size).toBe(keysB.size);
        for (const k of keysA) expect(keysB.has(k)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: ui-internationalization, Property 9: zh-CN 目录的每个键值为非空字符串
  it('Property 9: zh-CN 目录每个键值 trim 后非空', () => {
    const keys = Object.keys(CATALOGS['zh-CN']);
    fc.assert(
      fc.property(fc.constantFrom(...keys), (key) => {
        const value = CATALOGS['zh-CN'][key];
        expect(typeof value).toBe('string');
        expect(value.trim().length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });
});

describe('resolveLocale / translate — 确定性示例与边界', () => {
  it('resolveLocale 三语 label/code 确定性示例', () => {
    expect(resolveLocale('简体中文')).toBe('zh-CN');
    expect(resolveLocale('English')).toBe('en');
    expect(resolveLocale('日本語')).toBe('ja');
    expect(resolveLocale('zh-CN')).toBe('zh-CN');
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale('ja')).toBe('ja');
  });

  it('resolveLocale 空串/null/undefined/未知串回退 zh-CN', () => {
    expect(resolveLocale('')).toBe('zh-CN');
    expect(resolveLocale(null)).toBe('zh-CN');
    expect(resolveLocale(undefined)).toBe('zh-CN');
    expect(resolveLocale('fr')).toBe('zh-CN');
    expect(resolveLocale('English ')).toBe('zh-CN');
  });

  it('translate 命中 / 回退默认 / 回退键本身三个确定性示例', () => {
    // 命中当前语言
    expect(translate('en', 'settings.title')).toBe('Settings');
    // 回退默认语言（合成目录）
    const synthetic: Record<LocaleCode, TranslationCatalog> = {
      'zh-CN': { 'only.zh': '仅中文' },
      en: {},
      ja: {},
    };
    expect(translateIn(synthetic, 'en', 'only.zh')).toBe('仅中文');
    // 回退键本身
    expect(translate('en', 'no.such.key.exists')).toBe('no.such.key.exists');
  });
});
