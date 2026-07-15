// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import type { ReactNode } from 'react';
import { Plus, MessageSquare, Loader2, Trash2, Check, X, Search, Pin, PinOff } from 'lucide-react';
import type { ChatSession } from '@/store/uiStore';
import { formatRelativeTime } from '@/lib/chatSession';
import { isPinned, type SessionGroup } from '@/lib/sessionOrganize';
import { type SearchResult, type HighlightRange } from '@/lib/chatSearch';

export const DRAFT_KEY = 'nuwa_chat_draft';

/**
 * 依据 HighlightRange[] 将 Match_Snippet 切成普通段与高亮段，<mark> 包裹高亮段。
 *
 * 以 `Array.from` 按 Unicode 码点切片（与 chatSearch 的区间语义一致），避免破坏
 * emoji / 代理对等多字节字符。highlights 已保证升序且互不重叠。
 */
function renderHighlightedSnippet(snippet: string, highlights: HighlightRange[]): ReactNode[] {
  const cps = Array.from(snippet);
  const nodes: ReactNode[] = [];
  let cursor = 0;
  highlights.forEach((h, i) => {
    if (h.start > cursor) {
      nodes.push(<span key={`t${i}`}>{cps.slice(cursor, h.start).join('')}</span>);
    }
    nodes.push(
      <mark key={`h${i}`} style={{ background: 'rgba(72,202,228,0.28)', color: 'var(--text-primary)', borderRadius: 3, padding: '0 1px' }}>
        {cps.slice(h.start, h.start + h.length).join('')}
      </mark>,
    );
    cursor = h.start + h.length;
  });
  if (cursor < cps.length) {
    nodes.push(<span key="tail">{cps.slice(cursor).join('')}</span>);
  }
  return nodes;
}

export type SessionSidebarProps = {
  currentCharacterId: string;
  createSession: (characterId: string) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  showSearch: boolean;
  clearSearch: () => void;
  searchResults: SearchResult[];
  isSearching: boolean;
  onResultClick: (result: SearchResult) => void;
  sessionsLoading: boolean;
  sessions: ChatSession[];
  sessionGroups: SessionGroup[];
  currentSessionId: string | null;
  isTyping: boolean;
  inputText: string;
  onStop: () => void;
  switchSession: (id: string) => void;
  renamingId: string | null;
  renameDraft: string;
  setRenameDraft: (v: string) => void;
  setRenamingId: (id: string | null) => void;
  submitRename: (id: string) => void;
  startRename: (id: string, title: string) => void;
  confirmDeleteId: string | null;
  setConfirmDeleteId: (id: string | null) => void;
  deleteSession: (id: string) => void;
  togglePin: (id: string) => void;
};

