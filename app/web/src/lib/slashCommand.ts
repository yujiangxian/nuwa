// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * Pure helpers for the chat-input slash-command feature (Slash_Command_Engine).
 *
 * These functions contain no DOM / Chat_Store / IndexedDB dependencies so they
 * can be exercised directly by property-based tests (fast-check) and reused by
 * both the presentational layer (SlashCommandMenu) and the integration layer
 * (ChatPage). All boundary conditions are expressed via return values
 * (`null` / `-1` / empty array / unchanged value); no exceptions, no I/O.
 */
import type { PromptPreset } from '@/store/uiStore';

/** 统一的命令条目（Command_Item）。 */
export interface CommandItem {
  /** 命令来源：内置快捷命令或由提示词预设派生。 */
  kind: 'builtin' | 'preset';
  /** 用于匹配的命令关键字（小写、无前导斜杠），如 'clear' / 'retry' / 预设派生键。 */
  commandKey: string;
  /** 展示标题。 */
  title: string;
  /** 展示说明。 */
  description: string;
  /** 仅 Preset_Command 含：指向来源预设 id。 */
  presetId?: string;
}

/** 内置命令的稳定 key（供选中分发使用）。 */
export type BuiltinKey = 'clear' | 'retry' | 'presets';

/** Filtered_Commands 为空时 Highlight_Index 的约定空值。 */
export const EMPTY_HIGHLIGHT = -1;

/**
 * 斜杠激活判定（Slash_Trigger_Condition）：文本首字符为 '/' 且不含换行符。
 *
 * 空串、首字符非 '/'、含 '\n' 或 '\r' 均返回 false（Req 1.1–1.4, 6.2）。
 */
export function isSlashActive(text: string): boolean {
  if (text.length === 0) return false;
  if (text[0] !== '/') return false;
  if (text.includes('\n') || text.includes('\r')) return false;
  return true;
}

/**
 * 解析 Slash_Query：
 * - 处于 Slash_Active_State 时返回首个 '/' 之后到末尾的子串（单个 '/' => ''）；
 * - 否则返回 null（Req 1.5, 1.6）。
 */
export function parseSlashQuery(text: string): string | null {
  if (!isSlashActive(text)) return null;
  return text.slice(1);
}

/**
 * Slash_Query 往返重建：由 query 重建 Input_Field 文本。
 * 空串 => "/"；非空 q => "/" + q。与 parseSlashQuery 互逆（Req 1.7, 6.3）。
 */
export function buildSlashText(query: string): string {
  return `/${query}`;
}

/** 固定内置命令集合（顺序稳定：clear, retry, presets）（Req 2.1）。 */
export function buildBuiltinCommands(): CommandItem[] {
  return [
    { kind: 'builtin', commandKey: 'clear', title: '/clear', description: '清空当前输入' },
    { kind: 'builtin', commandKey: 'retry', title: '/retry', description: '重新生成上一条回复' },
    { kind: 'builtin', commandKey: 'presets', title: '/presets', description: '打开提示词预设页' },
  ];
}

/** 由单条预设标题派生可匹配的 commandKey：标题去空白后小写，为空则退回 id 小写（Req 2.6）。 */
function presetCommandKey(preset: PromptPreset): string {
  const key = preset.title.trim().toLowerCase();
  return key.length > 0 ? key : preset.id.toLowerCase();
}

/** 取预设正文的简短展示说明（单行、截断），仅用于菜单展示。 */
function presetDescription(content: string): string {
  const oneLine = content.replace(/\s+/g, ' ').trim();
  const cps = Array.from(oneLine);
  return cps.length > 40 ? `${cps.slice(0, 40).join('')}…` : oneLine;
}

/**
 * 由 presets 派生 Preset_Command 列表，保持输入顺序（Req 2.2, 2.4）。
 */
export function buildPresetCommands(presets: PromptPreset[]): CommandItem[] {
  return presets.map((p) => ({
    kind: 'preset' as const,
    commandKey: presetCommandKey(p),
    title: p.title,
    description: presetDescription(p.content),
    presetId: p.id,
  }));
}

/**
 * Command_Catalog：Builtin 在前，Preset 按原序在后（Req 2.3, 2.5）。
 * 长度恒等于 builtin 数量 + presets 数量。
 */
export function buildCommandCatalog(presets: PromptPreset[]): CommandItem[] {
  return [...buildBuiltinCommands(), ...buildPresetCommands(presets)];
}

/** 判定 query（小写）的字符序列是否为 target（小写）的子序列。空 query 总是命中。 */
function isSubsequence(query: string, target: string): boolean {
  if (query.length === 0) return true;
  const q = Array.from(query.toLowerCase());
  const t = Array.from(target.toLowerCase());
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

/** 单条命令是否匹配 query：忽略大小写，对 commandKey 或 title 做子序列匹配（Req 3.2, 3.7）。 */
function matchesQuery(item: CommandItem, query: string): boolean {
  return isSubsequence(query, item.commandKey) || isSubsequence(query, item.title);
}

/**
 * 以 query 过滤 catalog：忽略大小写、子序列匹配 commandKey 或 title。
 * 空 query 返回全量副本；结果为保序子集；过滤幂等（Req 3.1, 3.3, 3.4, 3.5, 3.6）。
 */
export function filterCommands(catalog: CommandItem[], query: string): CommandItem[] {
  return catalog.filter((item) => matchesQuery(item, query));
}

/**
 * 规整高亮下标到合法范围（Req 4.3, 4.4, 4.5, 6.6）：
 * - length === 0 => EMPTY_HIGHLIGHT(-1)（约定空值）；
 * - 否则环绕到 [0, length-1]：((index % length) + length) % length。
 * 同一函数同时服务于「过滤后规整」与「ArrowUp/Down 回绕」。
 */
export function clampHighlightIndex(index: number, length: number): number {
  if (length <= 0) return EMPTY_HIGHLIGHT;
  const i = Math.trunc(index);
  return ((i % length) + length) % length;
}

/**
 * 构造 Inserted_Preset_Text：以预设 content 替换从首个 '/' 到 Slash_Query 末尾的整段。
 * 因激活态文本整体即斜杠命令（首字符 '/'、无换行），结果即为 presetContent（Req 5.1）。
 */
export function buildInsertedPresetText(presetContent: string): string {
  return presetContent;
}
