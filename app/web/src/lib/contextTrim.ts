// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * context-window-management：Context_Trimmer 纯函数层。
 *
 * 在将超预算时确定性地丢弃最旧的非系统消息，始终保留 Latest_User_Message。
 * System_Prompt 以请求体独立 `system` 字段下发，不在 messages 数组内，故天然保留。
 *
 * 返回应发送的消息列表（输入的保序子序列）与被裁剪条数。纯函数、确定性。
 */

import type { ChatMessage } from '@/store/types';
import { estimateMessages } from '@/lib/tokenEstimate';

export interface TrimResult {
  /** 应发送的消息（输入的保序子序列）。 */
  messages: ChatMessage[];
  /** 被裁剪条数 = 输入条数 - 输出条数（非负整数）。 */
  trimmedCount: number;
}

/**
 * 在将超预算时丢弃最旧的非系统消息。
 *
 * 记 fixed = systemPromptTokens + reservedTokens，
 * fits(list) = fixed + estimateMessages(list) <= contextLength。
 *
 * 1. 若 fits(messages) 为真 → 原样返回（trimmedCount = 0）。
 * 2. 否则定位 Latest_User_Message 索引（从后向前最后一条 role==='user'）；
 *    构造除该索引外的可裁剪索引队列（按出现顺序由旧到新）；
 *    逐条标记删除并复算 fits，满足即停止；队列耗尽仍不满足也停止。
 * 3. 用未删除的原索引升序重组，得到输入的保序子序列。
 *
 * 始终保留 Latest_User_Message；System_Prompt 不在 messages 内，天然保留。
 */
export function trimMessages(input: {
  messages: ChatMessage[];
  systemPromptTokens: number;
  contextLength: number;
  reservedTokens: number;
}): TrimResult {
  const { messages, systemPromptTokens, contextLength, reservedTokens } = input;
  const fixed = systemPromptTokens + reservedTokens;

  const fits = (list: ChatMessage[]): boolean =>
    fixed + estimateMessages(list) <= contextLength;

  // 1. 已在预算内：恒等返回。
  if (fits(messages)) {
    return { messages, trimmedCount: 0 };
  }

  // 2. 定位 Latest_User_Message（受保护，永不丢弃）。
  let keepIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      keepIdx = i;
      break;
    }
  }

  // 标记保留集合（初始为全部保留），按最旧优先逐条删除可裁剪消息。
  const removed = new Array<boolean>(messages.length).fill(false);
  const survivors = (): ChatMessage[] => messages.filter((_, i) => !removed[i]);

  for (let i = 0; i < messages.length; i++) {
    if (i === keepIdx) continue; // 受保护：永不裁剪
    if (fits(survivors())) break; // 已满足预算
    removed[i] = true;
  }

  const result = survivors();
  return { messages: result, trimmedCount: messages.length - result.length };
}
