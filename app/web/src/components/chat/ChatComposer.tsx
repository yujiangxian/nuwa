// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import type { Dispatch, RefObject, SetStateAction } from 'react';
import { Mic, Send, Square, Loader2 } from 'lucide-react';
import { useUIStore } from '@/store/uiStore';
import type { UseAudioQueue } from '@/hooks/useAudioQueue';
import {
  clampHighlightIndex, type CommandItem,
} from '@/lib/slashCommand';
import SlashCommandMenu from '@/components/SlashCommandMenu';

export type ChatComposerProps = {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  inputText: string;
  setInputText: (v: string) => void;
  slashMenuVisible: boolean;
  slashFiltered: CommandItem[];
  slashHl: number;
  setSlashHighlight: Dispatch<SetStateAction<number>>;
  setSlashDismissed: Dispatch<SetStateAction<boolean>>;
  selectCommand: (item: CommandItem) => void;
  closeSlashMenu: () => void;
  isTyping: boolean;
  handleSend: () => void;
  handleStop: () => void;
  autoPlay: boolean;
  player: UseAudioQueue;
  playbackRate: number;
  setPlaybackRate: (r: number) => void;
  recorder: {
    isRecording: boolean;
    recordingTime: number;
  };
  asrLoading: boolean;
  handleToggleRecord: () => void;
};

export function ChatComposer({
  inputRef,
  inputText,
  setInputText,
  slashMenuVisible,
  slashFiltered,
  slashHl,
  setSlashHighlight,
  setSlashDismissed,
  selectCommand,
  closeSlashMenu,
  isTyping,
  handleSend,
  handleStop,
  autoPlay,
  player,
  playbackRate,
  setPlaybackRate,
  recorder,
  asrLoading,
  handleToggleRecord,
}: ChatComposerProps) {
  return (
    <div className="px-4 md:px-6 pb-4">
      <div className="glass glow-edge rounded-2xl p-4" style={{ position: 'relative' }}>
        {slashMenuVisible && (
          <SlashCommandMenu
            items={slashFiltered}
            highlightIndex={slashHl}
            onSelect={selectCommand}
            onHover={setSlashHighlight}
          />
        )}
        <textarea
          ref={inputRef}
          className="w-full outline-none resize-none bg-transparent text-sm leading-relaxed"
          style={{ color: 'var(--text-primary)', caretColor: 'var(--primary)', minHeight: 24 }}
          rows={1}
          placeholder="输入消息..."
          value={inputText}
          maxLength={2000}
          onChange={(e) => {
            setInputText(e.target.value);
            // 输入变化即重置斜杠菜单的临时关闭标志与高亮（Escape 后再输入可重新弹出）。
            setSlashDismissed(false);
            setSlashHighlight(0);
            e.target.style.height = 'auto';
            e.target.style.height = e.target.scrollHeight + 'px';
          }}
          onKeyDown={(e) => {
            // 斜杠菜单可见时拦截导航/选中/关闭键，避免发送或换行（Req 4.4–4.6, 4.8）。
            if (slashMenuVisible) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSlashHighlight(clampHighlightIndex(slashHl + 1, slashFiltered.length));
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSlashHighlight(clampHighlightIndex(slashHl - 1, slashFiltered.length));
                return;
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                selectCommand(slashFiltered[slashHl]);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                closeSlashMenu();
                return;
              }
            }
            // 既有逻辑：Enter（无 Shift）发送，Shift+Enter 换行（Req 7.1, 7.3）。
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
          }}
          disabled={isTyping}
        />
        <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3">
            {/* autoPlay toggle + playback speed */}
            <button className="text-[10px] px-1.5 py-0.5 rounded cursor-pointer"
              style={{
                color: autoPlay ? 'var(--primary)' : 'var(--text-muted)',
                background: autoPlay ? 'rgba(72,202,228,0.12)' : 'transparent',
                border: 'none', fontWeight: 600,
              }}
              onClick={() => useUIStore.getState().updateSetting('autoPlay', !autoPlay)}
              title={autoPlay ? '自动朗读已开启' : '自动朗读已关闭'}
            >
              {autoPlay ? '🔊 自动' : '🔇 手动'}
            </button>
            {player.playing && <span className="text-[10px] animate-pulse" style={{ color: 'var(--primary)' }}>▶ 播放中</span>}
            {['0.5', '1', '1.5', '2'].map((rate) => {
              const r = parseFloat(rate);
              return (
                <button
                  key={rate}
                  className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{
                    color: playbackRate === r ? 'var(--primary)' : 'var(--text-muted)',
                    background: playbackRate === r ? 'rgba(72,202,228,0.12)' : 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: playbackRate === r ? 600 : 400,
                  }}
                  onClick={() => { setPlaybackRate(r); player.setSpeed(r); }}
                >
                  {rate}x
                </button>
              );
            })}
            <button className="flex items-center justify-center" style={{ width: 32, height: 32, borderRadius: 10, color: recorder.isRecording ? '#FF6B6B' : asrLoading ? 'var(--primary)' : 'var(--text-secondary)', background: recorder.isRecording ? 'rgba(255,107,107,0.12)' : 'transparent', border: 'none', cursor: 'pointer', transition: 'all 0.2s ease' }}
              onMouseEnter={(e) => { if (!recorder.isRecording && !asrLoading) { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'; } }}
              onMouseLeave={(e) => { if (!recorder.isRecording && !asrLoading) { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'; } }}
              onClick={handleToggleRecord}
              disabled={asrLoading || isTyping}>
              {asrLoading ? <Loader2 size={18} className="animate-spin" /> : <Mic size={18} />}
            </button>
            {recorder.isRecording && (
              <span className="text-xs font-mono" style={{ color: '#FF6B6B' }}>
                {Math.floor(recorder.recordingTime / 60)}:{String(recorder.recordingTime % 60).padStart(2, '0')}
              </span>
            )}
          </div>
          {isTyping ? (
            <button
              onClick={handleStop}
              className="flex items-center gap-2"
              style={{ background: 'rgba(255,107,107,0.15)', color: '#FF6B6B', borderRadius: 10, padding: '8px 18px', fontWeight: 600, fontSize: 13, border: 'none', cursor: 'pointer', transition: 'all 0.2s ease' }}
            >
              <Square size={14} fill="currentColor" />
              停止
            </button>
          ) : (
            <button
              onClick={handleSend}
              className="flex items-center gap-2"
              style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-dim))', color: 'var(--bg)', borderRadius: 10, padding: '8px 18px', fontWeight: 600, fontSize: 13, border: 'none', cursor: 'pointer', boxShadow: '0 0 20px var(--primary-glow)', transition: 'all 0.2s ease' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 35px var(--primary-glow-strong)'; (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 20px var(--primary-glow)'; (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'; }}
            >
              <Send size={16} />
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
