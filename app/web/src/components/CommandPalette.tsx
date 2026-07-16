// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import type React from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useUIStore } from '@/store/uiStore';
import {
  buildCommandRegistry,
  type CommandRegistryContext,
} from '@/lib/commandRegistry';
import {
  filterCommands,
  clampHighlight,
  type CommandItem,
  type CommandGroup,
} from '@/lib/commandPalette';
import { detectPlatform } from '@/lib/keyCombo';

/** Command_Group -> 中文分组标题（展示用，保持注册表分组顺序）。 */
const GROUP_LABELS: Record<CommandGroup, string> = {
  navigation: '导航',
  settings: '设置',
  appearance: '外观',
  session: '会话',
};

/**
 * 命令面板覆盖层（Command_Palette，Req 1, 4, 5, 8）。
 *
 * - paletteOpen 为 false 时返回 null（不渲染）。
 * - 渲染遮罩 + 居中面板：搜索输入框 + 按 Command_Group 分组的 Filtered_Commands 列表（Req 8.1, 8.6）。
 * - 每项显示 title（及存在的 subtitle）；关联 Key_Combo 时显示规范字符串（Req 8.2, 8.3）。
 * - Highlight_Index 指向项施加高亮样式（Req 8.4）；空结果显示空状态提示（Req 8.5）。
 * - 键盘：ArrowDown/ArrowUp 回绕移动高亮，Enter 执行并关闭，Escape 关闭（Req 4.1, 4.2, 4.4, 1.2）。
 * - 打开时聚焦搜索框并持续保持焦点（Req 4.6）；query 变化经 clampHighlight 规整高亮（Req 4.3）。
 * - 点击遮罩（列表/搜索框之外）关闭（Req 1.5）。
 */
export default function CommandPalette(): React.ReactElement | null {
  const paletteOpen = useUIStore((s) => s.paletteOpen);
  const paletteQuery = useUIStore((s) => s.paletteQuery);
  const highlightIndex = useUIStore((s) => s.highlightIndex);
  const setPaletteQuery = useUIStore((s) => s.setPaletteQuery);
  const moveHighlight = useUIStore((s) => s.moveHighlight);
  const setHighlightIndex = useUIStore((s) => s.setHighlightIndex);
  const closePalette = useUIStore((s) => s.closePalette);

  // 既有 store actions（命令副作用接线）。
  const setPage = useUIStore((s) => s.setPage);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const updateSetting = useUIStore((s) => s.updateSetting);
  const createSession = useUIStore((s) => s.createSession);
  const currentAgentId = useUIStore((s) => s.currentAgentId);

  const inputRef = useRef<HTMLInputElement>(null);

  // 构建注册表（依赖注入的 actions/上下文稳定时复用）。
  const registry = useMemo<CommandItem[]>(() => {
    const ctx: CommandRegistryContext = {
      setPage,
      setSettingsOpen,
      updateSetting: (key, value) => updateSetting(key, value),
      createSession,
      currentAgentId,
      platform: detectPlatform(),
    };
    return buildCommandRegistry(ctx);
  }, [setPage, setSettingsOpen, updateSetting, createSession, currentAgentId]);

  // 当前查询的 Filtered_Commands（纯函数计算）。
  const filtered = useMemo(
    () => filterCommands(paletteQuery, registry),
    [paletteQuery, registry],
  );

  // query/列表变化时规整高亮：打开且为 -1 时落到首项，否则 clamp 到合法范围（Req 1.3, 4.3）。
  useEffect(() => {
    if (!paletteOpen) return;
    const len = filtered.length;
    const next = highlightIndex < 0 && len > 0 ? 0 : clampHighlight(highlightIndex, len);
    if (next !== highlightIndex) setHighlightIndex(next);
  }, [paletteOpen, paletteQuery, filtered.length, highlightIndex, setHighlightIndex]);

  // 打开时聚焦搜索框（Req 4.6）。
  useEffect(() => {
    if (paletteOpen) {
      // 等待渲染后聚焦。
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [paletteOpen]);

  if (!paletteOpen) return null;

  const runHighlighted = (): void => {
    if (filtered.length === 0) return; // 空结果不执行且保持打开（Req 4.5）。
    const item = filtered[highlightIndex];
    if (!item) return;
    item.run();
    closePalette(); // 执行后关闭（Req 4.4, 5.6）。
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveHighlight(1, filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveHighlight(-1, filtered.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runHighlighted();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
    }
  };

  // 按 Command_Group 分组，保持各组首次出现顺序与组内 filtered 相对顺序（Req 8.6）。
  const groupOrder: CommandGroup[] = [];
  const grouped = new Map<CommandGroup, { item: CommandItem; flatIndex: number }[]>();
  filtered.forEach((item, flatIndex) => {
    if (!grouped.has(item.group)) {
      grouped.set(item.group, []);
      groupOrder.push(item.group);
    }
    grouped.get(item.group)!.push({ item, flatIndex });
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      style={{
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(16px)',
        paddingTop: '12vh',
        animation: 'fadeIn 0.2s ease',
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closePalette();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="命令面板"
    >
      <div
        className="w-full max-w-lg mx-5 overflow-hidden"
        style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, var(--surface) 100%)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 32px 80px rgba(0,0,0,0.5)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 16,
          maxHeight: '70vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* 搜索输入框（Req 8.1） */}
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <input
            ref={inputRef}
            type="text"
            value={paletteQuery}
            placeholder="输入命令…"
            aria-label="搜索命令"
            onChange={(e) => setPaletteQuery(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => {
              // 持续保持焦点（Req 4.6）：失焦后立即重新聚焦。
              window.setTimeout(() => {
                if (useUIStore.getState().paletteOpen) inputRef.current?.focus();
              }, 0);
            }}
            className="w-full text-sm outline-none bg-transparent"
            style={{ color: 'var(--text-primary)', border: 'none' }}
          />
        </div>

        {/* 结果列表（Req 8.6） */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {filtered.length === 0 ? (
            // 空状态提示（Req 8.5）。
            <div
              className="px-3 py-6 text-center text-sm"
              style={{ color: 'var(--text-muted)' }}
              role="status"
            >
              无匹配命令
            </div>
          ) : (
            groupOrder.map((group) => (
              <div key={group} className="mb-2">
                <div
                  className="px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {GROUP_LABELS[group]}
                </div>
                {grouped.get(group)!.map(({ item, flatIndex }) => {
                  const isActive = flatIndex === highlightIndex;
                  return (
                    <button
                      key={item.id}
                      data-command-id={item.id}
                      data-active={isActive ? 'true' : 'false'}
                      onMouseEnter={() => setHighlightIndex(flatIndex)}
                      onClick={() => {
                        item.run();
                        closePalette();
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors cursor-pointer"
                      style={{
                        background: isActive ? 'rgba(72,202,228,0.12)' : 'transparent',
                        border: 'none',
                      }}
                    >
                      <span className="flex flex-col">
                        <span
                          className="text-sm"
                          style={{
                            color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                          }}
                        >
                          {item.title}
                        </span>
                        {item.subtitle && (
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {item.subtitle}
                          </span>
                        )}
                      </span>
                      {item.combo && (
                        <kbd
                          className="text-[11px] font-mono px-1.5 py-0.5 rounded"
                          style={{
                            color: 'var(--text-muted)',
                            background: 'rgba(255,255,255,0.06)',
                          }}
                        >
                          {item.combo}
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
