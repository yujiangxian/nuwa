import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { ChatSession, ChatMessage } from '@/store/uiStore';
import {
  SNIPPET_MAX_LENGTH,
  normalizeQuery,
  matchesQuery,
  buildSnippet,
  computeHighlights,
  searchCorpus,
  type SearchCorpus,
} from '@/lib/chatSearch';

/**
 * Property-based tests for the pure search logic in `lib/chatSearch.ts`.
 * Each property uses fast-check with at least 100 iterations and is tagged
 * with its design-document Property number.
 */

// ---------------------------------------------------------------------------
// Generators & test-local oracles
// ---------------------------------------------------------------------------

// 安全字符池：每个码点在 toLowerCase 下保持 1:1（不改变码点数），
// 含 ASCII 大小写、数字、CJK、非 BMP emoji（触发代理对）。避免会改变
// 码点数的特殊大小写字符（如 'İ'）。
const SAFE_CHARS = [
  'a', 'b', 'c', 'd', 'e', 'A', 'B', 'C', 'D', 'E',
  'x', 'Y', 'z', 'M', 'n',
  '0', '1', '2',
  '你', '好', '世', '界', '春',
  '😀', '🎉', '🚀', '🌟',
];

const safeCharArb = fc.constantFrom(...SAFE_CHARS);

/** 由安全字符组成的字符串（码点折叠 1:1）。 */
function safeStringArb(opts?: { minLength?: number; maxLength?: number }): fc.Arbitrary<string> {
  return fc
    .array(safeCharArb, { minLength: opts?.minLength ?? 0, maxLength: opts?.maxLength ?? 12 })
    .map((cps) => cps.join(''));
}

/** 非空安全查询 token（无首尾空白，normalizeQuery 后不变）。 */
const safeQueryArb = safeStringArb({ minLength: 1, maxLength: 4 });

/** 逐码点折叠大小写（测试本地 oracle）。 */
function fold(s: string): string[] {
  return Array.from(s).map((c) => c.toLowerCase());
}

