import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  parseKeyCombo,
  formatKeyCombo,
  keyComboEquals,
  type KeyCombo,
  type Platform,
} from './keyCombo';

/** 主键候选集合（规范化小写主键），用于构造合法 KeyCombo。 */
const PRIMARY_KEYS = ['k', 'p', 'enter', 'arrowdown', 'arrowup', 'escape', '/', 'a', '1'] as const;

const PLATFORMS: Platform[] = ['mac', 'other'];

describe('keyCombo — 属性测试', () => {
  // Feature: command-palette, Property 2: Key_Combo 解析/格式化往返与规范幂等
  it('Property 2: parse(format(x)) == x（往返）、parse(format(parse(s))) == parse(s)（规范幂等）、纯性', () => {
    // 直接构造规范 KeyCombo（具体 ctrl/meta 标志，规避 mod 别名歧义）。
    const comboArb = fc.record({
      ctrl: fc.boolean(),
      meta: fc.boolean(),
      shift: fc.boolean(),
      alt: fc.boolean(),
      key: fc.constantFrom(...PRIMARY_KEYS),
    });

    for (const platform of PLATFORMS) {
      // 往返：parse(format(x)) 结构等于 x。
      fc.assert(
        fc.property(comboArb, (x: KeyCombo) => {
          const roundTripped = parseKeyCombo(formatKeyCombo(x), platform);
          expect(roundTripped).not.toBeNull();
          expect(keyComboEquals(roundTripped!, x)).toBe(true);
          // 纯性/确定性：两次调用结果相等。
          expect(formatKeyCombo(x)).toBe(formatKeyCombo(x));
          expect(parseKeyCombo(formatKeyCombo(x), platform)).toEqual(roundTripped);
        }),
        { numRuns: 100 },
      );

      // 规范幂等：从修饰键 token 子集（随机大小写/顺序/多余空白）+ 一个主键拼出合法字符串 s。
      const modifierTokenArb = fc.subarray(['ctrl', 'meta', 'shift', 'alt']);
      const messyStringArb = fc
        .tuple(modifierTokenArb, fc.constantFrom(...PRIMARY_KEYS), fc.array(fc.boolean(), { maxLength: 6 }))
        .map(([mods, key, casing]) => {
          const tokens = [...mods, key];
          // 随机大小写 + 在 '+' 周围插入多余空白。
          return tokens
            .map((tok, i) => (casing[i] ? tok.toUpperCase() : tok))
            .join(' + ');
        });

      fc.assert(
        fc.property(messyStringArb, (s) => {
          const parsed = parseKeyCombo(s, platform);
          expect(parsed).not.toBeNull();
          const canonicalParsed = parseKeyCombo(formatKeyCombo(parsed!), platform);
          expect(canonicalParsed).toEqual(parsed);
          // 纯性/确定性：两次解析结果相等。
          expect(parseKeyCombo(s, platform)).toEqual(parsed);
        }),
        { numRuns: 100 },
      );
    }
  });
});

describe('keyCombo — 边界单元测试', () => {
  it('非法输入返回 null（Req 7.2）', () => {
    expect(parseKeyCombo('', 'mac')).toBeNull();
    expect(parseKeyCombo('   ', 'mac')).toBeNull();
    expect(parseKeyCombo('ctrl+', 'mac')).toBeNull(); // 缺主键
    expect(parseKeyCombo('foo+k', 'mac')).toBeNull(); // 未知 token
    expect(parseKeyCombo('a+b', 'mac')).toBeNull(); // 重复主键
    expect(parseKeyCombo('ctrl+shift', 'mac')).toBeNull(); // 仅修饰键
  });

  it('mod 平台归一（Req 7.6）', () => {
    const mac = parseKeyCombo('mod+k', 'mac');
    expect(mac).not.toBeNull();
    expect(mac!.meta).toBe(true);
    expect(mac!.ctrl).toBe(false);

    const other = parseKeyCombo('mod+k', 'other');
    expect(other).not.toBeNull();
    expect(other!.ctrl).toBe(true);
    expect(other!.meta).toBe(false);
  });

  it('formatKeyCombo 固定顺序（Req 7.3）', () => {
    expect(formatKeyCombo({ ctrl: true, meta: true, shift: true, alt: true, key: 'p' })).toBe(
      'ctrl+meta+shift+alt+p',
    );
    expect(formatKeyCombo({ ctrl: true, meta: false, shift: true, alt: false, key: 'p' })).toBe(
      'ctrl+shift+p',
    );
  });

  it('忽略大小写与多余空白（Req 7.1）', () => {
    expect(parseKeyCombo('  CTRL + K  ', 'other')).toEqual({
      ctrl: true,
      meta: false,
      shift: false,
      alt: false,
      key: 'k',
    });
  });
});
