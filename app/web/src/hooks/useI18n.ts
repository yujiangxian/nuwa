// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { useMemo } from 'react';
import { useUIStore } from '@/store/uiStore';
import { resolveLocale, translate, type LocaleCode, type TranslationKey } from '@/lib/i18n';

export interface I18n {
  /** 由 settings.language 经 resolveLocale 得到的当前 LocaleCode。 */
  locale: LocaleCode;
  /** 绑定当前 locale 的翻译函数：t(key) === translate(locale, key)。 */
  t: (key: TranslationKey) => string;
}

/**
 * 当前语言驱动的翻译 Hook。
 *
 * 读取 uiStore.settings.language（Req 4.1），经 resolveLocale 归一出当前 LocaleCode，
 * 返回绑定该 locale 的翻译函数 t（Req 4.2）。settings.language 变更时 Zustand 选择器
 * 触发重渲染，locale 与 t 随之更新，使消费组件以新语言重渲染（Req 4.3）。
 */
export function useI18n(): I18n {
  const language = useUIStore((s) => s.settings.language);
  const locale = resolveLocale(language);
  // 以 locale 为依赖缓存 t，locale 不变时引用稳定。
  const t = useMemo(() => (key: TranslationKey) => translate(locale, key), [locale]);
  return { locale, t };
}
