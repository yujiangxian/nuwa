// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: chat-message-actions
// 纯函数层：根据消息序列、下标与生成状态推导单条消息上各操作的可用性。
// 抽成无副作用的纯函数，供 ChatPage 渲染操作入口与属性测试共用。
//
// 设计参考：.kiro/specs/chat-message-actions/design.md
//   「3.2 消息操作入口渲染」可用性矩阵与 Correctness Property 7。

/** 单条消息上四种操作的可用性。 */
export interface ActionAvailability {
  /** 复制：始终可用，不受 Generating_State 限制（Req 1.4 不含 Copy）。 */
  canCopy: boolean;
  /** 删除：仅在非生成态可用（Req 1.4）。 */
  canDelete: boolean;
  /** 重新生成：仅对 Last_Assistant_Message 且非生成态可用（Req 1.2, 1.4）。 */
  canRegenerate: boolean;
  /** 编辑重发：仅对 user 消息且非生成态可用（Req 1.3, 1.4）。 */
  canEdit: boolean;
}

/** 仅依赖可用性判定所需的消息字段。 */
interface MessageRef {
  id: string;
  role: 'user' | 'assistant';
}

/**
 * 计算 `messages[index]` 这条消息的操作可用性矩阵（纯函数）。
 *
 * - canCopy 恒为真；
 * - canDelete === !isGenerating；
 * - canRegenerate === (该条为最后一条 && role==='assistant' && !isGenerating)；
 * - canEdit === (role==='user' && !isGenerating)。
 */
export function actionAvailabilityFor(
  messages: MessageRef[],
  index: number,
  isGenerating: boolean,
): ActionAvailability {
  const msg = messages[index];
  const isLast = index === messages.length - 1;
  const isLastAssistant = isLast && msg?.role === 'assistant';
  return {
    canCopy: true,
    canDelete: !isGenerating,
    canRegenerate: !isGenerating && isLastAssistant,
    canEdit: !isGenerating && msg?.role === 'user',
  };
}