/** 折叠后子串包含判定（测试本地 oracle，对应匹配语义）。 */
function foldedIncludes(text: string, q: string): boolean {
  if (q === '') return false;
  const t = fold(text);
  const p = fold(q);
  if (p.length === 0) return false;
  for (let i = 0; i + p.length <= t.length; i++) {
    let ok = true;
    for (let k = 0; k < p.length; k++) {
      if (t[i + k] !== p[k]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

type CaseMode = 'asis' | 'upper' | 'lower';
function applyCase(s: string, mode: CaseMode): string {
  if (mode === 'upper') return s.toUpperCase();
  if (mode === 'lower') return s.toLowerCase();
  return s;
}

const caseModeArb = fc.constantFrom<CaseMode>('asis', 'upper', 'lower');
const whitespaceArb = fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\u3000'), { maxLength: 4 });
const whitespaceOnlyQueryArb = fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\u3000'), { maxLength: 6 });

/**
 * 原始语料生成：每条目含 title、updatedAt（取自小池以制造相等值）、
 * 若干消息内容。在测试中再 remap 为唯一 session/message id 并构造完整对象。
 */
const updatedAtPool = fc.constantFrom(
  '2024-01-01T00:00:00.000Z',
  '2024-02-01T00:00:00.000Z',
  '2024-03-01T00:00:00.000Z',
);

interface RawEntry {
  title: string;
  updatedAt: string;
  contents: string[];
}

/**
 * 生成可能命中 q 的文本：embed=true 时把 q 的大小写变体嵌入随机填充，
 * 制造命中正例；否则为纯随机安全串（命中与否由实际内容决定）。
 */
function maybeHitTextArb(q: string): fc.Arbitrary<string> {
  return fc
    .tuple(
      fc.boolean(),
      safeStringArb({ maxLength: 6 }),
      safeStringArb({ maxLength: 6 }),
      caseModeArb,
    )
    .map(([embed, prefix, suffix, mode]) =>
      embed ? prefix + applyCase(q, mode) + suffix : prefix + suffix,
    );
}

function rawCorpusArb(q: string): fc.Arbitrary<RawEntry[]> {
  return fc.array(
    fc.record({
      title: maybeHitTextArb(q),
      updatedAt: updatedAtPool,
      contents: fc.array(maybeHitTextArb(q), { maxLength: 4 }),
    }),
    { maxLength: 5 },
  );
}

/** 将 RawEntry[] remap 为带唯一 id 的完整 SearchCorpus。 */
function buildCorpus(raw: RawEntry[]): SearchCorpus {
  return raw.map((e, i) => {
    const session: ChatSession = {
      id: `s${i}`,
      title: e.title,
      characterId: 'c',
      voiceId: 'v',
      updatedAt: e.updatedAt,
      pinned: false,
    };
    const messages: ChatMessage[] = e.contents.map((content, j) => ({
      id: `s${i}-m${j}`,
      role: j % 2 === 0 ? 'user' : 'assistant',
      content,
    }));
    return { session, messages };
  });
}

// ---------------------------------------------------------------------------
// Property 1: normalizeQuery
// ---------------------------------------------------------------------------

describe('normalizeQuery', () => {
  it('Property 1: 查询规范化等价 trim', () => {
    // Feature: chat-history-search, Property 1: 查询规范化等价 trim
    fc.assert(
      fc.property(
        // 在任意 unicode 核心两侧拼接随机空白，覆盖含首尾空白 / 多字节场景。
        fc.tuple(whitespaceArb, fc.fullUnicodeString({ maxLength: 20 }), whitespaceArb).map(
          ([a, b, c]) => a + b + c,
        ),
        (query) => {
          const r = normalizeQuery(query);
          expect(r).toBe(query.trim());
          if (r.length > 0) {
            expect(/^\s/u.test(r)).toBe(false);
            expect(/\s$/u.test(r)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: matchesQuery
// ---------------------------------------------------------------------------

describe('matchesQuery', () => {
  it('Property 2: 大小写不敏感匹配不变性', () => {
    // Feature: chat-history-search, Property 2: 大小写不敏感匹配不变性
    fc.assert(
      fc.property(
        safeQueryArb,
        safeStringArb({ maxLength: 8 }),
        safeStringArb({ maxLength: 8 }),
        caseModeArb,
        fc.boolean(),
        (q, prefix, suffix, mode, embed) => {
          const nq = normalizeQuery(q);
          // 制造命中正例（embed）与负例（纯填充）。
          const text = embed ? prefix + applyCase(q, mode) + suffix : prefix + suffix;
          // 逐码点翻转大小写得到 text'。
          const cps = Array.from(text);
          const text2 = cps
            .map((c) => {
              const lower = c.toLowerCase();
              const upper = c.toUpperCase();
              if (c === lower && Array.from(upper).length === 1) return upper;
              if (c === upper && Array.from(lower).length === 1) return lower;
              return c;
            })
            .join('');

          const r1 = matchesQuery(text, nq);
          const r2 = matchesQuery(text2, nq);
          // 大小写翻转前后判定一致。
          expect(r1).toBe(r2);
          // 等价于"nq 折叠后是 text 折叠后的子串"。
          expect(r1).toBe(foldedIncludes(text, nq));
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: buildSnippet
// ---------------------------------------------------------------------------

describe('buildSnippet', () => {
  it('Property 7: 片段包含首个匹配且截断到上限', () => {
    // Feature: chat-history-search, Property 7: 片段包含首个匹配且截断到上限
    fc.assert(
      fc.property(
        safeQueryArb, // 码点数 <= 4 <= SNIPPET_MAX_LENGTH
        safeStringArb({ maxLength: 60 }),
        safeStringArb({ maxLength: 60 }),
        caseModeArb,
        fc.boolean(),
        (q, prefix, suffix, mode, embed) => {
          const nq = normalizeQuery(q);
          const text = embed ? prefix + applyCase(q, mode) + suffix : prefix + suffix;
          const snippet = buildSnippet(text, nq);
          // 结果码点数不超过上限。
          expect(Array.from(snippet).length).toBeLessThanOrEqual(SNIPPET_MAX_LENGTH);
          // nq 为 text 子串时，结果保留首个匹配子串。
          if (matchesQuery(text, nq)) {
            expect(matchesQuery(snippet, nq)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6: computeHighlights
// ---------------------------------------------------------------------------

describe('computeHighlights', () => {
  it('Property 6: 高亮区间合法性（数量 / 边界 / 等值 / 升序不重叠）', () => {
    // Feature: chat-history-search, Property 6: 高亮区间合法性（数量 / 边界 / 等值 / 升序不重叠）
    fc.assert(
      fc.property(safeStringArb({ maxLength: 30 }), safeQueryArb, (snippet, q) => {
        const nq = normalizeQuery(q);
        const ranges = computeHighlights(snippet, nq);
        const snippetCps = Array.from(snippet);
        const qLen = Array.from(nq).length;

        // 独立 oracle：从左到右、匹配后跳过整段的不重叠出现次数。
        const haystack = fold(snippet);
        const needle = fold(nq);
        let expectedCount = 0;
        let i = 0;
        while (i + needle.length <= haystack.length) {
          let ok = true;
          for (let k = 0; k < needle.length; k++) {
            if (haystack[i + k] !== needle[k]) {
              ok = false;
              break;
            }
          }
          if (ok) {
            expectedCount++;
            i += needle.length;
          } else {
            i++;
          }
        }

        // (d) 数量等于不重叠出现次数。
        expect(ranges.length).toBe(expectedCount);

        let prevEnd = -1;
        for (const r of ranges) {
          // (a) 边界落在 snippet 范围内。
          expect(r.start).toBeGreaterThanOrEqual(0);
          expect(r.start + r.length).toBeLessThanOrEqual(snippetCps.length);
          // (b) length 等于 nq 码点数，且对应子串折叠相等。
          expect(r.length).toBe(qLen);
          const sub = snippetCps.slice(r.start, r.start + r.length).join('');
          expect(fold(sub)).toEqual(needle);
          // (c) 严格升序且互不重叠。
          expect(r.start).toBeGreaterThanOrEqual(prevEnd);
          expect(r.start).toBeGreaterThan(prevEnd === -1 ? -1 : prevEnd - 1);
          prevEnd = r.start + r.length;
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: searchCorpus（空查询）
// ---------------------------------------------------------------------------

describe('searchCorpus — empty query', () => {
  it('Property 3: 空查询返回空结果', () => {
    // Feature: chat-history-search, Property 3: 空查询返回空结果
    fc.assert(
      fc.property(
        fc.constant('seed').chain(() => rawCorpusArb('seed')),
        whitespaceOnlyQueryArb,
        (raw, blankQuery) => {
          const corpus = buildCorpus(raw);
          expect(searchCorpus(corpus, blankQuery)).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: searchCorpus（覆盖、归属与每消息至多一条）
// ---------------------------------------------------------------------------

describe('searchCorpus — coverage & uniqueness', () => {
  it('Property 4: 匹配覆盖、归属与每消息至多一条', () => {
    // Feature: chat-history-search, Property 4: 匹配覆盖、归属与每消息至多一条
    fc.assert(
      fc.property(
        safeQueryArb.chain((q) => fc.tuple(fc.constant(q), rawCorpusArb(q))),
        ([q, raw]) => {
          const corpus = buildCorpus(raw);
          const nq = normalizeQuery(q);
          const results = searchCorpus(corpus, q);

          // 期望命中集合（以 matchesQuery 作为匹配语义 oracle）。
          const expectedTitles = new Set<string>();
          const expectedMessages = new Set<string>();
          for (const { session, messages } of corpus) {
            if (matchesQuery(session.title, nq)) expectedTitles.add(session.id);
            for (const m of messages) {
              if (matchesQuery(m.content, nq)) expectedMessages.add(m.id);
            }
          }

          const actualTitles = results.filter((r) => r.matchType === 'title');
          const actualMessages = results.filter((r) => r.matchType === 'message');

          // (a) 标题命中会话恰一条 title 结果且 sessionId 正确。
          expect(new Set(actualTitles.map((r) => r.sessionId))).toEqual(expectedTitles);
          expect(actualTitles.length).toBe(expectedTitles.size);

          // (b) 命中消息恰一条 message 结果，messageId 与归属正确。
          const sessionOfMessage = new Map<string, string>();
          for (const { session, messages } of corpus) {
            for (const m of messages) sessionOfMessage.set(m.id, session.id);
          }
          expect(new Set(actualMessages.map((r) => r.messageId!))).toEqual(expectedMessages);
          // (d) 任一 messageId 至多出现一次。
          expect(actualMessages.length).toBe(expectedMessages.size);
          for (const r of actualMessages) {
            expect(sessionOfMessage.get(r.messageId!)).toBe(r.sessionId);
          }

          // (c) 标题及全部消息均不含 nq 的会话不产生任何结果。
          const sessionsWithResults = new Set(results.map((r) => r.sessionId));
          for (const { session, messages } of corpus) {
            const anyHit =
              matchesQuery(session.title, nq) || messages.some((m) => matchesQuery(m.content, nq));
            if (!anyHit) {
              expect(sessionsWithResults.has(session.id)).toBe(false);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: searchCorpus（排序确定性）
// ---------------------------------------------------------------------------

describe('searchCorpus — ordering', () => {
  it('Property 5: 结果排序确定性', () => {
    // Feature: chat-history-search, Property 5: 结果排序确定性
    fc.assert(
      fc.property(
        safeQueryArb.chain((q) => fc.tuple(fc.constant(q), rawCorpusArb(q))),
        ([q, raw]) => {
          const corpus = buildCorpus(raw);
          const results = searchCorpus(corpus, q);

          // (1) 整体按 updatedAt 降序。
          for (let i = 1; i < results.length; i++) {
            expect(results[i - 1].updatedAt >= results[i].updatedAt).toBe(true);
          }

          // 同一会话的结果应连续成块；校验块内顺序与块间稳定性。
          // 收集结果中会话块出现顺序（连续相同 sessionId 视为一块）。
          const blockOrder: string[] = [];
          for (const r of results) {
            if (blockOrder.length === 0 || blockOrder[blockOrder.length - 1] !== r.sessionId) {
              blockOrder.push(r.sessionId);
            }
          }
          // 每个 sessionId 至多出现一个块（连续）。
          expect(new Set(blockOrder).size).toBe(blockOrder.length);

          // (2) 块内：title 先于全部 message，message 按追加顺序。
          const corpusBySession = new Map(corpus.map((e) => [e.session.id, e]));
          for (const sid of blockOrder) {
            const block = results.filter((r) => r.sessionId === sid);
            const titleIdxs = block
              .map((r, i) => (r.matchType === 'title' ? i : -1))
              .filter((i) => i >= 0);
            const msgIdxs = block
              .map((r, i) => (r.matchType === 'message' ? i : -1))
              .filter((i) => i >= 0);
            // 至多一条 title，且若存在排在最前。
            expect(titleIdxs.length).toBeLessThanOrEqual(1);
            if (titleIdxs.length === 1) {
              expect(titleIdxs[0]).toBe(0);
            }
            // message 之间按会话内消息追加顺序。
            const entry = corpusBySession.get(sid)!;
            const appendOrder = entry.messages.map((m) => m.id);
            const blockMsgIds = msgIdxs.map((i) => block[i].messageId!);
            const sortedByAppend = [...blockMsgIds].sort(
              (a, b) => appendOrder.indexOf(a) - appendOrder.indexOf(b),
            );
            expect(blockMsgIds).toEqual(sortedByAppend);
          }

          // (3) 相等 updatedAt 的会话块保持语料内相对次序（稳定）。
          const corpusSessionOrder = corpus.map((e) => e.session.id);
          const updatedAtOf = new Map(corpus.map((e) => [e.session.id, e.session.updatedAt]));
          // 按 updatedAt 分组，逐组比较块顺序与语料顺序。
          const groups = new Map<string, string[]>();
          for (const sid of blockOrder) {
            const ua = updatedAtOf.get(sid)!;
            if (!groups.has(ua)) groups.set(ua, []);
            groups.get(ua)!.push(sid);
          }
          for (const [ua, sids] of groups) {
            const corpusSubseq = corpusSessionOrder.filter(
              (id) => updatedAtOf.get(id) === ua && sids.includes(id),
            );
            expect(sids).toEqual(corpusSubseq);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8: searchCorpus（只读）
// ---------------------------------------------------------------------------

describe('searchCorpus — read-only', () => {
  it('Property 8: 检索只读', () => {
    // Feature: chat-history-search, Property 8: 检索只读
    fc.assert(
      fc.property(
        fc.oneof(safeQueryArb, whitespaceOnlyQueryArb, fc.constant('')),
        safeQueryArb.chain((q) => rawCorpusArb(q)),
        (query, raw) => {
          const corpus = buildCorpus(raw);
          const before = structuredClone(corpus);
          searchCorpus(corpus, query);
          // 调用前后语料深相等，未被修改。
          expect(corpus).toEqual(before);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// 1.10 边界单元测试
// ---------------------------------------------------------------------------

describe('pure function boundaries', () => {
  it('normalizeQuery 处理空串与纯空白', () => {
    expect(normalizeQuery('')).toBe('');
    expect(normalizeQuery('   ')).toBe('');
    expect(normalizeQuery('\t\n ')).toBe('');
    expect(normalizeQuery('  hi  ')).toBe('hi');
  });

  it('matchesQuery 空查询不匹配任何文本', () => {
    expect(matchesQuery('anything', '')).toBe(false);
    expect(matchesQuery('', '')).toBe(false);
  });

  it('matchesQuery 大小写不敏感子串', () => {
    expect(matchesQuery('Hello World', 'hello')).toBe(true);
    expect(matchesQuery('Hello World', 'WORLD')).toBe(true);
    expect(matchesQuery('Hello World', 'xyz')).toBe(false);
  });

  it('computeHighlights 无匹配返回空', () => {
    expect(computeHighlights('abcdef', 'xyz')).toEqual([]);
  });

  it('computeHighlights 空查询返回空', () => {
    expect(computeHighlights('abcdef', '')).toEqual([]);
  });

  it('computeHighlights 相邻匹配不重叠', () => {
    // "aaaa" 中查找 "aa"：左到右跳过整段 -> 两处 [0,2],[2,4]。
    expect(computeHighlights('aaaa', 'aa')).toEqual([
      { start: 0, length: 2 },
      { start: 2, length: 2 },
    ]);
  });

  it('computeHighlights 大小写不敏感并按码点定位', () => {
    expect(computeHighlights('aXbXc', 'x')).toEqual([
      { start: 1, length: 1 },
      { start: 3, length: 1 },
    ]);
  });

  it('buildSnippet 短文本返回整段', () => {
    expect(buildSnippet('short text', 'text')).toBe('short text');
  });

  it('buildSnippet 未命中返回前缀并截断到上限', () => {
    const text = 'a'.repeat(150);
    const snippet = buildSnippet(text, 'zzz');
    expect(Array.from(snippet).length).toBe(SNIPPET_MAX_LENGTH);
    expect(snippet).toBe('a'.repeat(SNIPPET_MAX_LENGTH));
  });

  it('buildSnippet 命中跨截断边界时保留匹配子串', () => {
    // 匹配位于文本末尾，超长文本截断后仍包含匹配。
    const text = 'x'.repeat(120) + 'NEEDLE';
    const snippet = buildSnippet(text, 'needle');
    expect(Array.from(snippet).length).toBeLessThanOrEqual(SNIPPET_MAX_LENGTH);
    expect(matchesQuery(snippet, 'needle')).toBe(true);
  });

  it('buildSnippet 多字节（emoji / 代理对）切片不破坏字符', () => {
    // 每个 emoji 是一个码点（代理对）；构造超长文本并定位匹配。
    const text = '😀'.repeat(120) + '关键词';
    const snippet = buildSnippet(text, '关键词');
    const cps = Array.from(snippet);
    expect(cps.length).toBeLessThanOrEqual(SNIPPET_MAX_LENGTH);
    // 切片以码点为单位，emoji 不被截成半个代理对。
    for (const c of cps) {
      expect(c === '😀' || ['关', '键', '词'].includes(c)).toBe(true);
    }
    expect(matchesQuery(snippet, '关键词')).toBe(true);
  });

  it('computeHighlights 多字节定位以码点为单位', () => {
    // "😀关😀关" 中查找 "关"：码点下标 1 与 3。
    expect(computeHighlights('😀关😀关', '关')).toEqual([
      { start: 1, length: 1 },
      { start: 3, length: 1 },
    ]);
  });
});
