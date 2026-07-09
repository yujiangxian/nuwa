// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * 命令面板（Command_Palette）的纯逻辑层（command-palette）。
 *
 * 关注点分离（镜像 lib/theme.ts / lib/i18n.ts）：
 * - `isSubsequenceMatch` / `filterCommands` / `clampHighlight` / `moveHighlightIndex`
 *   均为无副作用纯函数：不读写 store/DOM/任何外部状态，对相同输入恒返回相同输出。
 *
 * 本模块不导入 React，不读写 Zustand store，不接触 DOM。
 */

/** 命令分组标签。 */
export type CommandGroup = 'navigation' | 'settings' | 'appearance' | 'session';

/** 一条可执行命令（带类型记录）。 */
export interface CommandItem {
  /** 注册表内稳定且唯一的 id。 */
  id: string;
  /** 显示标题。 */
  title: string;
  /** 可选副标题/说明。 */
  subtitle?: string;
  /** 用于匹配的关键字集合（与 title 一并参与子序列匹配）。 */
  keywords: string[];
  /** 分组标签。 */
  group: CommandGroup;
  /** 可选关联的规范化 Key_Combo 字符串（用于展示）。 */
  combo?: string;
  /** 无参执行函数（闭包捕获 store actions/context）。 */
  run: () => void;
}

/**
 * 大小写无关的子序列匹配：query 的字符按序（不必相邻）出现在 text 中即命中。
 * 空 query 视为命中一切。纯函数。
 */
export function isSubsequenceMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  if (q.length === 0) return true;
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti += 1) {
    if (t[ti] === q[qi]) qi += 1;
  }
  return qi === q.length;
}

/**
 * Command_Filter：依据 query 过滤并保序返回 items 的子集（Req 3）。无副作用纯函数。
 *
 * - query 为空（trim 后）：返回 items 的保序全量副本（Req 3.1）。
 * - query 非空：保留 title 或任一 keywords 元素能子序列匹配 query 的项（忽略大小写，Req 3.2）。
 * - 保持输入相对顺序作为稳定回退排序（Req 3.3）。
 * - 输出恒为输入子集，不新增/复制元素（Req 3.6）。
 * - 不读写 store/DOM/外部状态，对相同输入恒返回相同输出（Req 3.4）；
 *   过滤幂等：filter(q, filter(q, items)) == filter(q, items)（Req 3.5）。
 */
export function filterCommands(query: string, items: CommandItem[]): CommandItem[] {
  const trimmed = query.trim();
  // 空查询：保序全量副本（新数组，元素按引用保留）。
  if (trimmed.length === 0) return items.slice();
  // 非空查询：单次保序 filter，谓词仅依赖 query 与元素自身（保证纯性与幂等）。
  return items.filter(
    (item) =>
      isSubsequenceMatch(trimmed, item.title) ||
      item.keywords.some((kw) => isSubsequenceMatch(trimmed, kw)),
  );
}

/**
 * 将 Highlight_Index 规整到合法范围（Req 4.3）。纯函数。
 * 列表为空返回 -1；否则将 index 夹到 [0, length-1]。
 */
export function clampHighlight(index: number, length: number): number {
  if (length <= 0) return -1;
  if (index < 0) return 0;
  if (index > length - 1) return length - 1;
  return index;
}

/**
 * 方向键移动并回绕（Req 4.1, 4.2）。纯函数。
 * length<=0 返回 -1；否则 (current + delta) 对 length 取模回绕。
 */
export function moveHighlightIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return -1;
  // 以 current 为基准（current 越界时先视作 0），叠加 delta 后对 length 取模回绕。
  const base = current < 0 ? 0 : current;
  return (((base + delta) % length) + length) % length;
}
