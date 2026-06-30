/**
 * Chat_Search 纯逻辑模块（chat-history-search）。
 *
 * 封装跨会话关键词检索的全部核心逻辑：查询规范化、大小写不敏感子串匹配、
 * 片段提取、高亮区间计算与结果排序。所有函数均为无副作用纯函数，不依赖
 * DOM / Chat_Store / IndexedDB，便于以 fast-check 做属性测试。
 *
 * 字符处理一律以 **Unicode 码点**（`Array.from`）为单位，保证 emoji / 代理对
 * 等多字节字符安全，使 `HighlightRange` 的 `{start,length}` 语义稳定。
 */
import type { ChatSession, ChatMessage } from '@/store/types';

/** Match_Snippet 的最大码点数。 */
export const SNIPPET_MAX_LENGTH = 100;

/** Debounce_Interval，毫秒。连续输入停止后触发检索前的去抖延迟。 */
export const DEBOUNCE_INTERVAL = 200;

/** 一条结果所属会话的匹配类型。 */
export type MatchType = 'title' | 'message';

/**
 * Match_Snippet 内一处与 Normalized_Query 大小写不敏感相等的子串区间，
 * 基于码点（非 UTF-16 码元）：start 为起始码点下标，length 为码点数。
 */
export interface HighlightRange {
  start: number;
  length: number;
}

/** Search_Corpus 的一个条目：一个会话及其按追加顺序排列的消息。 */
export interface SearchCorpusEntry {
  session: ChatSession;
  messages: ChatMessage[];
}

/** 一次检索使用的语料。 */
export type SearchCorpus = SearchCorpusEntry[];

/** 一条检索结果。 */
export interface SearchResult {
  /** 所属会话 id。 */
  sessionId: string;
  /** 所属会话标题（快照，便于直接渲染）。 */
  sessionTitle: string;
  /** 所属会话 updatedAt（ISO，UI 用 formatRelativeTime 格式化）。 */
  updatedAt: string;
  /** 匹配类型。 */
  matchType: MatchType;
  /** 当 matchType==='message' 时为匹配消息 id；'title' 时为 undefined。 */
  messageId?: string;
  /** 围绕首个匹配位置、截断到 SNIPPET_MAX_LENGTH 的展示片段。 */
  snippet: string;
  /** snippet 内的高亮区间（升序、互不重叠）。 */
  highlights: HighlightRange[];
}

/**
 * 逐码点折叠大小写：把码点数组中的每个码点单独 `toLowerCase`。
 * 逐码点折叠避免整串 toLowerCase 在某些语言下造成的长度漂移，从而让
 * 匹配判定与高亮区间共享同一码点下标基准。
 */
function foldCodepoints(codepoints: string[]): string[] {
  return codepoints.map((c) => c.toLowerCase());
}

/**
 * 在折叠后的码点序列 `haystack` 中查找折叠后的 `needle` 首个出现的起始下标。
 * `needle` 为空返回 -1；未命中返回 -1。
 */
function foldedIndexOf(haystack: string[], needle: string[]): number {
  const n = haystack.length;
  const q = needle.length;
  if (q === 0) return -1;
  for (let i = 0; i + q <= n; i++) {
    let matched = true;
    for (let k = 0; k < q; k++) {
      if (haystack[i + k] !== needle[k]) {
        matched = false;
        break;
      }
    }
    if (matched) return i;
  }
  return -1;
}

/** 去除 Search_Query 首尾空白，得到 Normalized_Query。 */
export function normalizeQuery(query: string): string {
  return query.trim();
}

/**
 * 大小写不敏感子串判定：normalizedQuery 是否为 text 的子串。
 * normalizedQuery 为空时返回 false（空查询不匹配任何文本）。
 * 以逐码点折叠大小写后比较，保证多字节安全。
 */
export function matchesQuery(text: string, normalizedQuery: string): boolean {
  if (normalizedQuery === '') return false;
  const haystack = foldCodepoints(Array.from(text));
  const needle = foldCodepoints(Array.from(normalizedQuery));
  return foldedIndexOf(haystack, needle) >= 0;
}

/**
 * 生成围绕 text 中首个匹配位置的 Match_Snippet（以码点为单位）：
 * - text 码点数 <= maxLength 时返回整段 text；
 * - 超过 maxLength 时取一个长度为 maxLength 的码点窗口；当 normalizedQuery
 *   码点数 <= maxLength 时窗口必定完整包含首个匹配子串；
 * - normalizedQuery 不是 text 子串（或为空）时返回 text 截断到 maxLength 的前缀。
 */
