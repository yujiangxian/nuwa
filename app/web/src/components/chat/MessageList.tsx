// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import { Play, User, Square, Loader2, Check, X } from 'lucide-react';
import type { ChatMessage } from '@/store/uiStore';
import type { UseAudioQueue } from '@/hooks/useAudioQueue';
import MarkdownMessage from '@/components/MarkdownMessage';
import { estimateText } from '@/lib/tokenEstimate';
import { apiUrl } from '@/api/client';
import { MessageActions } from './MessageActions';

function mediaSrc(url: string): string {
  return url.startsWith('http') || url.startsWith('blob:') ? url : apiUrl(url);
}

/** Chat / Agent persona fields used for avatar display. */
export type ChatPersona = {
  name?: string;
  avatar?: string;
  systemPrompt?: string;
  voiceId?: string;
};

export type MessageListProps = {
  messages: ChatMessage[];
  messageRefs: MutableRefObject<Map<string, HTMLDivElement>>;
  currentCharacter: ChatPersona | undefined;
  editingId: string | null;
  editDraft: string;
  setEditDraft: (v: string) => void;
  submitEdit: (messageId: string) => void;
  cancelEdit: () => void;
  isTyping: boolean;
  regenMenuOpen: boolean;
  setRegenMenuOpen: Dispatch<SetStateAction<boolean>>;
  onCopy: (content: string) => void;
  onEdit: (msg: ChatMessage) => void;
  onRegenerate: (temperature?: number) => void;
  onDelete: (id: string) => void;
  player: UseAudioQueue;
  ttsLoadingId: string | null;
  ttsPendingMsgId: string | null;
  ttsSynthCount: number;
  ttsSynthDone: number;
  onPlayTTS: (msg: ChatMessage) => void;
  isStreaming: boolean;
  streamingThinking: string;
  thinkOpen: boolean;
  setThinkOpen: Dispatch<SetStateAction<boolean>>;
  thinkRef: MutableRefObject<string>;
  streamingContent: string;
  currentLlmModel: string;
  accRef: MutableRefObject<string>;
  ttsStartedAtRef: MutableRefObject<number>;
  autoPlay: boolean;
  sseCompletedRef: MutableRefObject<boolean>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
};

