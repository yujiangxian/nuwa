// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * Settings 内 SuperGrok 账号卡片：导入 Grok Build / 设备码登录 / 断开。
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useToastStore } from '@/store/toastStore';

interface XaiStatus {
  connected: boolean;
  email?: string | null;
  source?: string | null;
  models?: string[];
}

interface DeviceStart {
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string | null;
  interval: number;
}

export default function SuperGrokCard() {
  const addToast = useToastStore((s) => s.addToast);
  const [status, setStatus] = useState<XaiStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [device, setDevice] = useState<DeviceStart | null>(null);
  const [polling, setPolling] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const resp = await apiClient.get('/api/xai/status');
      setStatus(resp.data as XaiStatus);
    } catch {
      setStatus({ connected: false });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!polling || !device) return;
    const id = window.setInterval(async () => {
      try {
        const resp = await apiClient.get('/api/xai/auth/status');
        const data = resp.data as { status: string; email?: string; message?: string };
        if (data.status === 'connected') {
          setPolling(false);
          setDevice(null);
          addToast({ message: 'SuperGrok 已连接', type: 'success' });
          void refresh();
        } else if (data.status === 'error') {
          setPolling(false);
          setDevice(null);
          addToast({ message: data.message || '登录失败', type: 'error' });
        }
      } catch {
        /* keep polling */
      }
    }, Math.max(2, device.interval) * 1000);
    return () => window.clearInterval(id);
  }, [polling, device, addToast, refresh]);

  const onImport = async () => {
    setLoading(true);
    try {
      const resp = await apiClient.post('/api/xai/auth/import');
      const data = resp.data as { email?: string };
      addToast({
        message: data.email ? `已导入 Grok Build（${data.email}）` : '已导入 Grok Build 登录',
        type: 'success',
      });
      void refresh();
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error
        || (e instanceof Error ? e.message : '导入失败');
      addToast({ message: String(msg), type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const onStartDevice = async () => {
    setLoading(true);
    try {
      const resp = await apiClient.post('/api/xai/auth/start');
      const data = resp.data as DeviceStart;
      setDevice(data);
      setPolling(true);
      const url = data.verification_uri_complete || data.verification_uri;
      window.open(url, '_blank', 'noopener,noreferrer');
      addToast({ message: `请在浏览器输入代码：${data.user_code}`, type: 'info' });
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error
        || (e instanceof Error ? e.message : '启动登录失败');
      addToast({ message: String(msg), type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const onLogout = async () => {
    setLoading(true);
    try {
      await apiClient.post('/api/xai/auth/logout');
      setDevice(null);
      setPolling(false);
      addToast({ message: '已断开 SuperGrok', type: 'success' });
      void refresh();
    } catch {
      addToast({ message: '断开失败', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const connected = !!status?.connected;

  return (
    <div>
      <label className="text-[11px] font-semibold uppercase tracking-[0.08em] mb-2 block" style={{ color: 'var(--text-muted)' }}>
        SuperGrok 账号
      </label>
      <p className="text-[10px] mb-2" style={{ color: 'var(--text-muted)' }}>
        使用已购订阅（非 API Key）。推荐先本机执行 <code style={{ color: 'var(--primary)' }}>grok login</code>，再点「导入 Grok Build」。
      </p>
      <div className="rounded-xl px-3 py-2.5 mb-2 text-xs" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
        {connected ? (
          <>
            已连接{status?.email ? ` · ${status.email}` : ''}
            {status?.source ? ` · 来源 ${status.source}` : ''}
            {status?.models?.length ? ` · ${status.models.length} 模型` : ''}
          </>
        ) : (
          '未连接'
        )}
      </div>
      {device && (
        <div className="rounded-xl px-3 py-2 mb-2 text-xs" style={{ background: 'rgba(72,202,228,0.08)', border: '1px solid rgba(72,202,228,0.2)', color: 'var(--text-primary)' }}>
          验证码：<strong style={{ letterSpacing: '0.08em' }}>{device.user_code}</strong>
          <div className="mt-1" style={{ color: 'var(--text-muted)' }}>等待浏览器确认…</div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={loading} onClick={() => void onImport()}
          className="text-xs px-3 py-1.5 rounded-lg cursor-pointer flex items-center gap-1"
          style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
          {loading ? <Loader2 size={12} className="animate-spin" /> : null}
          导入 Grok Build
        </button>
        <button type="button" disabled={loading || polling} onClick={() => void onStartDevice()}
          className="text-xs px-3 py-1.5 rounded-lg cursor-pointer"
          style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
          设备码登录
        </button>
        {connected && (
          <button type="button" disabled={loading} onClick={() => void onLogout()}
            className="text-xs px-3 py-1.5 rounded-lg cursor-pointer"
            style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            断开
          </button>
        )}
      </div>
    </div>
  );
}