export function buildSnippet(
  text: string,
  normalizedQuery: string,
  maxLength: number = SNIPPET_MAX_LENGTH,
): string {
  const cps = Array.from(text);
  const n = cps.length;
  if (n <= maxLength) {
    return text;
  }

  const matchStart = foldedIndexOf(
    foldCodepoints(cps),
    foldCodepoints(Array.from(normalizedQuery)),
  );
  if (matchStart < 0) {
    // 未命中：返回前缀。
    return cps.slice(0, maxLength).join('');
  }

  const q = Array.from(normalizedQuery).length;
  let start: number;
  if (q >= maxLength) {
    // 超长查询：尽力保留匹配起点。
    start = matchStart;
  } else {
    // 居中显示匹配子串。
    start = matchStart - Math.floor((maxLength - q) / 2);
  }
  // 钳制到合法窗口范围 [0, n - maxLength]。
  start = Math.max(0, Math.min(start, n - maxLength));
  return cps.slice(start, start + maxLength).join('');
}

/**
 * 计算 snippet 内所有与 normalizedQuery 大小写不敏感相等的子串区间。
 * 从左到右扫描，匹配后跳过整个匹配长度，得到：
 * - 升序（start 递增）；
 * - 互不重叠；
 * - 每个区间均落在 [0, snippet 码点数] 边界内；
 * - 每个区间对应文本与 normalizedQuery 大小写不敏感相等。
 * normalizedQuery 为空时返回 []。
 */
export function computeHighlights(
  snippet: string,
  normalizedQuery: string,
): HighlightRange[] {
  if (normalizedQuery === '') return [];
  const haystack = foldCodepoints(Array.from(snippet));
  const needle = foldCodepoints(Array.from(normalizedQuery));
  const q = needle.length;
  if (q === 0) return [];

  const ranges: HighlightRange[] = [];
  const n = haystack.length;
  let i = 0;
  while (i + q <= n) {
    let matched = true;
    for (let k = 0; k < q; k++) {
      if (haystack[i + k] !== needle[k]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      ranges.push({ start: i, length: q });
      i += q; // 匹配后跳过整段，保证互不重叠。
    } else {
      i++;
    }
  }
  return ranges;
}

/**
 * 顶层检索：对 corpus 计算有序的 SearchResult[]。
 * - nq = normalizeQuery(query)；nq 为空返回 []；
 * - 在每个会话标题与每条消息内容中做大小写不敏感子串匹配；
 * - 标题命中产生一条 Title_Match；每条命中消息至多一条 Message_Match；
 * - 结果按所属会话 updatedAt 降序；同会话内 Title_Match 在前、
 *   Message_Match 按消息追加顺序在后（依赖稳定排序保留相等 updatedAt 的语料次序）。
 *
 * 检索为只读操作，不修改任何输入数据（Req 9.1）。
 */
export function searchCorpus(corpus: SearchCorpus, query: string): SearchResult[] {
  const nq = normalizeQuery(query);
  if (nq === '') return [];

  // 按语料顺序展开命中结果：同一会话内 Title_Match 先于 Message_Match，
  // Message_Match 按消息追加顺序。
  const flattened: SearchResult[] = [];
  for (const { session, messages } of corpus) {
    if (matchesQuery(session.title, nq)) {
      const snippet = buildSnippet(session.title, nq);
      flattened.push({
        sessionId: session.id,
        sessionTitle: session.title,
        updatedAt: session.updatedAt,
        matchType: 'title',
        snippet,
        highlights: computeHighlights(snippet, nq),
      });
    }
    for (const message of messages) {
      if (matchesQuery(message.content, nq)) {
        const snippet = buildSnippet(message.content, nq);
        flattened.push({
          sessionId: session.id,
          sessionTitle: session.title,
          updatedAt: session.updatedAt,
          matchType: 'message',
          messageId: message.id,
          snippet,
          highlights: computeHighlights(snippet, nq),
        });
      }
    }
  }

  // 按所属会话 updatedAt 降序稳定排序：ISO 字符串比较即时间序。
  // Array.prototype.sort 在现代 JS 中稳定，故相等 updatedAt 保留 flattened
  // （即语料）中的相对次序，同会话内 Title→Message 顺序亦得以保留。
  flattened.sort((a, b) => {
    if (a.updatedAt > b.updatedAt) return -1;
    if (a.updatedAt < b.updatedAt) return 1;
    return 0;
  });
  return flattened;
}
