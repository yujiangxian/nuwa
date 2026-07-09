// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { useEffect } from 'react';
import { useUIStore } from '@/store/uiStore';
import { resolveLocale } from '@/lib/i18n';

/**
 * 运行期语言副作用：将 Document_Root 的 lang 属性同步为当前 LocaleCode。
 * 镜像 useThemeEffect 的结构，是唯一接触 <html lang> 属性的代码。
 *
 * - 初始渲染后将 <html lang> 设为当前 LocaleCode（Req 6.1）。
 * - settings.language 变更导致 LocaleCode 改变时，更新 <html lang>（Req 6.2）。
 *
 * 幂等、不抛错。在 App 顶层调用一次即可。
 */
export function useLangEffect(): void {
  const language = useUIStore((s) => s.settings.language);

  useEffect(() => {
    document.documentElement.lang = resolveLocale(language);
  }, [language]);
}
