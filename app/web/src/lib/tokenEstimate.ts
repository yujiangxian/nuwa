/**
 * context-window-management：Token_Estimator 纯函数层。
 *
 * 对字符串与 ChatMessage 列表给出确定性、单调、非负整数的 Token 估算（启发式按字符）。
 * 所有函数均为纯函数（无 I/O、无副作用），可被 fast-check 属性测试覆盖。
 *
 * 估算启发式：按 Unicode 码点对字符分桶并赋非负权重，求和后 Math.ceil：
 * - CJK / 假名 / 谚文 / 全角符号等「重」字符：权重 1.0（约 1 字符 ≈ 1 token）。
 * - ASCII 及一般拉丁 / 数字 / 空白 / 标点：权重 0.25（约 4 字符 ≈ 1 token）。
 * - 其余字符（其它脚本、emoji 等）：权重 0.5（折中）。
 *
 * 单调性来自权重非负 + Math.ceil 单调不减：estimate(A + B) >= estimate(A)。
 */

import type { ChatMessage } from '@/store/uiStore';

/** 每条消息的固定结构开销（role 包装 + 分隔符），计入消息列表估算。 */
export const MESSAGE_OVERHEAD_TOKENS = 4;

const WEIGHT_HEAVY = 1.0;
const WEIGHT_LIGHT = 0.25;
const WEIGHT_MEDIUM = 0.5;

/** 判定码点是否落在「重」字符（CJK / 假名 / 谚文 / 全角等）区段。 */
function isHeavyCodePoint(cp: number): boolean {
  return (
    (cp >= 0x3000 && cp <= 0x303f) || // CJK 符号与标点
    (cp >= 0x3040 && cp <= 0x309f) || // 平假名
    (cp >= 0x30a0 && cp <= 0x30ff) || // 片假名
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK 扩展 A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK 统一表意文字
    (cp >= 0xac00 && cp <= 0xd7af) || // 谚文音节
    (cp >= 0x1100 && cp <= 0x11ff) || // 谚文字母
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK 兼容表意文字
    (cp >= 0xff00 && cp <= 0xffef) || // 全角 / 半角形式
    (cp >= 0x20000 && cp <= 0x2fa1f) // CJK 扩展 B 及以上
  );
}

/**
 * 单字符权重：依码点分桶返回非负权重。
 * - 重字符（CJK 等）：1.0
 * - ASCII（0x00–0x7f）：0.25
 * - 其余：0.5
 */
export function charWeight(codePoint: number): number {
  if (isHeavyCodePoint(codePoint)) return WEIGHT_HEAVY;
  if (codePoint <= 0x7f) return WEIGHT_LIGHT;
  return WEIGHT_MEDIUM;
}

/**
 * 估算单个字符串的 token 数：对各字符权重求和后向上取整。
 * 用 for...of 按码点遍历（避免代理对被拆成两半导致权重抖动）。
 * 空串返回 0；输出恒为非负整数。
 */
export function estimateText(text: string): number {
  let sum = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined) sum += charWeight(cp);
  }
  return Math.ceil(sum);
}

/**
 * 估算消息列表的 token 数：Σ(estimateText(content) + MESSAGE_OVERHEAD_TOKENS)。
 * 空列表返回 0。
 */
export function estimateMessages(messages: ChatMessage[]): number {
  let total = 0;
  for (const m of messages) {
    total += estimateText(m.content) + MESSAGE_OVERHEAD_TOKENS;
  }
  return total;
}