export function MessageList({
  messages,
  messageRefs,
  currentCharacter,
  editingId,
  editDraft,
  setEditDraft,
  submitEdit,
  cancelEdit,
  isTyping,
  regenMenuOpen,
  setRegenMenuOpen,
  onCopy,
  onEdit,
  onRegenerate,
  onDelete,
  player,
  ttsLoadingId,
  ttsPendingMsgId,
  ttsSynthCount,
  ttsSynthDone,
  onPlayTTS,
  isStreaming,
  streamingThinking,
  thinkOpen,
  setThinkOpen,
  thinkRef,
  streamingContent,
  currentLlmModel,
  accRef,
  ttsStartedAtRef,
  autoPlay,
  sseCompletedRef,
  messagesEndRef,
}: MessageListProps) {
  return (
    <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-6">
      {/* Welcome */}
      {messages.length === 0 && (
        <div className="text-center py-8">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-dim))', boxShadow: '0 0 30px var(--primary-glow)' }}>
            <User size={28} style={{ color: 'var(--bg)' }} />
          </div>
          <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>我是{currentCharacter?.name}</h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>可以聊天、回答问题，还能用你喜欢的声音说话</p>
        </div>
      )}

      {/* Messages */}
      {messages.map((msg, index) => (
        <div
          key={msg.id}
          ref={(el) => { if (el) messageRefs.current.set(msg.id, el); else messageRefs.current.delete(msg.id); }}
          className={`group flex animate-message ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          {msg.role === 'user' ? (
            <div className="flex flex-col items-end gap-1 max-w-[80%] md:max-w-[70%]">
              {editingId === msg.id ? (
                <div className="glass rounded-2xl rounded-tr-sm px-3 py-2.5 w-full" style={{ minWidth: 240 }}>
                  <textarea
                    autoFocus
                    aria-label="编辑消息"
                    rows={1}
                    value={editDraft}
                    onChange={(e) => {
                      setEditDraft(e.target.value);
                      e.target.style.height = 'auto';
                      e.target.style.height = e.target.scrollHeight + 'px';
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submitEdit(msg.id); }
                      else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                    }}
                    className="w-full outline-none resize-none bg-transparent text-sm leading-relaxed"
                    style={{ color: 'var(--text-primary)', caretColor: 'var(--primary)', minHeight: 24 }}
                  />
                  <div className="flex items-center justify-end gap-1 mt-2">
                    <button
                      aria-label="取消编辑"
                      className="flex items-center justify-center"
                      style={{ width: 26, height: 26, borderRadius: 8, color: 'var(--text-secondary)', background: 'var(--surface-hover)', border: 'none', cursor: 'pointer' }}
                      onClick={cancelEdit}
                    >
                      <X size={14} />
                    </button>
                    <button
                      aria-label="提交编辑"
                      className="flex items-center justify-center"
                      style={{ width: 26, height: 26, borderRadius: 8, color: 'var(--primary)', background: 'rgba(72,202,228,0.12)', border: 'none', cursor: 'pointer' }}
                      onClick={() => void submitEdit(msg.id)}
                    >
                      <Check size={14} />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="glass rounded-2xl rounded-tr-sm px-5 py-3.5">
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>{msg.content}</p>
                  </div>
                  <MessageActions
                    msg={msg}
                    index={index}
                    messages={messages}
                    isTyping={isTyping}
                    regenMenuOpen={regenMenuOpen}
                    setRegenMenuOpen={setRegenMenuOpen}
                    onCopy={onCopy}
                    onEdit={onEdit}
                    onRegenerate={onRegenerate}
                    onDelete={onDelete}
                  />
                </>
              )}
            </div>
          ) : (
            <div className="flex gap-3 max-w-[85%] md:max-w-[75%]">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-1" style={{ background: currentCharacter?.avatar || 'linear-gradient(135deg, var(--primary), var(--primary-dim))', boxShadow: '0 0 12px var(--primary-glow)' }}>
                <User size={16} style={{ color: 'var(--bg)' }} />
              </div>
              <div className="flex flex-col gap-1 min-w-0">
                <div className="glass rounded-2xl rounded-tl-sm px-5 py-3.5 glow-edge">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-medium" style={{ color: 'var(--primary)' }}>{currentCharacter?.name}</span>
                  {(msg.voiceName || msg.audioUrl || ttsPendingMsgId === msg.id) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(72,202,228,0.08)', color: 'var(--primary)' }}>{msg.voiceName || '可播放'}</span>
                    )}
                  </div>
                  <div className="mb-3">
                    <MarkdownMessage source={msg.content} />
                  </div>
                  {msg.media && (
                    <div className="mb-3">
                      {msg.media.status === 'pending' && (
                        <div className="flex items-center gap-2 text-xs py-6 justify-center rounded-xl" style={{ background: 'var(--surface)', color: 'var(--text-muted)' }}>
                          <Loader2 size={14} className="animate-spin" />
                          {msg.media.kind === 'video' ? '视频生成中…' : '图像生成中…'}
                        </div>
                      )}
                      {msg.media.status === 'error' && (
                        <div className="text-xs rounded-xl px-3 py-2" style={{ background: 'rgba(255,107,107,0.08)', color: '#FF6B6B' }}>
                          {msg.media.error || '生成失败'}
                        </div>
                      )}
                      {msg.media.status === 'done' && msg.media.url && msg.media.kind === 'image' && (
                        <img
                          src={mediaSrc(msg.media.url)}
                          alt={msg.media.prompt || 'generated'}
                          className="rounded-xl max-w-full"
                          style={{ maxHeight: 360, border: '1px solid var(--border)' }}
                        />
                      )}
                      {msg.media.status === 'done' && msg.media.url && msg.media.kind === 'video' && (
                        <video
                          controls
                          src={mediaSrc(msg.media.url)}
                          className="rounded-xl max-w-full"
                          style={{ maxHeight: 360, border: '1px solid var(--border)' }}
                        />
                      )}
                    </div>
                  )}
                  {(msg.voiceName || msg.audioUrl || ttsPendingMsgId === msg.id) && (
                    <div className="flex items-center gap-3">
                      <button
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg cursor-pointer transition-all"
                        style={{
                          color: 'var(--primary)',
                          background: player.isPlaying(msg.id) ? 'rgba(72,202,228,0.15)' : 'rgba(72,202,228,0.08)',
                          border: '1px solid rgba(72,202,228,0.15)',
                        }}
                        onMouseEnter={(e) => { if (!player.isPlaying(msg.id)) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(72,202,228,0.12)'; }}
                        onMouseLeave={(e) => { if (!player.isPlaying(msg.id)) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(72,202,228,0.08)'; }}
                        onClick={() => onPlayTTS(msg)}
                        disabled={ttsLoadingId === msg.id || ttsPendingMsgId === msg.id}
                      >
                        {(ttsLoadingId === msg.id || ttsPendingMsgId === msg.id) ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : player.isPlaying(msg.id) ? (
                          <Square size={14} fill="currentColor" />
                        ) : (
                          <Play size={14} fill="currentColor" />
                        )}
                        {(ttsLoadingId === msg.id || ttsPendingMsgId === msg.id)
                          ? (ttsSynthCount > 0 ? `合成中 ${ttsSynthDone}/${ttsSynthCount}` : '合成中...')
                          : player.isPlaying(msg.id) ? '停止' : '播放'}
                      </button>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{msg.duration}</span>
                    </div>
                  )}
                </div>
                <MessageActions
                  msg={msg}
                  index={index}
                  messages={messages}
                  isTyping={isTyping}
                  regenMenuOpen={regenMenuOpen}
                  setRegenMenuOpen={setRegenMenuOpen}
                  onCopy={onCopy}
                  onEdit={onEdit}
                  onRegenerate={onRegenerate}
                  onDelete={onDelete}
                />
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Streaming assistant bubble：Placeholder_Message（思考占位）→ Streaming_Message（打字机） */}
      {isStreaming && (
        <div className="flex gap-3 max-w-[85%] md:max-w-[75%]">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-1" style={{ background: currentCharacter?.avatar || 'linear-gradient(135deg, var(--primary), var(--primary-dim))', boxShadow: '0 0 12px var(--primary-glow)' }}>
            <User size={16} style={{ color: 'var(--bg)' }} />
          </div>
          <div className="glass rounded-2xl rounded-tl-sm px-5 py-3.5 glow-edge">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium" style={{ color: 'var(--primary)' }}>{currentCharacter?.name}</span>
            </div>
            {/* Streamed thinking/reasoning — collapsible, follows DeepSeek/Claude pattern */}
            {streamingThinking.length > 0 && (
              <details open={thinkOpen} onToggle={(e) => setThinkOpen((e.target as HTMLDetailsElement).open)} className="mb-3">
                <summary className="text-[11px] cursor-pointer flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: 'var(--primary)', animation: 'pulse-dot 1.4s infinite' }} />
                  深度思考中...
                  <span className="ml-1 opacity-50">{thinkRef.current.length} 字</span>
                </summary>
                <p className="mt-2 text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)', opacity: 0.75 }}>
                  {streamingThinking}
                  {streamingThinking.length > 0 && (
                    <span style={{ display: 'inline-block', marginLeft: 1, color: 'var(--text-muted)', animation: 'pulse-dot 1s steps(1) infinite' }}>▍</span>
                  )}
                </p>
              </details>
            )}
            {streamingContent.length > 0 ? (
              <div data-testid="streaming-content">
                <MarkdownMessage source={streamingContent} streaming />
                <span aria-hidden="true" style={{ display: 'inline-block', marginLeft: 2, color: 'var(--primary)', animation: 'pulse-dot 1s steps(1) infinite' }}>▍</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 mb-2">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--text-muted)', animation: 'pulse-dot 1.4s infinite 0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--text-muted)', animation: 'pulse-dot 1.4s infinite 200ms' }} />
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--text-muted)', animation: 'pulse-dot 1.4s infinite 400ms' }} />
                <span className="text-xs ml-1" style={{ color: 'var(--text-muted)' }}>正在思考...</span>
              </div>
            )}
            {/* Pipeline status — visible during entire streaming phase */}
            <div className="flex items-center gap-4 text-[11px] mt-2 pt-2" style={{ color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
              <span>模型: {(currentLlmModel || '').replace(/^llm\//, '')}</span>
              <span>已接收 {estimateText(accRef.current)} tokens</span>
              {ttsSynthCount > 0 ? (
                <>
                  <span style={{ color: 'var(--primary)' }}>语音合成 {ttsSynthDone}/{ttsSynthCount}</span>
                  {/* TTS progress bar with timing */}
                  <div className="flex items-center gap-1.5">
                    <div className="h-1 rounded-full w-20" style={{ background: 'var(--border)' }}>
                      <div className="h-full rounded-full transition-all duration-300" style={{
                        background: 'var(--primary)',
                        width: `${ttsSynthCount > 0 ? (ttsSynthDone / ttsSynthCount) * 100 : 0}%`,
                      }} />
                    </div>
                    <span>{(() => {
                      const elapsed = Math.round((Date.now() - ttsStartedAtRef.current) / 1000);
                      const mins = Math.floor(elapsed / 60);
                      const secs = elapsed % 60;
                      if (ttsSynthDone > 0) {
                        const estTotal = (elapsed / ttsSynthDone) * ttsSynthCount;
                        const remaining = Math.max(0, Math.round(estTotal - elapsed));
                        const rm = Math.floor(remaining / 60);
                        const rs = remaining % 60;
                        return `已用 ${mins}m${secs}s · 预估剩余 ${rm}m${rs}s`;
                      }
                      return `已用 ${mins}m${secs}s`;
                    })()}</span>
                  </div>
                </>
              ) : autoPlay ? (
                <span style={{ color: 'var(--text-muted)' }}>等待完整句子...</span>
              ) : null}
              {!sseCompletedRef.current && streamingContent.length > 0 && !isTyping && (
                <span style={{ color: '#FFB347' }}>连接中断</span>
              )}
            </div>
            {/* Streaming progress bar — shimmer animation (indeterminate, no total length) */}
            <div className="mt-2 h-0.5 rounded-full w-full overflow-hidden" style={{ background: 'var(--border)' }}>
              {streamingContent.length > 0 ? (
                <div className="h-full rounded-full animate-shimmer" style={{
                  backgroundImage: 'linear-gradient(90deg, var(--primary-dim), var(--primary), var(--primary-dim))',
                }} />
              ) : null}
            </div>
          </div>
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  );
}
