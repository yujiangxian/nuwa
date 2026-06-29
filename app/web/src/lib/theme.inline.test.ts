import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { resolveTheme, type ResolvedTheme } from './theme';

/**
 * 内联引导脚本（index.html）解析分支的等价镜像。
 *
 * 与 index.html 中 IIFE 的解析逻辑严格一一对应：
 * - 从持久化原始字符串中读取 theme（缺失 / 非字符串 → 默认 'dark'）
 * - 'light' → 'light'；'system' → prefersDark ? 'dark' : 'light'；其余 → 'dark'
 * - 读取 / 解析异常整体兜底为 'dark'
 *
 * `resolveTheme` 是被属性测试覆盖的「真理来源」，此函数用于校验内联脚本与其等价。
 */
function inlineResolve(rawSettings: string | null, prefersDark: boolean): ResolvedTheme {
  try {
    const DEFAULT = 'dark';
    let theme: string = DEFAULT;
    if (rawSettings) {
      const parsed = JSON.parse(rawSettings);
      if (parsed && typeof parsed.theme === 'string') theme = parsed.theme;
    }
    let resolved: ResolvedTheme;
    if (theme === 'light') resolved = 'light';
    else if (theme === 'system') resolved = prefersDark ? 'dark' : 'light';
    else resolved = 'dark';
    return resolved;
  } catch {
    return 'dark';
  }
}

describe('内联引导脚本解析等价性 — 属性测试', () => {
  // Feature: appearance-theme-mode, Property 6: 启动解析等价于运行期解析（内联脚本与 resolveTheme 一致）
  it('Property 6: 内联解析结果 === resolveTheme(theme ?? dark, prefersDark)', () => {
    // 任意持久化 theme：合法枚举 + 任意字符串 + 缺失（key 不存在 / theme 字段缺失）。
    const themeFieldArb = fc.oneof(
      fc.constantFrom('dark', 'light', 'system'),
      fc.string(),
    );
    const rawArb = fc.oneof(
      // 正常含 theme 字段的设置对象
      themeFieldArb.map((t) => JSON.stringify({ backendUrl: 'x', theme: t })),
      // theme 字段缺失（应回退默认 dark）
      fc.constant(JSON.stringify({ backendUrl: 'x' })),
      // theme 为非字符串（应回退默认 dark）
      fc.constant(JSON.stringify({ theme: 123 })),
      // localStorage 中无 nuwa_settings（null）
      fc.constant(null),
    );

    fc.assert(
      fc.property(rawArb, fc.boolean(), (raw, prefersDark) => {
        // 计算内联脚本"看到"的 theme，用于喂给 resolveTheme 做等价比较。
        let theme: string | null | undefined;
        if (raw) {
          const parsed = JSON.parse(raw);
          theme = typeof parsed.theme === 'string' ? parsed.theme : undefined;
        } else {
          theme = undefined;
        }
        const inline = inlineResolve(raw, prefersDark);
        // resolveTheme 对 undefined（缺失）回退 dark，与内联脚本默认一致。
        const runtime = resolveTheme(theme ?? 'dark', prefersDark);
        expect(inline).toBe(runtime);
      }),
      { numRuns: 100 },
    );
  });

  it('损坏 JSON / 异常输入兜底为 dark', () => {
    expect(inlineResolve('{ not valid json', true)).toBe('dark');
    expect(inlineResolve('{ not valid json', false)).toBe('dark');
  });
});
