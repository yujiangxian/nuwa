import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { ChatSession } from '@/store/uiStore';
import {
  GROUP_ORDER,
  GROUP_TITLES,
  type GroupKind,
  isPinned,
  normalizePinned,
  togglePinnedIn,
  setPinnedIn,
  dayDiff,
  bucketOf,
  organizeSessions,
} from '@/lib/sessionOrganize';

/**
 * Property-based tests for the pure organize logic in `lib/sessionOrganize.ts`.
 * Each property uses fast-check with at least 100 iterations and is tagged with
 * its design-document Property number.
 */

// ---------------------------------------------------------------------------
// Generators & helpers
// ---------------------------------------------------------------------------

const tokenArb = fc.string({ maxLength: 8 });

/** ISO 时间戳生成器，覆盖一个较宽的合法区间。 */
const isoArb = fc
  .date({ min: new Date('2000-01-01T00:00:00.000Z'), max: new Date('2100-01-01T00:00:00.000Z') })
  .map((d) => d.toISOString());

/**
 * `pinned` 三态：true / false / 省略（undefined）。
 * 用 `Partial` 让 record 可缺省 `pinned`，覆盖归一与置顶判定的全部分支。
 */
const pinnedArb = fc.oneof(
  fc.constant<true>(true),
  fc.constant<false>(false),
  fc.constant<undefined>(undefined),
);

/** 生成一条会话（pinned 可能缺失）。供 normalizePinned / toggle 测试使用。 */
function rawSessionArb(id: string): fc.Arbitrary<ChatSession> {
  return fc
    .record({
      title: tokenArb,
      characterId: tokenArb,
      voiceId: tokenArb,
      updatedAt: isoArb,
      pinned: pinnedArb,
    })
    .map((r) => {
      const s: ChatSession = {
        id,
        title: r.title,
        characterId: r.characterId,
        voiceId: r.voiceId,
        updatedAt: r.updatedAt,
        // 故意保留 undefined 以覆盖「缺失字段」分支：仅当为布尔时写入。
        ...(r.pinned === undefined ? {} : { pinned: r.pinned }),
      } as ChatSession;
      return s;
    });
}

/** id 唯一的会话数组。 */
const sessionsArb = fc.uniqueArray(
  fc.string({ minLength: 1, maxLength: 6 }).chain((id) => rawSessionArb(id)),
  { selector: (s) => s.id, maxLength: 8 },
);

/** 测试本地 oracle：仅 pinned===true 视为置顶。 */
function pinnedOracle(s: ChatSession): boolean {
  return s.pinned === true;
}

// ---------------------------------------------------------------------------
// Property 1: normalizePinned
// ---------------------------------------------------------------------------

