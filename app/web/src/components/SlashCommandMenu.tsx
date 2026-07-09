// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import type { CommandItem } from '@/lib/slashCommand';

/**
 * Slash_Command_Menu：无状态受控展示组件。
 *
 * 只负责渲染父组件已过滤好的 Filtered_Commands 列表与高亮项，并把点击 / 悬停
 * 事件回调给父组件（ChatPage）。不直接读写 Chat_Store，便于快照/集成测试。
 */
export interface SlashCommandMenuProps {
  /** Filtered_Commands（父组件已用 filterCommands 过滤）。 */
  items: CommandItem[];
  /** 已经过 clampHighlightIndex 规整的合法高亮下标（空列表为 -1）。 */
  highlightIndex: number;
  /** 鼠标点击选中某条命令。 */
  onSelect: (item: CommandItem) => void;
  /** 鼠标悬停某条命令以同步高亮（体验增强）。 */
  onHover: (index: number) => void;
}

export default function SlashCommandMenu({
  items,
  highlightIndex,
  onSelect,
  onHover,
}: SlashCommandMenuProps) {
  // 防御：空列表不渲染（父组件也会以 menuVisible 控制，Req 4.2）。
  if (items.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label="斜杠命令菜单"
      data-testid="slash-command-menu"
      className="absolute left-0 right-0 bottom-full mb-2 rounded-xl overflow-hidden glass"
      style={{
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.28)',
        maxHeight: 280,
        overflowY: 'auto',
        zIndex: 40,
      }}
    >
      {items.map((item, index) => {
        const active = index === highlightIndex;
        return (
          <button
            key={`${item.kind}:${item.presetId ?? item.commandKey}:${index}`}
            type="button"
            role="option"
            aria-selected={active}
            data-testid={`slash-command-item-${index}`}
            // mousedown 而非 click：避免 textarea 先失焦导致选中丢失。
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(item);
            }}
            onMouseEnter={() => onHover(index)}
            className="w-full flex items-center gap-3 px-3 py-2 text-left cursor-pointer transition-colors"
            style={{
              background: active ? 'var(--surface-hover)' : 'transparent',
              border: 'none',
              borderLeft: active
                ? '2px solid var(--primary)'
                : '2px solid transparent',
            }}
          >
            <span
              className="text-xs font-medium shrink-0"
              style={{
                color: item.kind === 'builtin' ? 'var(--primary)' : 'var(--text-secondary)',
                minWidth: 56,
              }}
            >
              {item.kind === 'builtin' ? item.title : `/${item.commandKey}`}
            </span>
            <span className="flex flex-col min-w-0">
              {item.kind === 'preset' && (
                <span
                  className="text-sm truncate"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {item.title}
                </span>
              )}
              <span
                className="text-xs truncate"
                style={{ color: 'var(--text-muted)' }}
              >
                {item.description}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
