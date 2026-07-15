// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import type { CSSProperties, Dispatch, MouseEvent, SetStateAction } from 'react';
import { Copy, RotateCcw, Pencil, Trash2, ThumbsUp, ThumbsDown, ChevronDown } from 'lucide-react';
import { useUIStore, type ChatMessage } from '@/store/uiStore';
import { actionAvailabilityFor } from '@/lib/messageActions';

export type MessageActionsProps = {
  msg: ChatMessage;
  index: number;
  messages: ChatMessage[];
  isTyping: boolean;
  regenMenuOpen: boolean;
  setRegenMenuOpen: Dispatch<SetStateAction<boolean>>;
  onCopy: (content: string) => void;
  onEdit: (msg: ChatMessage) => void;
  onRegenerate: (temperature?: number) => void;
  onDelete: (id: string) => void;
};

/** 单条已定型消息的操作入口（Message_Actions）。 */
export function MessageActions({
  msg,
  index,
  messages,
  isTyping,
  regenMenuOpen,
  setRegenMenuOpen,
  onCopy,
  onEdit,
  onRegenerate,
  onDelete,
}: MessageActionsProps) {
  const avail = actionAvailabilityFor(messages, index, isTyping);
  const iconBtn: CSSProperties = {
    width: 26,
    height: 26,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-muted)',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  };
  const hoverIn = (e: MouseEvent<HTMLButtonElement>) => {
    (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)';
    (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)';
  };
  const hoverOut = (e: MouseEvent<HTMLButtonElement>) => {
    (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
    (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
  };
  return (
    <div
      data-testid={`message-actions-${msg.id}`}
      className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
    >
      {/* Copy 始终可用，不受 Generating_State 限制（Req 1.1, 1.4）。 */}
      {avail.canCopy && (
        <button aria-label="复制" style={iconBtn} onMouseEnter={hoverIn} onMouseLeave={hoverOut} onClick={() => void onCopy(msg.content)}>
          <Copy size={14} />
        </button>
      )}
      {/* Edit_Resend 仅对 user 消息且非生成态（Req 1.3, 1.4）。 */}
      {avail.canEdit && (
        <button aria-label="编辑重发" style={iconBtn} onMouseEnter={hoverIn} onMouseLeave={hoverOut} onClick={() => onEdit(msg)}>
          <Pencil size={14} />
        </button>
      )}
      {/* Regenerate 仅对 Last_Assistant_Message 且非生成态（Req 1.2, 1.4）。
          温度下拉菜单：默认 / 更创意(1.5) / 更精确(0.3)。 */}
      {avail.canRegenerate && (
        <div style={{ position: 'relative' }}>
          <button
            aria-label="重新生成"
            style={iconBtn}
            onMouseEnter={hoverIn}
            onMouseLeave={hoverOut}
            onClick={() => setRegenMenuOpen((v) => !v)}
          >
            <RotateCcw size={14} />
            <ChevronDown size={10} style={{ marginLeft: 1 }} />
          </button>
          {regenMenuOpen && (
            <>
              <div
                data-testid="regen-backdrop"
                style={{ position: 'fixed', inset: 0, zIndex: 40 }}
                onClick={() => setRegenMenuOpen(false)}
              />
              <div
                className="glass rounded-xl"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  right: 0,
                  zIndex: 50,
                  width: 160,
                  border: '1px solid var(--border)',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
                  padding: 6,
                }}
              >
                {([
                  { label: '默认重新生成', temp: undefined },
                  { label: '更创意', temp: 1.5 },
                  { label: '更精确', temp: 0.3 },
                ] as const).map((opt) => (
                  <button
                    key={opt.label}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-all"
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-primary)' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                    onClick={() => {
                      setRegenMenuOpen(false);
                      void onRegenerate(opt.temp);
                    }}
                  >
                    <RotateCcw size={14} style={{ color: 'var(--text-muted)' }} />
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {/* Delete 非生成态可用（Req 1.4, 5.1, 5.2）。 */}
      {avail.canDelete && (
        <button aria-label="删除消息" style={iconBtn} onMouseEnter={hoverIn} onMouseLeave={hoverOut} onClick={() => void onDelete(msg.id)}>
          <Trash2 size={14} />
        </button>
      )}
      {/* Thumbs up/down feedback for assistant messages */}
      {msg.role === 'assistant' && (
        <>
          <button
            aria-label="赞"
            style={{ ...iconBtn, color: msg.feedback === 'up' ? 'var(--primary)' : 'var(--text-muted)' }}
            onMouseEnter={hoverIn}
            onMouseLeave={hoverOut}
            onClick={() => useUIStore.getState().updateMessageFeedback(msg.id, 'up')}
          >
            <ThumbsUp size={14} />
          </button>
          <button
            aria-label="踩"
            style={{ ...iconBtn, color: msg.feedback === 'down' ? '#FF6B6B' : 'var(--text-muted)' }}
            onMouseEnter={hoverIn}
            onMouseLeave={hoverOut}
            onClick={() => useUIStore.getState().updateMessageFeedback(msg.id, 'down')}
          >
            <ThumbsDown size={14} />
          </button>
        </>
      )}
    </div>
  );
}