describe('normalizePinned', () => {
  it('Property 1: 缺省归一', () => {
    // Feature: chat-session-organization, Property 1: 缺省归一
    fc.assert(
      fc.property(rawSessionArb('s0'), (session) => {
        const before = structuredClone(session);
        const out = normalizePinned(session);

        // pinned 归一为布尔，且与「原 pinned===true」一致。
        expect(typeof out.pinned).toBe('boolean');
        expect(out.pinned).toBe(session.pinned === true);
        // 其余字段保持不变。
        expect(out.id).toBe(session.id);
        expect(out.title).toBe(session.title);
        expect(out.characterId).toBe(session.characterId);
        expect(out.voiceId).toBe(session.voiceId);
        expect(out.updatedAt).toBe(session.updatedAt);
        // 不修改入参。
        expect(session).toEqual(before);
        // 幂等：对已含布尔 pinned 的会话再次归一结果相同。
        const again = normalizePinned(out);
        expect(again).toEqual(out);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: togglePinnedIn / setPinnedIn
// ---------------------------------------------------------------------------

describe('togglePinnedIn / setPinnedIn', () => {
  it('Property 2: 置顶切换局部性', () => {
    // Feature: chat-session-organization, Property 2: 置顶切换局部性
    fc.assert(
      fc.property(
        sessionsArb,
        fc.string({ minLength: 1, maxLength: 6 }),
        fc.boolean(),
        fc.boolean(),
        (sessions, maybeId, useExistingId, setValue) => {
          // 50% 概率命中一个已存在的 id（数组非空时），否则用随机（可能未命中）id。
          const id =
            useExistingId && sessions.length > 0
              ? sessions[Math.floor((sessions.length - 1) / 2)].id
              : maybeId;

          const before = structuredClone(sessions);

          // --- togglePinnedIn ---
          const toggled = togglePinnedIn(sessions, id);
          // 入参不被修改。
          expect(sessions).toEqual(before);
          // 长度一致。
          expect(toggled.length).toBe(sessions.length);
          toggled.forEach((out, i) => {
            const orig = sessions[i];
            if (orig.id === id) {
              // 命中：pinned 相对原 isPinned 取反，其余字段不变。
              expect(out.pinned).toBe(!pinnedOracle(orig));
              expect(out.id).toBe(orig.id);
              expect(out.title).toBe(orig.title);
              expect(out.characterId).toBe(orig.characterId);
              expect(out.voiceId).toBe(orig.voiceId);
              expect(out.updatedAt).toBe(orig.updatedAt);
            } else {
              // 非命中：与原会话深相等。
              expect(out).toEqual(orig);
            }
          });

          // --- setPinnedIn ---
          const set = setPinnedIn(sessions, id, setValue);
          expect(sessions).toEqual(before);
          expect(set.length).toBe(sessions.length);
          set.forEach((out, i) => {
            const orig = sessions[i];
            if (orig.id === id) {
              expect(out.pinned).toBe(setValue);
              expect(out.title).toBe(orig.title);
              expect(out.characterId).toBe(orig.characterId);
              expect(out.voiceId).toBe(orig.voiceId);
              expect(out.updatedAt).toBe(orig.updatedAt);
            } else {
              expect(out).toEqual(orig);
            }
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: organizeSessions — 划分唯一性与归属
// ---------------------------------------------------------------------------

const currentTimeArb = fc
  .date({ min: new Date('2000-01-01T00:00:00.000Z'), max: new Date('2100-01-01T00:00:00.000Z') });

describe('organizeSessions — partition', () => {
  it('Property 3: 划分唯一性与归属', () => {
    // Feature: chat-session-organization, Property 3: 划分唯一性与归属
    fc.assert(
      fc.property(sessionsArb, currentTimeArb, (sessions, now) => {
        const groups = organizeSessions(sessions, now);

        // 输出展开的全部会话 id 多重集合 == 输入会话 id 多重集合。
        const outIds = groups.flatMap((g) => g.sessions.map((s) => s.id)).sort();
        const inIds = sessions.map((s) => s.id).sort();
        expect(outIds).toEqual(inIds);

        // Pinned_Group 恰含全部 pinned===true 会话。
        const pinnedGroup = groups.find((g) => g.kind === 'pinned');
        const pinnedIds = (pinnedGroup?.sessions ?? []).map((s) => s.id).sort();
        const expectedPinned = sessions.filter(pinnedOracle).map((s) => s.id).sort();
        expect(pinnedIds).toEqual(expectedPinned);

        // 未置顶会话恰出现在某个 Time_Bucket，且不在 Pinned_Group。
        const pinnedIdSet = new Set(pinnedIds);
        for (const g of groups) {
          for (const s of g.sessions) {
            if (g.kind === 'pinned') {
              expect(pinnedOracle(s)).toBe(true);
            } else {
              expect(pinnedOracle(s)).toBe(false);
              expect(pinnedIdSet.has(s.id)).toBe(false);
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: bucketOf 与归桶一致性
// ---------------------------------------------------------------------------

/** oracle：与设计文档一致的分桶映射。 */
function bucketOracle(d: number): Exclude<GroupKind, 'pinned'> {
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d <= 6) return 'last7';
  if (d <= 29) return 'last30';
  return 'earlier';
}

describe('bucketOf / organizeSessions — bucketing', () => {
  it('Property 4: 分桶边界', () => {
    // Feature: chat-session-organization, Property 4: 分桶边界
    fc.assert(
      fc.property(
        fc.integer({ min: -100, max: 200 }),
        (d) => {
          expect(bucketOf(d)).toBe(bucketOracle(d));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 4: 归桶等于 bucketOf(dayDiff(...))（未置顶会话）', () => {
    // Feature: chat-session-organization, Property 4: 分桶边界
    fc.assert(
      fc.property(
        // 由 Current_Time 反推 updatedAt：落在 currentTime 当日零点 - dayOffset 天的随机时刻。
        currentTimeArb,
        fc.array(fc.integer({ min: -3, max: 60 }), { minLength: 1, maxLength: 8 }),
        (now, offsets) => {
          const startOfNow = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
          const sessions: ChatSession[] = offsets.map((off, i) => {
            // 取该日历日的中午 12:00（本地），避免 DST 边界把日历日算偏。
            const day = new Date(startOfNow - off * 86_400_000);
            const noon = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0, 0);
            return {
              id: `s${i}`,
              title: 't',
              characterId: 'c',
              voiceId: 'v',
              updatedAt: noon.toISOString(),
              pinned: false,
            };
          });

          const groups = organizeSessions(sessions, now);
          // 每条会话在输出中所属的 bucket。
          const bucketOfSession = new Map<string, GroupKind>();
          for (const g of groups) {
            for (const s of g.sessions) bucketOfSession.set(s.id, g.kind);
          }

          for (const s of sessions) {
            const expected = bucketOf(dayDiff(s.updatedAt, now));
            expect(bucketOfSession.get(s.id)).toBe(expected);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: organizeSessions — 组内降序与稳定
// ---------------------------------------------------------------------------

/** 制造大量相等 updatedAt：从小池取值。 */
const updatedAtPoolArb = fc.constantFrom(
  '2024-01-01T00:00:00.000Z',
  '2024-01-01T00:00:00.000Z',
  '2024-03-15T08:30:00.000Z',
  '2024-03-15T08:30:00.000Z',
  '2024-06-20T12:00:00.000Z',
);

const stableSessionsArb = fc.array(
  fc.record({
    title: tokenArb,
    updatedAt: updatedAtPoolArb,
    pinned: fc.boolean(),
  }),
  { maxLength: 12 },
).map((rows) =>
  rows.map((r, i): ChatSession => ({
    id: `s${i}`,
    title: r.title,
    characterId: 'c',
    voiceId: 'v',
    updatedAt: r.updatedAt,
    pinned: r.pinned,
  })),
);

describe('organizeSessions — in-group ordering & stability', () => {
  it('Property 5: 组内降序与稳定', () => {
    // Feature: chat-session-organization, Property 5: 组内降序与稳定
    fc.assert(
      fc.property(stableSessionsArb, currentTimeArb, (sessions, now) => {
        const groups = organizeSessions(sessions, now);
        // 输入中每个会话的下标，用于校验稳定性。
        const inputIndex = new Map(sessions.map((s, i) => [s.id, i]));

        for (const g of groups) {
          // (1) updatedAt 非递增。
          for (let i = 1; i < g.sessions.length; i++) {
            expect(g.sessions[i - 1].updatedAt >= g.sessions[i].updatedAt).toBe(true);
          }
          // (2) 相等 updatedAt 的会话保持输入相对次序（稳定）。
          for (let i = 1; i < g.sessions.length; i++) {
            if (g.sessions[i - 1].updatedAt === g.sessions[i].updatedAt) {
              expect(inputIndex.get(g.sessions[i - 1].id)!).toBeLessThan(
                inputIndex.get(g.sessions[i].id)!,
              );
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6: organizeSessions — 组间顺序与无空组
// ---------------------------------------------------------------------------

describe('organizeSessions — group order & no empty groups', () => {
  it('Property 6: 组间顺序与无空组', () => {
    // Feature: chat-session-organization, Property 6: 组间顺序与无空组
    fc.assert(
      fc.property(sessionsArb, currentTimeArb, (sessions, now) => {
        const groups = organizeSessions(sessions, now);

        // (1) kind 序列是 GROUP_ORDER 的子序列（保持固定顺序）。
        const kinds = groups.map((g) => g.kind);
        let cursor = 0;
        for (const k of kinds) {
          const idx = GROUP_ORDER.indexOf(k, cursor);
          expect(idx).toBeGreaterThanOrEqual(cursor);
          cursor = idx + 1;
        }
        // kinds 各不重复。
        expect(new Set(kinds).size).toBe(kinds.length);

        // (2) 每组非空，且 title 与 GROUP_TITLES 一致。
        for (const g of groups) {
          expect(g.sessions.length).toBeGreaterThan(0);
          expect(g.title).toBe(GROUP_TITLES[g.kind]);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: organizeSessions — 只读
// ---------------------------------------------------------------------------

describe('organizeSessions — read-only', () => {
  it('Property 7: 只读', () => {
    // Feature: chat-session-organization, Property 7: 只读
    fc.assert(
      fc.property(sessionsArb, currentTimeArb, (sessions, now) => {
        const before = structuredClone(sessions);
        organizeSessions(sessions, now);
        // 调用前后输入数组及每个会话深相等，未被修改。
        expect(sessions).toEqual(before);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8: organizeSessions — 确定性
// ---------------------------------------------------------------------------

describe('organizeSessions — determinism', () => {
  it('Property 8: 确定性', () => {
    // Feature: chat-session-organization, Property 8: 确定性
    fc.assert(
      fc.property(sessionsArb, currentTimeArb, (sessions, now) => {
        const a = organizeSessions(sessions, now);
        const b = organizeSessions(sessions, now);
        // 两次调用结构与顺序深相等。
        expect(a).toEqual(b);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// 1.10 边界单元测试
// ---------------------------------------------------------------------------

describe('boundary unit tests', () => {
  function mk(updatedAt: string, pinned = false): ChatSession {
    return { id: 'x', title: 't', characterId: 'c', voiceId: 'v', updatedAt, pinned };
  }

  it('dayDiff 同日为 0', () => {
    const now = new Date(2024, 5, 15, 18, 0, 0);
    const sameDay = new Date(2024, 5, 15, 1, 0, 0).toISOString();
    expect(dayDiff(sameDay, now)).toBe(0);
  });

  it('dayDiff 昨日为 1', () => {
    const now = new Date(2024, 5, 15, 0, 30, 0);
    const yesterday = new Date(2024, 5, 14, 23, 30, 0).toISOString();
    expect(dayDiff(yesterday, now)).toBe(1);
  });

  it('dayDiff 跨夏令时日仍为整日数', () => {
    // 选取美国 DST 切换附近（2024-03-10 为美国 DST 开始）。以本地零点之差 + round
    // 保证返回整数天差，不受 23h/25h 影响。
    const now = new Date(2024, 2, 12, 10, 0, 0); // 3 月 12 日
    const before = new Date(2024, 2, 9, 10, 0, 0).toISOString(); // 3 月 9 日
    expect(dayDiff(before, now)).toBe(3);
  });

  it('dayDiff 非法 ISO 返回 +Infinity', () => {
    const now = new Date(2024, 5, 15);
    expect(dayDiff('not-a-date', now)).toBe(Number.POSITIVE_INFINITY);
  });

  it('bucketOf 具体边界值', () => {
    expect(bucketOf(0)).toBe('today');
    expect(bucketOf(1)).toBe('yesterday');
    expect(bucketOf(2)).toBe('last7');
    expect(bucketOf(6)).toBe('last7');
    expect(bucketOf(7)).toBe('last30');
    expect(bucketOf(29)).toBe('last30');
    expect(bucketOf(30)).toBe('earlier');
  });

  it('organizeSessions 空数组返回 []', () => {
    expect(organizeSessions([], new Date())).toEqual([]);
  });

  it('organizeSessions 全置顶只产生 pinned 组', () => {
    const now = new Date(2024, 5, 15);
    const sessions = [mk(new Date(2020, 0, 1).toISOString(), true), mk(now.toISOString(), true)];
    sessions[0].id = 'a';
    sessions[1].id = 'b';
    const groups = organizeSessions(sessions, now);
    expect(groups.length).toBe(1);
    expect(groups[0].kind).toBe('pinned');
    expect(groups[0].sessions.length).toBe(2);
  });

  it('organizeSessions 全未置顶不产生 pinned 组', () => {
    const now = new Date(2024, 5, 15, 12, 0, 0);
    const s = mk(new Date(2024, 5, 15, 1, 0, 0).toISOString(), false);
    const groups = organizeSessions([s], now);
    expect(groups.find((g) => g.kind === 'pinned')).toBeUndefined();
    expect(groups[0].kind).toBe('today');
  });

  it('organizeSessions 未来时间戳归入 today', () => {
    const now = new Date(2024, 5, 15, 12, 0, 0);
    const future = new Date(2024, 5, 18, 12, 0, 0).toISOString(); // 3 天后
    const groups = organizeSessions([mk(future, false)], now);
    expect(groups[0].kind).toBe('today');
  });

  it('isPinned 仅 true 视为置顶', () => {
    expect(isPinned(mk('2024-01-01T00:00:00.000Z', true))).toBe(true);
    expect(isPinned(mk('2024-01-01T00:00:00.000Z', false))).toBe(false);
    // 缺失字段（运行时可能出现的旧数据）。
    const noField = { id: 'x', title: 't', characterId: 'c', voiceId: 'v', updatedAt: '2024-01-01T00:00:00.000Z' } as ChatSession;
    expect(isPinned(noField)).toBe(false);
  });
});
