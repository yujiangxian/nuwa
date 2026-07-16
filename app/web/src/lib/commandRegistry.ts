// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * 命令注册表 builder（command-palette）的纯逻辑层。
 *
 * `buildCommandRegistry(ctx)` 接收应用上下文（store actions + 当前上下文 + 平台），
 * 返回有序、带类型且 id 唯一的 Command_Item 列表（Req 2）。run 为捕获 ctx 的无参闭包。
 *
 * 本模块不导入 React，不读写 store/DOM；副作用只在命令 run 被调用时经注入的 actions 发生。
 */
import type { AppPage } from '@/store/types';
import { SUPPORTED_LOCALES, LOCALE_LABELS } from '@/lib/i18n';
import type { CommandItem } from '@/lib/commandPalette';
import { type Platform, parseKeyCombo, formatKeyCombo } from '@/lib/keyCombo';

/** 注册表构建所需的上下文：store actions + 当前上下文 + 平台。 */
export interface CommandRegistryContext {
  setPage: (page: AppPage) => void;
  setSettingsOpen: (open: boolean) => void;
  updateSetting: (key: 'theme' | 'language', value: string) => void;
  createSession: (agentId: string) => void | Promise<void>;
  currentAgentId: string;
  platform: Platform;
  /** 翻译函数（用于命令标题本地化），可选；缺省用内置中文标题。 */
  t?: (key: string) => string;
}

/** 导航命令清单（顺序稳定）。 */
const NAV_ITEMS: { page: AppPage; title: string; keywords: string[] }[] = [
  { page: 'home', title: '前往 首页', keywords: ['home', '首页', 'shouye'] },
  { page: 'chat', title: '前往 对话', keywords: ['chat', '对话', 'duihua'] },
  { page: 'agents', title: '前往 Agent', keywords: ['agent', 'agents', '智能体'] },
  { page: 'voice', title: '前往 声音工坊', keywords: ['voice', 'studio', '声音', '工坊'] },
  { page: 'transcribe', title: '前往 录音转写', keywords: ['transcribe', '录音', '转写'] },
  { page: 'models', title: '前往 模型管理', keywords: ['models', '模型', '管理'] },
  { page: 'presets', title: '前往 提示词', keywords: ['presets', 'prompt', '提示词'] },
];

/** 主题命令清单（顺序稳定）。 */
const THEME_ITEMS: { value: 'dark' | 'light' | 'system'; title: string; keywords: string[] }[] = [
  { value: 'dark', title: '主题：深色', keywords: ['theme', 'dark', '主题', '深色'] },
  { value: 'light', title: '主题：浅色', keywords: ['theme', 'light', '主题', '浅色'] },
  { value: 'system', title: '主题：跟随系统', keywords: ['theme', 'system', '主题', '系统'] },
];

/**
 * 规范化 Key_Combo 源字符串为展示用字符串（解析失败返回 undefined，命令不带 combo）。
 */
function canonicalCombo(src: string, platform: Platform): string | undefined {
  const parsed = parseKeyCombo(src, platform);
  return parsed ? formatKeyCombo(parsed) : undefined;
}

/**
 * 构建有序 Command_Item 列表（Req 2）。
 *
 * 包含：
 * - 7 个导航命令（home/chat/agents/voice/transcribe/models/presets），run 调用 setPage。
 * - 1 个打开设置命令（Req 2.3），run 调用 setSettingsOpen(true)。
 * - 3 个切换主题命令（dark/light/system，Req 2.4），run 调用 updateSetting('theme', …)。
 * - N 个切换语言命令（每个受支持 Locale_Setting，Req 2.5），run 调用 updateSetting('language', …)。
 * - 1 个新建会话命令（Req 2.6），run 调用 createSession(currentAgentId) 后 setPage('chat')。
 *
 * 保证全部 id 唯一（Req 2.7）；关联 Key_Combo 的命令在 combo 上记录规范化字符串（Req 2.8）。
 */
export function buildCommandRegistry(ctx: CommandRegistryContext): CommandItem[] {
  const items: CommandItem[] = [];

  // 导航命令（Req 2.2, 5.1）。
  for (const nav of NAV_ITEMS) {
    items.push({
      id: `nav.${nav.page}`,
      title: nav.title,
      keywords: nav.keywords,
      group: 'navigation',
      run: () => ctx.setPage(nav.page),
    });
  }

  // 打开设置命令（Req 2.3, 5.2）。
  items.push({
    id: 'settings.open',
    title: '打开设置',
    keywords: ['settings', '设置', 'shezhi'],
    group: 'settings',
    run: () => ctx.setSettingsOpen(true),
  });

  // 主题命令（Req 2.4, 5.3）。
  for (const theme of THEME_ITEMS) {
    items.push({
      id: `theme.${theme.value}`,
      title: theme.title,
      keywords: theme.keywords,
      group: 'appearance',
      run: () => ctx.updateSetting('theme', theme.value),
    });
  }

  // 语言命令（每个受支持 Locale_Setting，Req 2.5, 5.4）。
  for (const code of SUPPORTED_LOCALES) {
    const label = LOCALE_LABELS[code];
    items.push({
      id: `locale.${code}`,
      title: `语言：${label}`,
      keywords: ['language', 'locale', '语言', code, label],
      group: 'appearance',
      run: () => ctx.updateSetting('language', label),
    });
  }

  // 新建会话命令（Req 2.6, 5.5）：分配快捷键 mod+n 并记录规范化 combo（Req 2.8）。
  items.push({
    id: 'session.new',
    title: '新建对话',
    keywords: ['session', 'new', '新建', '对话', '会话'],
    group: 'session',
    combo: canonicalCombo('mod+n', ctx.platform),
    run: () => {
      void ctx.createSession(ctx.currentAgentId);
      ctx.setPage('chat');
    },
  });

  return items;
}
