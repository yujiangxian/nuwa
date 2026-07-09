// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  parseStreamLines,
  parseChunk,
  accumulateDelta,
  consumeChatStream,
  shouldPersistFinal,
  type StreamChunk,
} from '@/lib/streamChat';

/**
 * Property-based tests for the streaming-chat-output frontend parse layer.
 * Each property maps to a design Correctness Property; numRuns >= 100.
 */

// A char generator that mixes ASCII, whitespace, newlines and multi-byte
// characters so framing/round-trip is exercised against tricky inputs.
const richChar = fc.constantFrom(
  'a', 'b', 'Z', '1', ' ', '\t', '\n',
  '{', '}', '"', ':', ',', '\\',
  '你', '好', '界',
  '😀', '🎉',
  'é', 'ñ',
);
const textArb = fc.stringOf(richChar, { maxLength: 60 });

describe('parseStreamLines', () => {
  it('Property 1: 分帧 round-trip 与切分无关性（confluence）', () => {
    // Feature: streaming-chat-output, Property 1: NDJSON 分帧 round-trip 与切分无关性（confluence）
    // Validates: Requirements 1.4, 1.5, 2.2
    fc.assert(
      fc.property(
        textArb,
        // 任意切分序列：把文本随机切成若干片段。
        fc.array(fc.integer({ min: 0, max: 60 }), { maxLength: 8 }),
        (text, rawCuts) => {
          // round-trip：一次性分帧后可重构原文（split/join 互逆）。
          const oneShot = parseStreamLines(text);
          expect([...oneShot.lines, oneShot.rest].join('\n')).toBe(text);

          // 由切点构造有序的片段边界。
          const points = Array.from(new Set(rawCuts.map((c) => c % (text.length + 1))))
            .sort((a, b) => a - b);
          const bounds = [0, ...points.filter((p) => p > 0 && p < text.length), text.length];
          const chunks: string[] = [];
          for (let i = 0; i < bounds.length - 1; i++) {
            chunks.push(text.slice(bounds[i], bounds[i + 1]));
          }

          // confluence：分片逐次喂入（保留 leftover 作下次前缀），
          // 所得完整行序列与最终 leftover == 一次性分帧结果。
          let leftover = '';
          const collected: string[] = [];
          for (const chunk of chunks) {
            leftover += chunk;
            const { lines, rest } = parseStreamLines(leftover);
            collected.push(...lines);
            leftover = rest;
          }

          expect(collected).toEqual(oneShot.lines);
          expect(leftover).toBe(oneShot.rest);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('parseChunk', () => {
  // 恰含 delta / done / error 之一的合法块。
  const exclusiveChunkArb: fc.Arbitrary<StreamChunk> = fc.oneof(
    fc.record({ delta: fc.string() }),
    fc.record({ done: fc.boolean() }),
    fc.record({ error: fc.string() }),
  );

  it('Property 2: Stream_Chunk 协议序列化/解析 round-trip', () => {
    // Feature: streaming-chat-output, Property 2: Stream_Chunk 协议序列化/解析 round-trip
    // Validates: Requirements 1.4, 6.1
    fc.assert(
      fc.property(exclusiveChunkArb, (chunk) => {
        const line = JSON.stringify(chunk);
        const parsed = parseChunk(line);
        // 语义等价：往返后字段与值不变（含转义、done 的 true/false、空字符串）。
        expect(parsed).toEqual(chunk);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 2: 非法 JSON 行解析为空块 {}', () => {
    // Feature: streaming-chat-output, Property 2: 非法 JSON 行 -> {}（被消费逻辑忽略）
    // Validates: Requirements 1.4, 6.1
    fc.assert(
      fc.property(fc.string(), (line) => {
        let validObject = false;
        try {
          const v: unknown = JSON.parse(line);
          validObject = typeof v === 'object' && v !== null && !Array.isArray(v);
        } catch {
          validObject = false;
        }
        const result = parseChunk(line);
        // parseChunk 永不抛错；非「JSON 对象」一律为空块。
        if (!validObject) {
          expect(result).toEqual({});
        }
        // 结果的键必然是已知字段子集，且类型正确。
        for (const key of Object.keys(result)) {
          expect(['delta', 'done', 'error']).toContain(key);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('accumulateDelta', () => {
  // 任意块序列：部分带 delta，部分为 done/error（无 delta）。
  const chunkArb: fc.Arbitrary<StreamChunk> = fc.oneof(
    fc.record({ delta: fc.string() }),
    fc.record({ done: fc.boolean() }),
    fc.record({ error: fc.string() }),
  );

  it('Property 3: 折叠顺序保持（reduce == delta 顺序拼接）', () => {
    // Feature: streaming-chat-output, Property 3: 增量累积顺序保持（含停止时点保留）
    // Validates: Requirements 2.2, 2.5, 3.3
    fc.assert(
      fc.property(fc.array(chunkArb, { maxLength: 30 }), (chunks) => {
        const folded = chunks.reduce((acc, c) => accumulateDelta(acc, c), '');
        const expected = chunks
          .filter((c): c is { delta: string } => typeof c.delta === 'string')
          .map((c) => c.delta)
          .join('');
        expect(folded).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 3: 前 k 个块的折叠 == 前 k 个 delta 的拼接', () => {
    // Feature: streaming-chat-output, Property 3: 前缀折叠等于前缀 delta 拼接（停止时点保留）
    // Validates: Requirements 2.2, 2.5, 3.3
    fc.assert(
      fc.property(
        fc.array(chunkArb, { maxLength: 30 }),
        fc.nat(),
        (chunks, kRaw) => {
          const k = chunks.length === 0 ? 0 : kRaw % (chunks.length + 1);
          const prefix = chunks.slice(0, k);
          const folded = prefix.reduce((acc, c) => accumulateDelta(acc, c), '');
          const expected = prefix
            .filter((c): c is { delta: string } => typeof c.delta === 'string')
            .map((c) => c.delta)
            .join('');
          expect(folded).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// 由 NDJSON 行构造一个 ReadableStream<Uint8Array>，可选地把每行随机切成多段，
// 以模拟真实分块到达（验证管线对切分不敏感）。
// ---------------------------------------------------------------------------
function ndjsonStream(lines: string[], cuts: number[] = []): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const payload = lines.map((l) => l + '\n').join('');
  const bytes = enc.encode(payload);
  // 由切点把字节序列分成有序片段。
  const points = Array.from(new Set(cuts.map((c) => (bytes.length === 0 ? 0 : ((c % (bytes.length + 1)) + bytes.length + 1) % (bytes.length + 1)))))
    .filter((p) => p > 0 && p < bytes.length)
    .sort((a, b) => a - b);
  const bounds = [0, ...points, bytes.length];
  const segments: Uint8Array[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    segments.push(bytes.slice(bounds[i], bounds[i + 1]));
  }
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const seg of segments) controller.enqueue(seg);
      controller.close();
    },
  });
}

describe('consumeChatStream + finalize 定型持久化次数不变式', () => {
  it('Property 6: persist 次数 == 累积非空?1:0，与块数量/切分无关', async () => {
    // Feature: streaming-chat-output, Property 6: 定型持久化次数不变式
    // Validates: Requirements 3.5, 4.4, 6.6
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string(), { maxLength: 30 }),
        fc.array(fc.integer({ min: 0, max: 500 }), { maxLength: 8 }),
        fc.boolean(),
        async (deltas, cuts, withDone) => {
          // 构造任意 delta 序列（可含空串），可选追加一个 done 块作收尾。
          const lines = deltas.map((d) => JSON.stringify({ delta: d }));
          if (withDone) lines.push(JSON.stringify({ done: true }));
          const body = ndjsonStream(lines, cuts);

          // 驱动真实流消费 + 累积，再走定型决策；persistCount 模拟 appendMessage 次数。
          let acc = '';
          let persistCount = 0;
          await consumeChatStream(body, (chunk) => {
            acc = accumulateDelta(acc, chunk);
          });
          if (shouldPersistFinal(acc)) persistCount += 1;

          const expected = deltas.join('').length > 0 ? 1 : 0;
          expect(persistCount).toBe(expected);
          // 累积内容等于所有 delta 顺序拼接（与块数量/切分无关）。
          expect(acc).toBe(deltas.join(''));
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// chat-message-actions - Property 5: 定型持久化次数不变式
// Regenerate_Action / Edit_Resend_Action 与普通发送共用同一定型决策：
// 当且仅当累积内容非空时，恰好追加并持久化一次 assistant Final_Message。
// ---------------------------------------------------------------------------

describe('shouldPersistFinal 定型持久化次数不变式 (chat-message-actions Property 5)', () => {
  it('Property 5: 累积内容非空 -> 恰一次定型；空 -> 零次', () => {
    // Feature: chat-message-actions, Property 5: 定型持久化次数不变式
    // Validates: Requirements 2.4, 2.5, 2.7, 3.7
    fc.assert(
      fc.property(fc.fullUnicodeString({ maxLength: 200 }), (content) => {
        // 模拟定型阶段：shouldPersistFinal 为真时 appendMessage 被调用一次。
        const persistCount = shouldPersistFinal(content) ? 1 : 0;
        const expected = content.length > 0 ? 1 : 0;
        expect(persistCount).toBe(expected);
        // 当且仅当：非空必为真、空必为假。
        expect(shouldPersistFinal(content)).toBe(content.length > 0);
      }),
      { numRuns: 200 },
    );
  });

  it('Property 5: 空字符串不产生定型（零次、不生成空内容消息）', () => {
    // Feature: chat-message-actions, Property 5: 定型持久化次数不变式（空内容边界）
    // Validates: Requirements 2.5
    expect(shouldPersistFinal('')).toBe(false);
  });
});
