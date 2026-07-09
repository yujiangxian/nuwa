// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { useCallback, useRef, useState } from 'react';
import { useUIStore } from '@/store/uiStore';
import { useToastStore } from '@/store/toastStore';
import { errorMessage } from '@/lib/errorDetail';
import { useTranscribe } from '@/hooks/useApi';
import type { AsrUploadResponse } from '@/hooks/useApi';
import { ArrowLeft, Mic, Square, Upload, Copy, Check, Loader2, FileAudio, AlertCircle, Download } from 'lucide-react';
import { useRecorder } from '@/hooks/useRecorder';

/**
 * TranscribePage — 录音转写页面。
 *
 * 两种输入方式：
 *  - 浏览器录音（useRecorder）
 *  - 本地音频文件上传（<input type="file" accept="audio/*">）
 * 两路都经 useTranscribe 提交至 `POST /api/inference/asr/upload`，不显式传
 * model_id，由后端回退至 Current_ASR_Model（需求 4.6）。
 *
 * 覆盖需求 1.2–1.9, 6.1, 6.3。
 */
export default function TranscribePage() {
  const setPage = useUIStore((s) => s.setPage);
  const addToast = useToastStore((s) => s.addToast);
  const { isRecording, recordingTime, error: micError, start, stop } = useRecorder();
  const transcribe = useTranscribe();

  /** 转写成功结果（success:true 时填充）。 */
  const [result, setResult] = useState<AsrUploadResponse | null>(null);
  /** 后端 success:false 时返回的错误文本（需求 1.6 / 6.1）。 */
  const [errorText, setErrorText] = useState<string | null>(null);
  /** 已选择的本地文件名（仅用于展示）。 */
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  /** 已选文件大小（字节）。 */
  const [fileSize, setFileSize] = useState<number | null>(null);
  /** 已选音频时长（秒）。 */
  const [fileDuration, setFileDuration] = useState<number | null>(null);
  /** 复制成功的瞬时反馈状态。 */
  const [copied, setCopied] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const isSubmitting = transcribe.isPending;

  /** 统一处理一次转写提交（录音 Blob 或上传文件）。 */
  const submitAudio = useCallback(
    async (audio: Blob, filename: string) => {
      setResult(null);
      setErrorText(null);
      try {
        // 不传 modelId：由后端回退至 Current_ASR_Model（需求 4.6）。
        const data = await transcribe.mutateAsync({ audio, filename });
        if (data.success) {
          setResult(data);
        } else {
          // 后端 success:false：展示 error，不展示文本（需求 1.6 / 6.1）。
          setErrorText(data.error || '识别失败');
        }
      } catch (err: unknown) {
        // 网络错误 / 非 2xx：展示错误并退出加载态（需求 6.3）。
        const msg = errorMessage(err, '识别请求失败');
        setErrorText(msg);
        addToast({ message: msg, type: 'error' });
      }
    },
    [transcribe, addToast]
  );

  /** 切换录音：开始 / 停止后自动提交。 */
  const handleToggleRecord = useCallback(async () => {
    if (isSubmitting) return;
    if (isRecording) {
      const blob = await stop();
      if (!blob) {
        addToast({ message: '录音太短，请重新录制', type: 'warning' });
        return;
      }
      setSelectedFileName(null);
      await submitAudio(blob, 'recording.webm');
      return;
    }
    await start();
  }, [isRecording, isSubmitting, start, stop, submitAudio, addToast]);

  /** 选择本地音频文件并立即提交。 */
  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // 允许再次选择同一文件触发 onChange。
      e.target.value = '';
      if (!file || isSubmitting) return;
      setSelectedFileName(file.name);
      setFileSize(file.size);
      setFileDuration(null);
      // 读取音频时长
      const objectUrl = URL.createObjectURL(file);
      const audio = new Audio(objectUrl);
      audio.addEventListener('loadedmetadata', () => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          setFileDuration(audio.duration);
        }
        URL.revokeObjectURL(objectUrl);
      });
      audio.addEventListener('error', () => {
        URL.revokeObjectURL(objectUrl);
      });
      await submitAudio(file, file.name);
    },
    [isSubmitting, submitAudio]
  );

  /** 复制转写文本到系统剪贴板（需求 1.8）。 */
  const handleCopy = useCallback(async () => {
    if (!result?.text) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      addToast({ message: '复制失败，请手动选择文本', type: 'error' });
    }
  }, [result, addToast]);

  /** 通用下载辅助：创建 blob URL、触发点击、释放。 */
  const downloadText = useCallback((content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  /** 导出为纯文本 TXT。 */
  const handleExportTxt = useCallback(() => {
    if (!result?.text) return;
    downloadText(result.text, 'transcribe.txt', 'text/plain;charset=utf-8');
  }, [result, downloadText]);

  /** 导出为基础 SRT 字幕。 */
  const handleExportSrt = useCallback(() => {
    if (!result?.text) return;
    const srt = `1\n00:00:00,000 --> 99:59:59,999\n${result.text}\n`;
    downloadText(srt, 'transcribe.srt', 'text/plain;charset=utf-8');
  }, [result, downloadText]);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const formatDuration = (msOrSec: number) => {
    if (!Number.isFinite(msOrSec) || msOrSec <= 0) return '--';
    if (msOrSec >= 60) {
      const m = Math.floor(msOrSec / 60);
      const s = Math.round(msOrSec % 60);
      return `${m}:${String(s).padStart(2, '0')}`;
    }
    return `${msOrSec.toFixed(1)}s`;
  };

  return (
    <div className="flex flex-col h-full relative" style={{ zIndex: 10 }}>
      {/* Header */}
      <header
        className="relative z-20 flex items-center gap-3 px-5 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <button
          onClick={() => setPage('home')}
          className="flex items-center justify-center"
          style={{ width: 36, height: 36, borderRadius: 10, color: 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer', transition: 'all 0.2s ease' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'; }}
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-dim))', boxShadow: '0 0 16px var(--primary-glow)' }}>
            <FileAudio size={16} style={{ color: 'var(--bg)' }} />
          </div>
          <span className="text-base font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>录音转写</span>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6">
        <div className="mx-auto w-full max-w-2xl space-y-6">
          {/* 麦克风不可用提示（需求 1.7）：仍保留下方文件上传作为替代 */}
          {micError && (
            <div
              className="flex items-start gap-3 rounded-xl px-4 py-3"
              style={{ background: 'rgba(255,107,107,0.08)', border: '1px solid rgba(255,107,107,0.2)' }}
            >
              <AlertCircle size={18} style={{ color: '#FF6B6B', marginTop: 1 }} />
              <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
                {micError}
                <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>你仍可以使用下方的文件上传方式进行转写。</div>
              </div>
            </div>
          )}

          {/* 输入区：录音 + 文件上传 */}
          <div className="glass glow-edge rounded-2xl p-6">
            <div className="flex flex-col items-center gap-5">
              {/* 录音按钮 */}
              <button
                onClick={handleToggleRecord}
                disabled={isSubmitting}
                className="flex items-center justify-center transition-all"
                style={{
                  width: 88,
                  height: 88,
                  borderRadius: '50%',
                  background: isRecording ? 'rgba(255,107,107,0.15)' : 'linear-gradient(135deg, var(--primary), var(--primary-dim))',
                  color: isRecording ? '#FF6B6B' : 'var(--bg)',
                  border: isRecording ? '1px solid rgba(255,107,107,0.35)' : 'none',
                  boxShadow: isRecording ? 'none' : '0 0 30px var(--primary-glow)',
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  opacity: isSubmitting ? 0.6 : 1,
                }}
              >
                {isRecording ? <Square size={30} fill="currentColor" /> : <Mic size={32} />}
              </button>
              <div className="text-center">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  {isRecording ? '正在录音…' : '点击开始录音'}
                </div>
                {isRecording && (
                  <div className="text-xs font-mono mt-1" style={{ color: '#FF6B6B' }}>{formatTime(recordingTime)}</div>
                )}
              </div>

              {/* 分隔 */}
              <div className="flex items-center gap-3 w-full">
                <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>或</span>
                <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
              </div>

              {/* 文件上传 */}
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isSubmitting}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl cursor-pointer transition-all"
                style={{
                  background: 'rgba(72,202,228,0.08)',
                  color: 'var(--primary)',
                  border: '1px solid rgba(72,202,228,0.15)',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  opacity: isSubmitting ? 0.6 : 1,
                }}
              >
                <Upload size={16} />
                上传音频文件
              </button>
              {selectedFileName && (
                <div className="text-xs space-y-0.5 max-w-full">
                  <div className="truncate" style={{ color: 'var(--text-secondary)' }}>
                    已选择：{selectedFileName}
                  </div>
                  <div className="flex gap-3" style={{ color: 'var(--text-muted)' }}>
                    {fileSize != null && <span>{(fileSize / 1024).toFixed(1)} KB</span>}
                    {fileDuration != null && <span>{formatDuration(fileDuration)}</span>}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 识别处理中（需求 1.9） */}
          {isSubmitting && (
            <div
              className="flex items-center justify-center gap-2 rounded-xl px-4 py-3"
              style={{ background: 'rgba(72,202,228,0.06)', border: '1px solid rgba(72,202,228,0.12)' }}
            >
              <Loader2 size={16} className="animate-spin" style={{ color: 'var(--primary)' }} />
              <span className="text-sm" style={{ color: 'var(--primary)' }}>识别处理中…</span>
            </div>
          )}

          {/* 错误展示（需求 1.6 / 6.1 / 6.3）：不展示转写文本 */}
          {!isSubmitting && errorText && (
            <div
              className="flex items-start gap-3 rounded-xl px-4 py-3"
              style={{ background: 'rgba(255,107,107,0.08)', border: '1px solid rgba(255,107,107,0.2)' }}
            >
              <AlertCircle size={18} style={{ color: '#FF6B6B', marginTop: 1 }} />
              <div className="text-sm" style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>{errorText}</div>
            </div>
          )}

          {/* 转写结果（需求 1.5 / 1.8） */}
          {!isSubmitting && result && (
            <div className="glass rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-muted)' }}>转写结果</span>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg cursor-pointer transition-all"
                  style={{ color: 'var(--primary)', background: 'rgba(72,202,228,0.08)', border: '1px solid rgba(72,202,228,0.15)' }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? '已复制' : '复制'}
                </button>
              </div>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                {result.text || '（未识别到内容）'}
              </p>
              <div className="flex items-center gap-4 mt-4 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  模型：<span style={{ color: 'var(--text-primary)' }}>{result.model || '—'}</span>
                </span>
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  耗时：<span style={{ color: 'var(--text-primary)' }}>{result.elapsed_ms} ms</span>
                </span>
                <div className="flex-1" />
                <button
                  onClick={handleExportTxt}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg cursor-pointer transition-all"
                  style={{ color: 'var(--text-secondary)', background: 'transparent', border: '1px solid var(--border)' }}
                >
                  <Download size={12} />
                  导出 TXT
                </button>
                <button
                  onClick={handleExportSrt}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg cursor-pointer transition-all"
                  style={{ color: 'var(--text-secondary)', background: 'transparent', border: '1px solid var(--border)' }}
                >
                  <Download size={12} />
                  导出 SRT
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