export function SessionSidebar({
  currentCharacterId,
  createSession,
  searchQuery,
  setSearchQuery,
  showSearch,
  clearSearch,
  searchResults,
  isSearching,
  onResultClick,
  sessionsLoading,
  sessions,
  sessionGroups,
  currentSessionId,
  isTyping,
  inputText,
  onStop,
  switchSession,
  renamingId,
  renameDraft,
  setRenameDraft,
  setRenamingId,
  submitRename,
  startRename,
  confirmDeleteId,
  setConfirmDeleteId,
  deleteSession,
  togglePin,
}: SessionSidebarProps) {
  return (
    <aside className="hidden md:flex w-[260px] flex-col shrink-0" style={{ borderRight: '1px solid var(--border)' }}>
      <div className="p-4">
        <button
          onClick={() => createSession(currentCharacterId)}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl cursor-pointer transition-all"
          style={{ background: 'rgba(72,202,228,0.08)', color: 'var(--primary)', border: '1px solid rgba(72,202,228,0.15)', fontSize: 13, fontWeight: 500 }}
        >
          <Plus size={16} />
          新建对话
        </button>
      </div>

      {/* Search_Input：受控输入，绑定 searchQuery；含搜索图标与清除按钮。 */}
      <div className="px-3 pb-2">
        <div className="relative flex items-center">
          <Search size={14} style={{ position: 'absolute', left: 11, color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input
            aria-label="搜索聊天记录"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索聊天记录"
            className="w-full text-sm rounded-xl outline-none"
            style={{ padding: '8px 32px', background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          />
          {showSearch && (
            <button
              aria-label="清除搜索"
              onClick={clearSearch}
              className="flex items-center justify-center"
              style={{ position: 'absolute', right: 6, width: 22, height: 22, borderRadius: 7, color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'; }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Session List / Search_Result_List：showSearch 为真时以检索结果取代会话列表。 */}
      <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-1">
        {showSearch ? (
          // Search_Result_List：展示标题、相对时间与高亮片段；空状态见下。
          searchResults.length > 0 ? (
            searchResults.map((result) => {
              const key = `${result.sessionId}-${result.matchType}-${result.messageId ?? 'title'}`;
              return (
                <div
                  key={key}
                  data-testid="search-result"
                  className="flex flex-col gap-1 px-3 py-2.5 rounded-xl cursor-pointer transition-all"
                  style={{ background: 'transparent', border: '1px solid transparent' }}
                  onClick={() => void onResultClick(result)}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--surface-hover)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                >
                  <div className="flex items-center justify-between gap-2">
                    {/* 所属会话标题（Req 6.1）。 */}
                    <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{result.sessionTitle}</span>
                    {/* 相对时间（Req 6.2）。 */}
                    <span className="text-[11px] shrink-0" style={{ color: 'var(--text-muted)' }}>{formatRelativeTime(result.updatedAt)}</span>
                  </div>
                  {/* 高亮匹配片段（Req 6.3）。 */}
                  <p className="text-xs leading-relaxed line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
                    {renderHighlightedSnippet(result.snippet, result.highlights)}
                  </p>
                </div>
              );
            })
          ) : isSearching ? (
            <div className="flex items-center gap-2 px-3 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              <Loader2 size={14} className="animate-spin" />
              搜索中…
            </div>
          ) : (
            // 空状态：仅在非检索中且无结果时显示（Req 6.4）。
            <div data-testid="search-empty" className="px-3 py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
              未找到匹配结果
            </div>
          )
        ) : sessionsLoading ? (
          // 启动加载态：显示加载占位，不渲染任何硬编码占位会话。
          <div className="flex items-center gap-2 px-3 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            <Loader2 size={14} className="animate-spin" />
            加载会话中…
          </div>
        ) : sessions.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
            暂无对话
            <div className="mt-1 opacity-60">点击上方 "新建对话" 开始</div>
          </div>
        ) : (
          sessionGroups.map((group) => (
            <div key={group.kind} data-testid={`session-group-${group.kind}`}>
              {/* 组标题（Req 7.2）：仅非空组进入输出，无需在此判空。 */}
              <div className="px-3 pt-3 pb-1 text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
                {group.title}
              </div>
              {group.sessions.map((s) => {
                const selected = s.id === currentSessionId;
                const editing = renamingId === s.id;
                const confirming = confirmDeleteId === s.id;
                const pinned = isPinned(s);
                return (
                  <div
                    key={s.id}
                    className="group flex items-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-all"
                    style={{ background: selected ? 'rgba(72,202,228,0.06)' : 'transparent', border: selected ? '1px solid rgba(72,202,228,0.1)' : '1px solid transparent' }}
                    onClick={() => {
                      // Stop streaming if in progress to prevent cross-session message leakage
                      if (isTyping) onStop();
                      // Save current draft before switching
                      if (currentSessionId) {
                        localStorage.setItem(`${DRAFT_KEY}:${currentSessionId}`, inputText);
                      }
                      switchSession(s.id);
                    }}
                    onMouseEnter={(e) => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = 'var(--surface-hover)'; }}
                    onMouseLeave={(e) => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                  >
                    <MessageSquare size={16} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                    <div className="flex-1 min-w-0">
                      {editing ? (
                        <input
                          autoFocus
                          aria-label="重命名会话"
                          value={renameDraft}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onBlur={() => submitRename(s.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); submitRename(s.id); }
                            else if (e.key === 'Escape') { e.preventDefault(); setRenamingId(null); setRenameDraft(''); }
                          }}
                          className="w-full outline-none bg-transparent text-sm font-medium"
                          style={{ color: 'var(--text-primary)', borderBottom: '1px solid var(--primary)', caretColor: 'var(--primary)' }}
                        />
                      ) : (
                        <div
                          className="text-sm font-medium truncate"
                          style={{ color: 'var(--text-primary)' }}
                          title="双击重命名"
                          onDoubleClick={(e) => { e.stopPropagation(); startRename(s.id, s.title); }}
                        >
                          {s.title}
                        </div>
                      )}
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatRelativeTime(s.updatedAt)}</div>
                    </div>

                    {/* 操作区：删除二次确认时仅显示确认/取消；否则显示置顶 + 删除入口。 */}
                    {confirming ? (
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          aria-label="确认删除"
                          className="flex items-center justify-center"
                          style={{ width: 26, height: 26, borderRadius: 8, color: '#FF6B6B', background: 'rgba(255,107,107,0.12)', border: 'none', cursor: 'pointer' }}
                          onClick={() => { void deleteSession(s.id); setConfirmDeleteId(null); }}
                        >
                          <Check size={14} />
                        </button>
                        <button
                          aria-label="取消删除"
                          className="flex items-center justify-center"
                          style={{ width: 26, height: 26, borderRadius: 8, color: 'var(--text-secondary)', background: 'var(--surface-hover)', border: 'none', cursor: 'pointer' }}
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        {/* 置顶 / 取消置顶入口（Req 7.3）：stopPropagation 避免触发会话切换；
                            切换后 store 更新 sessions，组件重渲染重新分组（Req 7.4）。
                            已置顶项常驻显示以指示状态，未置顶项 hover 显示。 */}
                        <button
                          aria-label={pinned ? '取消置顶' : '置顶'}
                          className={`flex items-center justify-center transition-opacity ${pinned ? '' : 'opacity-0 group-hover:opacity-100'}`}
                          style={{ width: 26, height: 26, borderRadius: 8, color: pinned ? 'var(--primary)' : 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                          onClick={(e) => { e.stopPropagation(); void togglePin(s.id); }}
                        >
                          {pinned ? <PinOff size={14} /> : <Pin size={14} />}
                        </button>
                        <button
                          aria-label="删除会话"
                          className="flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ width: 26, height: 26, borderRadius: 8, color: 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                          onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(s.id); setRenamingId(null); }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
