// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * Session_Organize 纯逻辑模块（chat-session-organization）。
 *
 * 封装会话侧边栏「置顶 + 按时间分组」的全部核心逻辑：置顶判定与缺省归一、
 * 置顶切换、相对天数差计算、时间分桶以及分组 + 排序主函数。所有函数均为
 * 无副作用纯函数，不依赖 DOM / Chat_Store / IndexedDB，便于以 fast-check
 * 做属性测试。
 *
 * Day_Diff 基于本地时区日历日零点之差，与既有 `formatRelativeTime`（chatSession.ts）
 * 的 `startOfDay` 口径一致；分桶只关心「差几个日历日」，不受具体时刻影响。
 */
import type { ChatSession } from '@/store/uiStore';

/** Session_Group 的类别：Pinned_Group 与五个 Time_Bucket。 */
export type GroupKind =
  | 'pinned'
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'earlier';

/** Group_Order：Session_Group 在输出中的固定排列顺序（置顶组居首）。 */
export const GROUP_ORDER: GroupKind[] = [
  'pinned',
  'today',
  'yesterday',
  'last7',
  'last30',
  'earlier',
];

/** 各分组在侧边栏展示的组标题（Req 7.2）。 */
export const GROUP_TITLES: Record<GroupKind, string> = {
  pinned: '置顶',
  today: '今天',
  yesterday: '昨天',
  last7: '近 7 天',
  last30: '近 30 天',
  earlier: '更早',
};

/** Session_Organize 输出的一个分组：类别、组标题与该组内已排序的会话。 */
export interface SessionGroup {
  kind: GroupKind;
  title: string;
  sessions: ChatSession[];
}

/**
 * 置顶判定（Req 1.4）：仅当 `pinned` 严格等于 true 视为置顶；
 * 缺失字段或任何非 true 取值（含 undefined / false）一律视为未置顶。
 */
export function isPinned(session: ChatSession): boolean {
  return session.pinned === true;
}

/**
 * 缺省归一（Req 1.3）：返回一个 `pinned` 字段被规整为布尔值的新会话——
 * 原 `pinned===true` 时为 true，否则为 false；其余字段原样保留。
 * 纯函数，不修改入参。对已含布尔 `pinned` 的会话为幂等。
 */
export function normalizePinned(session: ChatSession): ChatSession {
  return { ...session, pinned: session.pinned === true };
}

/**
 * 置顶切换（Req 2.1–2.4）：返回一个新数组，其中 id 匹配的会话其 `pinned`
 * 取反（以 isPinned 判定后取反），其余会话原样保留（同引用）。
 * 不修改入参数组及任一会话；未命中 id 时返回内容等价的新数组（无变化）。
 */
export function togglePinnedIn(sessions: ChatSession[], id: string): ChatSession[] {
  return sessions.map((s) => (s.id === id ? { ...s, pinned: !isPinned(s) } : s));
}

/**
 * 显式设置某会话置顶状态（供 setPinned action 使用）：返回新数组，id 匹配的
 * 会话 `pinned` 置为给定布尔值，其余会话原样保留。不修改入参。
 */
export function setPinnedIn(
  sessions: ChatSession[],
  id: string,
  pinned: boolean,
): ChatSession[] {
  return sessions.map((s) => (s.id === id ? { ...s, pinned } : s));
}

/** 本地时区日历日零点（毫秒），复用既有 formatRelativeTime 同款思路。 */
function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Day_Diff（Glossary）：Current_Time 所在本地日历日零点与 `updatedAt`
 * 所在本地日历日零点之间相差的整日数。
 * 返回正数表示会话日早于今天，0 表示同一日历日，负数表示会话日晚于今天（未来）。
 * `updatedAt` 不可解析时返回 `Number.POSITIVE_INFINITY`（归入 Earlier），不抛出。
 *
 * 使用 `Math.round` 抵消夏令时切换日 23h/25h 造成的非整日毫秒差，使日历日之差
 * 稳定为整数。
 */
export function dayDiff(updatedAt: string, currentTime: Date): number {
  const t = new Date(updatedAt).getTime();
  if (Number.isNaN(t)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.round((startOfDay(currentTime) - startOfDay(new Date(t))) / 86_400_000);
}

/**
 * 时间分桶（Req 5.1–5.6）：把 Day_Diff 映射到一个 Time_Bucket 的 GroupKind。
 * - d <= 0        → 'today'（含未来时间，Req 5.6）
 * - d === 1       → 'yesterday'
 * - 2 <= d <= 6   → 'last7'
 * - 7 <= d <= 29  → 'last30'
 * - d >= 30       → 'earlier'
 */
export function bucketOf(d: number): Exclude<GroupKind, 'pinned'> {
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d <= 6) return 'last7';
  if (d <= 29) return 'last30';
  return 'earlier';
}

/**
 * 分组 + 排序主函数（Req 4.1–4.6, 5.*, 6.*）。
 * 输入会话数组与 Current_Time，输出按 Group_Order 排列、省略空组的 SessionGroup[]：
 * - 置顶会话（isPinned）归入 Pinned_Group；
 * - 未置顶会话按 dayDiff/bucketOf 归入恰好一个 Time_Bucket；
 * - 每组内按 `updatedAt` 降序稳定排序（相等 `updatedAt` 保持输入相对次序，Req 6.5）；
 * - 不修改输入数组及任一会话（Req 4.5）；
 * - 相同输入 + 相同 Current_Time 多次调用结果一致（Req 4.6）。
 */
export function organizeSessions(
  sessions: ChatSession[],
  currentTime: Date,
): SessionGroup[] {
  // 1) 六个桶各初始化为空数组。
  const buckets = new Map<GroupKind, ChatSession[]>();
  for (const kind of GROUP_ORDER) {
    buckets.set(kind, []);
  }

  // 2) 按输入顺序分区（保留输入相对次序，为稳定排序提供基准）。
  for (const session of sessions) {
    const kind: GroupKind = isPinned(session)
      ? 'pinned'
      : bucketOf(dayDiff(session.updatedAt, currentTime));
    buckets.get(kind)!.push(session);
  }

  // 3) 每个非空桶按 updatedAt 降序稳定排序（ISO 字符串比较即时间序，相等返回 0；
  //    Array.prototype.sort 稳定，故相等 updatedAt 维持分区即输入次序，Req 6.1/6.5）。
  const output: SessionGroup[] = [];
  for (const kind of GROUP_ORDER) {
    const group = buckets.get(kind)!;
    if (group.length === 0) continue; // 省略空组（Req 6.4）
    const sorted = [...group].sort((a, b) =>
      a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
    );
    output.push({ kind, title: GROUP_TITLES[kind], sessions: sorted });
  }

  return output;
}
