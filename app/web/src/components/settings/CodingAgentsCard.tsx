// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * Settings：本机 Claude Code / Cursor Agent 状态与 API Key。
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useToastStore } from '@/store/toastStore';
import { errorMessage } from '@/lib/errorDetail';

interface CodingStatus {
  provider: string;
  available: boolean;
  binary?: string | null;
  version?: string | null;
  message: string;
  api_key_configured?: boolean | null;
}

export default function CodingAgentsCard() {
  const addToast = useToastStore((s) => s.addToast);
  const [claude, setClaude] = useState<CodingStatus | null>(null);
  const [cursor, setCursor] = useState<CodingStatus | null>(null);
  const [claudeKeyDraft, setClaudeKeyDraft] = useState('');
  const [cursorKeyDraft, setCursorKeyDraft] = useState('');
  const [savingClaude, setSavingClaude] = useState(false);
  const [savingCursor, setSavingCursor] = useState(false);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [c, k] = await Promise.all([
        apiClient.get('/api/coding/claude/status'),
        apiClient.get('/api/coding/cursor/status'),
      ]);
      setClaude(c.data as CodingStatus);
      setCursor(k.data as CodingStatus);
    } catch {
      setClaude(null);
      setCursor(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveClaudeKey = async () => {
    setSavingClaude(true);
    try {
      await apiClient.post('/api/coding/claude/key', { api_key: claudeKeyDraft });
      addToast({
        message: claudeKeyDraft.trim() ? 'Anthropic API Key 已保存' : '已清除 Anthropic API Key',
        type: 'success',
      });
      setClaudeKeyDraft('');
      void refresh();
    } catch (e: unknown) {
      addToast({ message: errorMessage(e, '保存失败'), type: 'error' });
    } finally {
      setSavingClaude(false);
    }
  };

  const saveCursorKey = async () => {
    setSavingCursor(true);
    try {
      await apiClient.post('/api/coding/cursor/key', { api_key: cursorKeyDraft });
      addToast({
        message: cursorKeyDraft.trim() ? 'Cursor API Key 已保存' : '已清除 Cursor API Key',
        type: 'success',
      });
      setCursorKeyDraft('');
      void refresh();
    } catch (e: unknown) {
      addToast({ message: errorMessage(e, '保存失败'), type: 'error' });
    } finally {
      setSavingCursor(false);
    }
  };

  return (
    <div className="space-y-3">
      <label className="text-[11px] font-semibold uppercase tracking-[0.08em] block" style={{ color: 'var(--text-muted)' }}>
        本机 Coding Agent
      </label>

      <div className="rounded-xl px-3 py-3 space-y-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Claude Code</span>
          {loading ? <Loader2 size={14} className="animate-spin" style={{ color: 'var(--text-muted)' }} /> : (
            <span className="text-[11px]" style={{ color: claude?.available ? 'var(--primary)' : 'var(--text-muted)' }}>
              {claude?.available
                ? (claude.api_key_configured ? 'CLI + API Key' : 'CLI（无 Key）')
                : '未找到'}
            </span>
          )}
        </div>
        <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          {claude?.message || '检测本机 claude CLI…'}
        </p>
        {claude?.binary && (
          <p className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }} title={claude.binary}>
            {claude.binary}{claude.version ? ` · ${claude.version}` : ''}
          </p>
        )}
        <label className="text-[11px] block" style={{ color: 'var(--text-muted)' }}>ANTHROPIC_API_KEY</label>
        <div className="flex gap-2">
          <input
            type="password"
            value={claudeKeyDraft}
            onChange={(e) => setClaudeKeyDraft(e.target.value)}
            placeholder={claude?.api_key_configured ? '已配置（输入新值覆盖，空则清除）' : '粘贴 sk-ant-…'}
            autoComplete="off"
            className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          />
          <button
            type="button"
            onClick={() => void saveClaudeKey()}
            disabled={savingClaude}
            className="text-xs px-3 py-2 rounded-lg cursor-pointer shrink-0"
            style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          >
            {savingClaude ? <Loader2 size={12} className="animate-spin" /> : '保存'}
          </button>
        </div>
      </div>

      <div className="rounded-xl px-3 py-3 space-y-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Cursor Agent</span>
          {loading ? <Loader2 size={14} className="animate-spin" style={{ color: 'var(--text-muted)' }} /> : (
            <span className="text-[11px]" style={{ color: cursor?.available ? 'var(--primary)' : 'var(--text-muted)' }}>
              {cursor?.available
                ? (cursor.api_key_configured ? 'CLI + 订阅 Key' : 'CLI（用 login）')
                : '未找到 CLI'}
            </span>
          )}
        </div>
        <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          {cursor?.message || '检测 Cursor headless agent…'}
        </p>
        <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
          走的是 Cursor 订阅套餐额度，不是另开按量 API 账单。推荐：安装 CLI 后终端执行
          {' '}
          <code>agent login</code>
          （浏览器登你的订阅账号）。可选：Dashboard 的「API Key」只是同一账号的鉴权凭证，用量仍进套餐池 —
          {' '}
          <a href="https://cursor.com/dashboard" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>
            cursor.com/dashboard
          </a>
          。安装 CLI：
          {' '}
          <code>irm &apos;https://cursor.com/install?win32=true&apos; | iex</code>
        </p>
        <label className="text-[11px] block" style={{ color: 'var(--text-muted)' }}>
          订阅 Key（可选，已 login 可留空）
        </label>
        <div className="flex gap-2">
          <input
            type="password"
            value={cursorKeyDraft}
            onChange={(e) => setCursorKeyDraft(e.target.value)}
            placeholder={cursor?.api_key_configured ? '已配置（输入新值覆盖，空则清除）' : '可选：Dashboard → API Keys'}
            autoComplete="off"
            className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          />
          <button
            type="button"
            onClick={() => void saveCursorKey()}
            disabled={savingCursor}
            className="text-xs px-3 py-2 rounded-lg cursor-pointer shrink-0"
            style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          >
            {savingCursor ? <Loader2 size={12} className="animate-spin" /> : '保存'}
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => void refresh()}
        className="text-[11px] px-2 py-1 rounded cursor-pointer"
        style={{ color: 'var(--text-muted)', background: 'transparent', border: '1px solid var(--border)' }}
      >
        重新检测
      </button>
    </div>
  );
}
