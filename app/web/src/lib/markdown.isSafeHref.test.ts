// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { isSafeHref } from '@/lib/markdown';

/**
 * Property-based test for `isSafeHref` in `lib/markdown.ts`.
 * 复用项目既有 fast-check@3.23.2，每条属性至少运行 100 次随机迭代。
 */

// ---------------------------------------------------------------------------
// Generators & test-local oracles
// ---------------------------------------------------------------------------

/** 安全协议白名单（与实现保持一致），大小写无关。 */
const SAFE_PROTOCOLS = ['http', 'https', 'mailto'] as const;

/** 不安全协议样例（应被拒绝）。 */
const UNSAFE_PROTOCOLS = [
  'javascript',
  'data',
  'vbscript',
  'file',
  'ftp',
  'blob',
  'tel',
  'ssh',
] as const;

/** 随机大小写翻转，验证协议比对大小写不敏感。 */
type CaseMode = 'asis' | 'upper' | 'lower' | 'mixed';
const caseModeArb = fc.constantFrom<CaseMode>('asis', 'upper', 'lower', 'mixed');
function applyCase(s: string, mode: CaseMode): string {
  if (mode === 'upper') return s.toUpperCase();
  if (mode === 'lower') return s.toLowerCase();
  if (mode === 'mixed') {
    return Array.from(s)
      .map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()))
      .join('');
  }
  return s;
}

/** URL 尾部任意路径/主机片段（不含空白与冒号，避免引入额外协议段歧义）。 */
const tailArb = fc.stringOf(
  fc.constantFrom(
    'a', 'b', 'c', 'X', 'Y', '0', '1', '/', '.', '-', '_', '@', '?', '=', '&',
  ),
  { maxLength: 20 },
);

describe('isSafeHref', () => {
  it('Property 6: 链接协议安全判定', () => {
    // Feature: markdown-message-rendering, Property 6: 链接协议安全判定 —— 当且仅当协议为 http/https/mailto（或无协议的相对/锚点地址）时 isSafeHref 返回 true；javascript:/data:/vbscript: 等返回 false
    fc.assert(
      fc.property(
        fc.oneof(
          // (1) 安全协议：scheme://tail —— 期望 true
          fc.record({
            kind: fc.constant<'safe'>('safe'),
            scheme: fc.constantFrom(...SAFE_PROTOCOLS),
            mode: caseModeArb,
            tail: tailArb,
          }),
          // (2) 不安全协议：scheme:tail —— 期望 false
          fc.record({
            kind: fc.constant<'unsafe'>('unsafe'),
            scheme: fc.constantFrom(...UNSAFE_PROTOCOLS),
            mode: caseModeArb,
            tail: tailArb,
          }),
          // (3) 无协议相对地址（不以 scheme: 开头）—— 期望 true
          fc.record({
            kind: fc.constant<'relative'>('relative'),
            tail: tailArb,
          }),
          // (4) 锚点地址 —— 期望 true
          fc.record({
            kind: fc.constant<'anchor'>('anchor'),
            tail: tailArb,
          }),
        ),
        (input) => {
          if (input.kind === 'safe') {
            const href = `${applyCase(input.scheme, input.mode)}://${input.tail}`;
            expect(isSafeHref(href)).toBe(true);
          } else if (input.kind === 'unsafe') {
            const href = `${applyCase(input.scheme, input.mode)}:${input.tail}`;
            expect(isSafeHref(href)).toBe(false);
          } else if (input.kind === 'relative') {
            // 相对路径，确保不以 "字母...:" 协议段开头
            const href = `/path/${input.tail}`;
            expect(isSafeHref(href)).toBe(true);
          } else {
            const href = `#${input.tail}`;
            expect(isSafeHref(href)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // 边界与回归示例
  it('接受 http/https/mailto 协议', () => {
    expect(isSafeHref('http://example.com')).toBe(true);
    expect(isSafeHref('https://example.com/path?q=1')).toBe(true);
    expect(isSafeHref('mailto:user@example.com')).toBe(true);
    expect(isSafeHref('HTTPS://EXAMPLE.COM')).toBe(true);
  });

  it('拒绝 javascript / data / vbscript 协议', () => {
    expect(isSafeHref('javascript:alert(1)')).toBe(false);
    expect(isSafeHref('data:text/html,<script>')).toBe(false);
    expect(isSafeHref('vbscript:msgbox')).toBe(false);
    // 控制字符/空白拆分协议的绕过手法也应被拒绝
    expect(isSafeHref('java\tscript:alert(1)')).toBe(false);
    expect(isSafeHref('java\nscript:alert(1)')).toBe(false);
  });

  it('放行无协议的相对地址与锚点', () => {
    expect(isSafeHref('/relative/path')).toBe(true);
    expect(isSafeHref('relative.html')).toBe(true);
    expect(isSafeHref('#section')).toBe(true);
    expect(isSafeHref('')).toBe(true);
    expect(isSafeHref('//host/path')).toBe(true);
  });

  it('非字符串输入按不安全处理', () => {
    expect(isSafeHref(undefined)).toBe(false);
    expect(isSafeHref(null)).toBe(false);
    expect(isSafeHref(123)).toBe(false);
  });
});
