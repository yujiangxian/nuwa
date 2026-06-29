import { describe, it, expect, afterEach } from 'vitest';
import fc from 'fast-check';
import { resolveTheme, applyTheme, type ResolvedTheme } from './theme';

describe('resolveTheme — 属性测试', () => {
  // Feature: appearance-theme-mode, Property 1: resolveTheme 的确定性与全覆盖（含非法值回退）
  it('Property 1: 任意输入恒返回 dark/light、确定性、非 light/system 输入恒为 dark', () => {
    const themeArb = fc.oneof(
      fc.constantFrom('dark', 'light', 'system'),
      fc.string(),
      fc.constant(null),
      fc.constant(undefined),
    );
    fc.assert(
      fc.property(themeArb, fc.boolean(), (theme, prefersDark) => {
        const out = resolveTheme(theme as never, prefersDark);
        // 全函数、无异常：返回值 ∈ {'dark','light'}
        expect(out === 'dark' || out === 'light').toBe(true);
        // 确定性：同输入多次调用一致
        expect(resolveTheme(theme as never, prefersDark)).toBe(out);
        // 非 'light'、非 'system' 的输入一律解析为 'dark'
        if (theme !== 'light' && theme !== 'system') {
          expect(out).toBe('dark');
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: appearance-theme-mode, Property 2: system 模式等价于系统偏好
  it('Property 2: resolveTheme(system, x) === x ? dark : light', () => {
    fc.assert(
      fc.property(fc.boolean(), (prefersDark) => {
        expect(resolveTheme('system', prefersDark)).toBe(prefersDark ? 'dark' : 'light');
      }),
      { numRuns: 100 },
    );
  });

  // Feature: appearance-theme-mode, Property 3: 非 system 锁定忽略系统偏好
  it('Property 3: dark/light 锁定主题与 systemPrefersDark 无关', () => {
    fc.assert(
      fc.property(fc.constantFrom('dark', 'light'), fc.boolean(), (theme, prefersDark) => {
        const out = resolveTheme(theme, prefersDark);
        // 结果恒等于锁定主题本身，且与系统偏好无关
        expect(out).toBe(theme);
        expect(resolveTheme(theme, !prefersDark)).toBe(out);
      }),
      { numRuns: 100 },
    );
  });
});

describe('applyTheme — 属性测试', () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme;
  });

  // Feature: appearance-theme-mode, Property 4: 主题应用幂等性
  it('Property 4: 连续两次 applyTheme 结果等于解析值且幂等', () => {
    const themeArb = fc.oneof(
      fc.constantFrom('dark', 'light', 'system'),
      fc.string(),
      fc.constant(null),
      fc.constant(undefined),
    );
    fc.assert(
      fc.property(themeArb, fc.boolean(), (theme, prefersDark) => {
        const resolved: ResolvedTheme = resolveTheme(theme as never, prefersDark);
        applyTheme(resolved);
        const afterFirst = document.documentElement.dataset.theme;
        applyTheme(resolved);
        const afterSecond = document.documentElement.dataset.theme;
        // 应用即解析结果
        expect(afterFirst).toBe(resolved);
        // 二次应用不改变值（幂等）
        expect(afterSecond).toBe(afterFirst);
      }),
      { numRuns: 100 },
    );
  });
});

describe('resolveTheme — 确定性示例与非法值边界', () => {
  it('四个确定性示例', () => {
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('light', false)).toBe('light');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('非法值回退到 dark', () => {
    expect(resolveTheme('', true)).toBe('dark');
    expect(resolveTheme('DARK', true)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('dark');
    expect(resolveTheme(undefined, true)).toBe('dark');
    expect(resolveTheme(null, false)).toBe('dark');
  });
});
