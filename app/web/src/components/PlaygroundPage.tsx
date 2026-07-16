// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { useRef, useEffect, useState, useCallback } from 'react';
import { useUIStore } from '@/store/uiStore';
import { useToastStore } from '@/store/toastStore';
import { usePresetStore } from '@/store/presetStore';
import { useConfig, useModels } from '@/hooks/useApi';
import { errorMessage } from '@/lib/errorDetail';
import ParamPanel from '@/components/ParamPanel';
import UsageIndicator from '@/components/UsageIndicator';
import MarkdownMessage from '@/components/MarkdownMessage';
import { buildRequestFragment } from '@/lib/generationParams';
import { configLlmModelId } from '@/lib/displayModel';
import { resolveContextLength } from '@/lib/contextWindow';
import { computeBudget, resolveReservedTokens } from '@/lib/contextBudget';
import { estimateText } from '@/lib/tokenEstimate';
import { consumeChatStream, accumulateDelta, shouldPersistFinal } from '@/lib/streamChat';
import { ArrowLeft, Settings, Send, Loader2, Monitor, Square, ChevronDown, ChevronRight, Trash2, BookOpen } from 'lucide-react';

type HistoryMessage = { role: string; content: string };

export default function PlaygroundPage() {
  const setPage = useUIStore((s) => s.setPage);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const chatGenParams = useUIStore((s) => s.chatGenParams);
  const { data: config } = useConfig();
  const { data: allModels = [] } = useModels();
  const addToast = useToastStore((s) => s.addToast);
  const { presets, presetsLoading, loadPresets } = usePresetStore();

  const [prompt, setPrompt] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [rawResponse, setRawResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [viewMode, setViewMode] = useState<'rendered' | 'raw'>('rendered');
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [tokenCount, setTokenCount] = useState<number | null>(null);
  const [systemOpen, setSystemOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Feature 1: multi-turn conversation history
  const [history, setHistory] = useState<HistoryMessage[]>([]);

  // Feature 3: model comparison mode
  const [compareMode, setCompareMode] = useState(false);
  const [compareModelId, setCompareModelId] = useState('');
  const [compareResponse, setCompareResponse] = useState('');
  const [compareRawResponse, setCompareRawResponse] = useState('');
  const [compareElapsedMs, setCompareElapsedMs] = useState<number | null>(null);
  const [compareTokenCount, setCompareTokenCount] = useState<number | null>(null);
  const [compareViewMode, setCompareViewMode] = useState<'rendered' | 'raw'>('rendered');
  const compareAbortRef = useRef<AbortController | null>(null);

  // Feature 4: presets collapsible
  const [presetsOpen, setPresetsOpen] = useState(false);

  const llmModels = allModels.filter((m) => m.model_type === 'llm' || m.id.startsWith('llm/'));
  const configuredLlm = configLlmModelId(config);
  const preferredModelId =
    (configuredLlm
      ? llmModels.find((m) => m.id === configuredLlm || m.id === `llm/${configuredLlm}`)?.id
      : undefined) ?? llmModels[0]?.id ?? '';
  const [modelId, setModelId] = useState(preferredModelId);
  const currentModel = modelId?.replace(/^llm\//, '');

  // 配置 / 扫描结果就绪后，若当前选择为空或已不在列表中，对齐到可用模型。
  useEffect(() => {
    if (!preferredModelId) {
      if (modelId) setModelId('');
      return;
    }
    if (!modelId || !llmModels.some((m) => m.id === modelId)) {
      setModelId(preferredModelId);
    }
  }, [preferredModelId, llmModels, modelId]);

  const selectedModel = llmModels.find((m) => m.id === modelId);
  const selectedCompareModel = compareModelId ? llmModels.find((m) => m.id === compareModelId) : undefined;
  const selectedContext = resolveContextLength(selectedModel?.context_length);
  const compareContext = resolveContextLength(selectedCompareModel?.context_length);

  // Format size for display
  const formatSize = (mb: number | undefined): string => {
    if (mb == null) return '-- GB';
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
    return `${mb.toFixed(0)} MB`;
  };

  const budget = (() => {
    const { contextLength } = selectedContext;
    const reservedTokens = resolveReservedTokens(chatGenParams);
    const allMessages = [
      ...history.map((h, i) => ({ id: `hist-${i}`, role: h.role as 'user' | 'assistant', content: h.content })),
      { id: '', role: 'user' as const, content: prompt },
    ];
    return computeBudget({
      contextLength,
      isEstimated: true,
      systemPrompt,
      messages: allMessages,
      reservedTokens,
    });
  })();

  const handleSend = useCallback(async () => {
    if (!prompt.trim() || loading) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setStreaming(true);
    setResponse('');
    setRawResponse('');
    setElapsedMs(null);
    setTokenCount(null);

    // Compare mode: also reset compare state and fire second request
    if (compareMode) {
      setCompareResponse('');
      setCompareRawResponse('');
      setCompareElapsedMs(null);
      setCompareTokenCount(null);
    }

    const t0 = performance.now();
    const genFragment = buildRequestFragment(chatGenParams);
    const userContent = prompt.trim();

    // Feature 1: send full history with request
    const messagesPayload = [...history, { role: 'user', content: userContent }];

    let accRef = '';
    let streamError: string | null = null;

    const doStreamFetch = async (
      modelName: string,
      abortCtrl: AbortController,
    ): Promise<{ content: string; error: string | null }> => {
      let acc = '';
      let err: string | null = null;
      try {
        const { apiAuthHeaders, apiUrl } = await import('@/api/client');
        const resp = await fetch(apiUrl('/api/chat/stream'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...apiAuthHeaders() },
          body: JSON.stringify({
            messages: messagesPayload,
            model: modelName.replace(/^llm\//, ''),
            ...(systemPrompt.trim() ? { system: systemPrompt.trim() } : {}),
            ...genFragment,
          }),
          signal: abortCtrl.signal,
        });

        if (resp.ok && resp.body) {
          await consumeChatStream(resp.body, (chunk) => {
            if (chunk.delta) {
              acc = accumulateDelta(acc, chunk);
            }
            if (chunk.error) err = chunk.error;
          });
        } else if (!resp.ok) {
          err = `HTTP ${resp.status}`;
        }
      } catch (e: unknown) {
        if ((e as Error).name === 'AbortError') { /* stopped by user */ }
        else err = errorMessage(e, '请求失败');
      }
      return { content: acc, error: err };
    };

    // Fallback: non-streaming fetch
    const doFallbackFetch = async (modelName: string): Promise<string> => {
      try {
        const { apiClient } = await import('@/api/client');
        const fallback = await apiClient.post<{ content: string }>('/api/chat', {
          messages: messagesPayload,
          model: modelName.replace(/^llm\//, ''),
          ...(systemPrompt.trim() ? { system: systemPrompt.trim() } : {}),
          ...genFragment,
        }, { timeout: 120000 });
        return fallback.data.content ?? '';
      } catch {
        return '';
      }
    };

    // Primary model request
    const primary = await doStreamFetch(currentModel, ctrl);
    accRef = primary.content;
    streamError = primary.error;

    // Fallback for primary
    if (!accRef && streamError) {
      accRef = await doFallbackFetch(currentModel);
      if (accRef) streamError = null;
    }

    // Feature 3: compare model request (in parallel with primary conceptually, but
    // we fire sequentially for simplicity since we already waited)
    let compareAcc = '';
    let compareErr: string | null = null;
    let compareResult: { content: string; error: string | null } = { content: '', error: null };

    if (compareMode && compareModelId) {
      const compareCtrl = new AbortController();
      compareAbortRef.current = compareCtrl;
      const compareT0 = performance.now();

      compareResult = await doStreamFetch(
        compareModelId.replace(/^llm\//, ''),
        compareCtrl,
      );
      compareAcc = compareResult.content;
      compareErr = compareResult.error;

      if (!compareAcc && compareErr) {
        compareAcc = await doFallbackFetch(compareModelId.replace(/^llm\//, ''));
        if (compareAcc) compareErr = null;
      }

      const cDur = Math.round(performance.now() - compareT0);
      setCompareElapsedMs(cDur);
      setCompareTokenCount(estimateText(compareAcc));
      setCompareRawResponse(JSON.stringify({ content: compareAcc, model: compareModelId.replace(/^llm\//, ''), elapsedMs: cDur, tokenEstimate: estimateText(compareAcc) }, null, 2));
      setCompareResponse(compareAcc);

      compareAbortRef.current = null;
    }

    const dur = Math.round(performance.now() - t0);
    setElapsedMs(dur);
    setTokenCount(estimateText(accRef));
    setRawResponse(JSON.stringify({ content: accRef, model: currentModel, elapsedMs: dur, tokenEstimate: estimateText(accRef) }, null, 2));

    if (streamError && !accRef) {
      addToast({ message: streamError, type: 'error' });
    }
    if (shouldPersistFinal(accRef)) {
      setResponse(accRef);
    }

    // Feature 1: append user message and assistant response to history
    if (accRef) {
      const newEntry: HistoryMessage[] = [
        { role: 'user', content: userContent },
        { role: 'assistant', content: accRef },
      ];
      // In compare mode, we combine both responses into the assistant message
      if (compareMode && compareAcc) {
        newEntry[1] = {
          role: 'assistant',
          content: `**${currentModel}:**\n\n${accRef}\n\n---\n\n**${compareModelId.replace(/^llm\//, '')}:**\n\n${compareAcc}`,
        };
      }
      setHistory((prev) => [...prev, ...newEntry]);
    }

    setPrompt('');
    setLoading(false);
    setStreaming(false);
    abortRef.current = null;
  }, [prompt, loading, currentModel, systemPrompt, chatGenParams, addToast, history, compareMode, compareModelId]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    compareAbortRef.current?.abort();
  }, []);

  const handleClearHistory = useCallback(() => {
    setHistory([]);
    setResponse('');
    setRawResponse('');
    setCompareResponse('');
    setCompareRawResponse('');
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      compareAbortRef.current?.abort();
    };
  }, []);

  // Sync modelId when config loads
  useEffect(() => {
    const m = config?.current_models?.llm ?? config?.current_llm_model;
    if (m) setModelId(m);
  }, [config]);

  // Feature 4: load presets on mount
  useEffect(() => {
    loadPresets();
  }, [loadPresets]);

  // Feature 5: pre-send token estimation
  const preSendTokens = estimateText(prompt + systemPrompt);

  // Ensure compare model has a default when none selected
  useEffect(() => {
    if (compareMode && !compareModelId && llmModels.length > 0) {
      const otherModel = llmModels.find((m) => m.id !== modelId);
      if (otherModel) setCompareModelId(otherModel.id);
    }
  }, [compareMode, compareModelId, llmModels, modelId]);

  return (
    <div className="flex flex-col h-full relative" style={{ zIndex: 10 }}>
      <header
        className="relative z-20 flex items-center justify-between px-5 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => setPage('home')}
            className="flex items-center justify-center"
            style={{ width: 36, height: 36, borderRadius: 10, color: 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer', transition: 'all 0.2s ease' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'; }}
          >
            <ArrowLeft size={22} />
          </button>
          <span className="text-base font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>Playground</span>
          <span className="hidden md:inline text-xs px-2 py-0.5 rounded" style={{ color: 'var(--text-muted)', background: 'var(--surface-hover)', border: '1px solid var(--border)' }}>模型实验</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full glass" style={{ border: '1px solid var(--border)' }}>
            <Monitor size={14} style={{ color: 'var(--text-secondary)' }} />
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{currentModel || '未选择模型'}</span>
          </div>
          <button
            className="flex items-center justify-center"
            style={{ width: 36, height: 36, borderRadius: 10, color: 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer', transition: 'all 0.2s ease' }}
            onClick={() => setSettingsOpen(true)}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'; }}
          >
            <Settings size={22} />
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <aside className="hidden md:flex w-[260px] flex-col shrink-0 overflow-y-auto" style={{ borderRight: '1px solid var(--border)' }}>
          <div className="p-4 space-y-4">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-[0.08em] block mb-1.5" style={{ color: 'var(--text-muted)' }}>模型</label>
              <select
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                disabled={llmModels.length === 0}
                className="w-full text-sm rounded-xl outline-none px-3 py-2"
                style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
              >
                {llmModels.length === 0 ? (
                  <option value="">暂无 LLM（请先在模型页扫描 / 拉取）</option>
                ) : (
                  llmModels.map((m) => {
                    const sizeStr = m.size_mb != null ? formatSize(m.size_mb) : '';
                    const quantStr = m.quant || '';
                    const extra = [sizeStr, quantStr].filter(Boolean).join(' | ');
                    return (
                      <option key={m.id} value={m.id}>
                        {m.name || m.id.replace(/^llm\//, '')}{extra ? `  (${extra})` : ''}
                      </option>
                    );
                  })
                )}
              </select>

              {/* Feature 2: model metadata info card */}
              {selectedModel && (
                <div
                  className="mt-2 text-[11px] rounded-lg px-3 py-2 space-y-0.5"
                  style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                >
                  <div>Size: {formatSize(selectedModel.size_mb)}</div>
                  <div>Quant: {selectedModel.quant || '--'}</div>
                  <div>
                    Context: {selectedContext.contextLength} tokens
                    {selectedContext.isEstimated ? '（估算）' : ''}
                  </div>
                </div>
              )}
            </div>

            {/* Feature 3: compare mode */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="compare-mode"
                checked={compareMode}
                onChange={(e) => setCompareMode(e.target.checked)}
                style={{ accentColor: 'var(--primary)' }}
              />
              <label htmlFor="compare-mode" className="text-sm cursor-pointer select-none" style={{ color: 'var(--text-secondary)' }}>
                对比模式
              </label>
            </div>

            {compareMode && (
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-[0.08em] block mb-1.5" style={{ color: 'var(--text-muted)' }}>对比模型</label>
                <select
                  value={compareModelId}
                  onChange={(e) => setCompareModelId(e.target.value)}
                  disabled={llmModels.filter((m) => m.id !== modelId).length === 0}
                  className="w-full text-sm rounded-xl outline-none px-3 py-2"
                  style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                >
                  {llmModels.filter((m) => m.id !== modelId).length === 0 ? (
                    <option value="">暂无对比模型</option>
                  ) : (
                    llmModels.filter((m) => m.id !== modelId).map((m) => {
                      const sizeStr = m.size_mb != null ? formatSize(m.size_mb) : '';
                      const quantStr = m.quant || '';
                      const extra = [sizeStr, quantStr].filter(Boolean).join(' | ');
                      return (
                        <option key={m.id} value={m.id}>
                          {m.name || m.id.replace(/^llm\//, '')}{extra ? `  (${extra})` : ''}
                        </option>
                      );
                    })
                  )}
                </select>
                {selectedCompareModel && (
                  <div
                    className="mt-2 text-[11px] rounded-lg px-3 py-2 space-y-0.5"
                    style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                  >
                    <div>Size: {formatSize(selectedCompareModel.size_mb)}</div>
                    <div>Quant: {selectedCompareModel.quant || '--'}</div>
                    <div>
                      Context: {compareContext.contextLength} tokens
                      {compareContext.isEstimated ? '（估算）' : ''}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="h-px" style={{ background: 'var(--border)' }} />
            <ParamPanel />
            <div className="h-px" style={{ background: 'var(--border)' }} />

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] mb-2" style={{ color: 'var(--text-muted)' }}>上下文预算</div>
              <UsageIndicator budget={budget} />
            </div>

            {/* Feature 4: prompt presets */}
            <div>
              <button
                onClick={() => setPresetsOpen((v) => !v)}
                className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] w-full"
                style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                {presetsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <BookOpen size={12} />
                预设模板
                {presets.length > 0 && <span className="text-[10px] opacity-60">({presets.length})</span>}
              </button>
              {presetsOpen && (
                <div className="mt-2 space-y-1">
                  {presetsLoading ? (
                    <div className="text-[11px] px-2" style={{ color: 'var(--text-muted)' }}>加载中...</div>
                  ) : presets.length === 0 ? (
                    <div className="text-[11px] px-2" style={{ color: 'var(--text-muted)' }}>暂无预设模板</div>
                  ) : (
                    presets.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setPrompt((prev) => prev ? `${prev}\n\n${p.content}` : p.content)}
                        className="w-full text-left text-xs rounded-lg px-3 py-2 truncate"
                        style={{
                          background: 'var(--surface-hover)',
                          border: '1px solid var(--border)',
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface)';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)';
                        }}
                        title={`点击插入: ${p.content.slice(0, 100)}...`}
                      >
                        {p.title}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </aside>

        <main className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-4">
            {/* Feature 1: history messages display */}
            {history.length > 0 && (
              <div className="space-y-3">
                {history.map((msg, idx) => (
                  <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className="max-w-[85%] rounded-xl px-4 py-3"
                      style={{
                        background: msg.role === 'user'
                          ? 'linear-gradient(135deg, var(--primary), var(--primary-dim))'
                          : 'var(--surface-hover)',
                        border: msg.role === 'assistant' ? '1px solid var(--border)' : 'none',
                        color: msg.role === 'user' ? 'var(--bg)' : 'var(--text-primary)',
                      }}
                    >
                      {msg.role === 'user' ? (
                        <p className="text-sm whitespace-pre-wrap m-0">{msg.content}</p>
                      ) : (
                        <MarkdownMessage source={msg.content} streaming={false} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* System prompt (collapsible) */}
            <div>
              <button
                onClick={() => setSystemOpen((v) => !v)}
                className="flex items-center gap-1 text-sm font-medium mb-2"
                style={{ color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                {systemOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                System Prompt {systemPrompt && <span className="text-[10px] ml-1 opacity-60">({estimateText(systemPrompt)} tokens)</span>}
              </button>
              {systemOpen && (
                <textarea
                  className="w-full resize-none rounded-xl p-3 text-sm leading-relaxed outline-none"
                  style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text-primary)', minHeight: 60 }}
                  placeholder="可选的系统提示词..."
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                />
              )}
            </div>

            {/* Prompt */}
            <div>
              <label className="text-sm font-medium mb-2 block" style={{ color: 'var(--text-secondary)' }}>测试 Prompt</label>
              <textarea
                className="w-full resize-none rounded-xl p-3 text-sm leading-relaxed outline-none"
                style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text-primary)', minHeight: 80 }}
                placeholder="输入测试消息..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); }
                }}
              />
              {/* Feature 5: pre-send token estimation */}
              <div className="text-[11px] mt-1 text-right" style={{ color: 'var(--text-muted)' }}>
                估计 tokens: ~{preSendTokens > 0 ? preSendTokens : 0}
              </div>
            </div>

            {/* Send/Stop/Clear buttons */}
            <div className="flex items-center gap-2">
              {loading ? (
                <button
                  onClick={handleStop}
                  className="flex items-center gap-2"
                  style={{ background: 'rgba(255,107,107,0.15)', color: '#FF6B6B', borderRadius: 10, padding: '8px 18px', fontWeight: 600, fontSize: 13, border: 'none', cursor: 'pointer' }}
                >
                  <Square size={14} fill="currentColor" /> 停止
                </button>
              ) : (
                <button
                  onClick={() => void handleSend()}
                  disabled={!prompt.trim()}
                  className="flex items-center gap-2"
                  style={{
                    background: prompt.trim() ? 'linear-gradient(135deg, var(--primary), var(--primary-dim))' : 'var(--surface-hover)',
                    color: prompt.trim() ? 'var(--bg)' : 'var(--text-muted)',
                    borderRadius: 10, padding: '8px 18px', fontWeight: 600, fontSize: 13,
                    border: 'none', cursor: prompt.trim() ? 'pointer' : 'not-allowed',
                    boxShadow: prompt.trim() ? '0 0 20px var(--primary-glow)' : 'none',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  发送
                </button>
              )}

              {/* Feature 1: clear history button */}
              {history.length > 0 && !loading && (
                <button
                  onClick={handleClearHistory}
                  className="flex items-center gap-1.5 text-xs"
                  style={{
                    background: 'var(--surface-hover)', color: 'var(--text-secondary)',
                    borderRadius: 10, padding: '8px 14px', fontWeight: 500,
                    border: '1px solid var(--border)', cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <Trash2 size={14} />
                  清空历史
                </button>
              )}
            </div>

            {/* Feature 3: compare mode responses side-by-side */}
            {compareMode && (compareResponse || streaming) ? (
              <div className="grid grid-cols-2 gap-4">
                {/* Primary model response */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{currentModel}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: 'var(--primary)', background: 'var(--primary-glow)', border: '1px solid var(--primary-dim)' }}>主</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {elapsedMs != null && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{elapsedMs}ms</span>}
                      {tokenCount != null && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>~{tokenCount} tokens</span>}
                    </div>
                  </div>
                  <div className="rounded-xl p-4" style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)' }}>
                    {viewMode === 'rendered' ? (
                      <MarkdownMessage source={response} streaming={streaming} />
                    ) : (
                      <pre className="text-xs leading-relaxed whitespace-pre-wrap font-mono" style={{ color: 'var(--text-primary)' }}>{rawResponse}</pre>
                    )}
                  </div>
                </div>

                {/* Compare model response */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{compareModelId.replace(/^llm\//, '')}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: 'var(--text-muted)', background: 'var(--surface-hover)', border: '1px solid var(--border)' }}>副</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {compareElapsedMs != null && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{compareElapsedMs}ms</span>}
                      {compareTokenCount != null && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>~{compareTokenCount} tokens</span>}
                      <div className="flex items-center rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                        <button
                          onClick={() => setCompareViewMode('rendered')}
                          className="text-[11px] px-2 py-0.5"
                          style={{ background: compareViewMode === 'rendered' ? 'var(--primary)' : 'transparent', color: compareViewMode === 'rendered' ? 'var(--bg)' : 'var(--text-secondary)', border: 'none', cursor: 'pointer' }}
                        >渲染</button>
                        <button
                          onClick={() => setCompareViewMode('raw')}
                          className="text-[11px] px-2 py-0.5"
                          style={{ background: compareViewMode === 'raw' ? 'var(--primary)' : 'transparent', color: compareViewMode === 'raw' ? 'var(--bg)' : 'var(--text-secondary)', border: 'none', cursor: 'pointer' }}
                        >原始</button>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-xl p-4" style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)' }}>
                    {compareViewMode === 'rendered' ? (
                      <MarkdownMessage source={compareResponse} streaming={false} />
                    ) : (
                      <pre className="text-xs leading-relaxed whitespace-pre-wrap font-mono" style={{ color: 'var(--text-primary)' }}>{compareRawResponse}</pre>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              /* Single model response (non-compare mode) */
              (response || streaming) && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>响应</label>
                    <div className="flex items-center gap-2">
                      {elapsedMs != null && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{elapsedMs}ms</span>}
                      {tokenCount != null && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>~{tokenCount} tokens</span>}
                      <div className="flex items-center rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                        <button
                          onClick={() => setViewMode('rendered')}
                          className="text-[11px] px-2 py-0.5"
                          style={{ background: viewMode === 'rendered' ? 'var(--primary)' : 'transparent', color: viewMode === 'rendered' ? 'var(--bg)' : 'var(--text-secondary)', border: 'none', cursor: 'pointer' }}
                        >渲染</button>
                        <button
                          onClick={() => setViewMode('raw')}
                          className="text-[11px] px-2 py-0.5"
                          style={{ background: viewMode === 'raw' ? 'var(--primary)' : 'transparent', color: viewMode === 'raw' ? 'var(--bg)' : 'var(--text-secondary)', border: 'none', cursor: 'pointer' }}
                        >原始</button>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-xl p-4" style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)' }}>
                    {viewMode === 'rendered' ? (
                      <MarkdownMessage source={response} streaming={streaming} />
                    ) : (
                      <pre className="text-xs leading-relaxed whitespace-pre-wrap font-mono" style={{ color: 'var(--text-primary)' }}>{rawResponse}</pre>
                    )}
                  </div>
                </div>
              )
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
