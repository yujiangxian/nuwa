// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * 外观主题应用引擎（appearance-theme-mode）的纯逻辑层。
 *
 * 关注点分离：`resolveTheme` 是无副作用纯函数（解析），`applyTheme` 是唯一接触
 * DOM 的薄副作用函数（写 data-theme），`getSystemPrefersDark` 读取系统偏好。
 */

/** 主题设置取值（来自 Settings_Store）。 */
export type ThemeSetting = 'dark' | 'light' | 'system';

/** 已解析主题：实际应用到界面的具体主题。 */
export type ResolvedTheme = 'dark' | 'light';

/**
 * 将主题设置解析为具体主题。无副作用纯函数。
 *
 * - 'dark'   → 'dark'（与 systemPrefersDark 无关）
 * - 'light'  → 'light'（与 systemPrefersDark 无关）
 * - 'system' → systemPrefersDark ? 'dark' : 'light'
 * - 其他任何非法值（null/undefined/任意字符串）→ 'dark'（回退）
 *
 * 不读取全局状态，不修改 DOM 或 Settings_Store。对相同输入恒返回相同输出。
 */
export function resolveTheme(
  themeSetting: ThemeSetting | string | null | undefined,
  systemPrefersDark: boolean,
): ResolvedTheme {
  switch (themeSetting) {
    case 'light':
      return 'light';
    case 'system':
      return systemPrefersDark ? 'dark' : 'light';
    // 'dark' 与任意非法值（null/undefined/其他字符串）统一回退到 'dark'。
    default:
      return 'dark';
  }
}

/**
 * 把已解析主题写入 Document_Root 的 data-theme 属性。
 * 这是唯一接触 DOM 的函数（薄副作用），便于隔离与测试。
 * 幂等：以相同 resolved 重复调用结果不变。
 */
export function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved;
}

/**
 * 读取当前系统是否偏好深色。matchMedia 不可用时回退 false。
 * 供运行期 hook 使用（内联脚本自带等价逻辑）。
 */
export function getSystemPrefersDark(): boolean {
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
  } catch {
    /* ignore — 回退 false */
  }
  return false;
}
