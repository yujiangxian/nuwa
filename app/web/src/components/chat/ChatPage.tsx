// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useUIStore, type ChatMessage } from '@/store/uiStore';
import { useToastStore } from '@/store/toastStore';
import { errorMessage } from '@/lib/errorDetail';
import { useTranscribe, useSynthesize, useConfig, useVoices, useModels } from '@/hooks/useApi';
import { useRecorder } from '@/hooks/useRecorder';
import { useAudioQueue } from '@/hooks/useAudioQueue';
import { resolveVoiceRef } from '@/lib/voice';
import { organizeSessions } from '@/lib/sessionOrganize';
import { resolveContextLength } from '@/lib/contextWindow';
import { resolveReservedTokens, computeBudget } from '@/lib/contextBudget';
import { normalizeQuery, DEBOUNCE_INTERVAL, type SearchResult } from '@/lib/chatSearch';
import { INPUT_MAX_LENGTH, processTemplateVariables } from '@/lib/promptPreset';
import {
  isSlashActive, parseSlashQuery, buildCommandCatalog, filterCommands,
  clampHighlightIndex, buildInsertedPresetText, type CommandItem,
} from '@/lib/slashCommand';
import { ArrowLeft, Settings, User, Monitor, Code } from 'lucide-react';
import { apiUrl } from '@/api/client';
import { useAssistantStream } from './useAssistantStream';
import { SessionSidebar, DRAFT_KEY } from './SessionSidebar';
import { MessageList } from './MessageList';
import { ChatComposer } from './ChatComposer';

export function ChatPage() {
  const setPage = useUIStore((s) => s.setPage);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const agents = useUIStore((s) => s.agents);
  const currentAgentId = useUIStore((s) => s.currentAgentId);
  const setCurrentAgent = useUIStore((s) => s.setCurrentAgent);
  const bindSessionAgent = useUIStore((s) => s.bindSessionAgent);
  const sessions = useUIStore((s) => s.sessions);
  const currentSessionId = useUIStore((s) => s.currentSessionId);
  const messages = useUIStore((s) => s.messages);
  const sessionsLoading = useUIStore((s) => s.sessionsLoading);
  const inputText = useUIStore((s) => s.inputText);
  const setInputText = useUIStore((s) => s.setInputText);
  // Prompt_Preset：预设列表（只读，供斜杠命令目录构建）。
  const presets = useUIStore((s) => s.presets);
  const createSession = useUIStore((s) => s.createSession);
  const switchSession = useUIStore((s) => s.switchSession);
  const deleteSession = useUIStore((s) => s.deleteSession);
  const renameSession = useUIStore((s) => s.renameSession);
  const togglePin = useUIStore((s) => s.togglePin);
  const appendMessage = useUIStore((s) => s.appendMessage);
  const deleteMessage = useUIStore((s) => s.deleteMessage);
  const regenerateLast = useUIStore((s) => s.regenerateLast);
  const editAndResend = useUIStore((s) => s.editAndResend);
  const autoPlay = useUIStore((s) => s.settings.autoPlay);
  const addToast = useToastStore((s) => s.addToast);

  // Context_Window：本次外发裁剪计数。
  const setLastTrimmedCount = useUIStore((s) => s.setLastTrimmedCount);
  const lastTrimmedCount = useUIStore((s) => s.lastTrimmedCount);

  // Chat_Search 订阅：查询文本、结果、检索中标志与三个 action。
  const searchQuery = useUIStore((s) => s.searchQuery);
  const searchResults = useUIStore((s) => s.searchResults);
  const isSearching = useUIStore((s) => s.isSearching);
  const setSearchQuery = useUIStore((s) => s.setSearchQuery);
  const runSearch = useUIStore((s) => s.runSearch);
  const clearSearch = useUIStore((s) => s.clearSearch);
  // 搜索视图开关：由规范化后查询非空派生，清空输入即时恢复会话列表（Req 1.4）。
  const showSearch = normalizeQuery(searchQuery) !== '';

  // 推理相关 hooks：ASR 上传、TTS 合成、当前模型配置、参考音色列表
  const transcribe = useTranscribe();
  const synthesize = useSynthesize();
  const { data: config } = useConfig();
  const { data: voices = [] } = useVoices();
  const { data: models = [] } = useModels();
  const recorder = useRecorder();
  const player = useAudioQueue();

  // 当前 ASR/TTS 模型：优先 current_models[type]，回退兼容字段
  const currentAsrModel = config?.current_models?.asr ?? config?.current_asr_model ?? undefined;
  const currentTtsModel = config?.current_models?.tts ?? config?.current_tts_model ?? undefined;
  const currentLlmModel = config?.current_models?.llm ?? config?.current_llm_model ?? 'gemma4:e4b';

  // Character dropdown state → Agent picker
  const [charMenuOpen, setCharMenuOpen] = useState(false);
  // Regenerate temperature dropdown state
  const [regenMenuOpen, setRegenMenuOpen] = useState(false);
  const [asrLoading, setAsrLoading] = useState(false);

  // 会话生命周期 UI 的本地交互态：删除二次确认与内联重命名编辑。
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  // Edit_Resend_Action 内联编辑态：当前编辑的 user 消息 id 与编辑草稿（预填原 content）。
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  // Slash_Command 本地态：当前高亮项候选下标（渲染时经 clampHighlightIndex 规整），
  // 以及 Escape/选中后临时关闭菜单的标志（输入变化即重置以便重新弹出）。
  const [slashHighlight, setSlashHighlight] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  // 供全局 Escape 处理器同步读取当前菜单可见性，避免闭包过期（见下方 keydown effect）。
  const slashMenuVisibleRef = useRef(false);

  // System prompt visibility and temporary edit state
  const [tempSystemPrompt, setTempSystemPrompt] = useState<string | null>(null);
  const [sysPromptOpen, setSysPromptOpen] = useState(false);

  // Audio playback speed
  const [playbackRate, setPlaybackRate] = useState(1);

  // Command palette access
  const openPalette = useUIStore((s) => s.openPalette);

  const currentAgent = agents.find((a) => a.id === currentAgentId);
  const activePersona = currentAgent;
  const currentVoice = voices.find((v) => v.id === activePersona?.voiceId)?.name ?? '默认音色';

  // Context_Window：当前 LLM 模型上下文长度候选值。InstalledModel 元数据暂无该字段，
  // 故为 undefined → Context_Resolver 回退默认值并标记为估算（forward-compatible）。
  const activeModelContextLength: number | undefined = useMemo(() => {
    if (!currentLlmModel) return undefined;
    const model = models.find((m: { id: string; context_length?: number }) => m.id === `llm/${currentLlmModel}` || m.id === currentLlmModel);
    return model?.context_length ?? undefined;
  }, [currentLlmModel, models]);

  const {
    isTyping,
    isStreaming,
    streamingContent,
    streamingThinking,
    thinkOpen,
    setThinkOpen,
    accRef,
    thinkRef,
    ttsLoadingId,
    setTtsLoadingId,
    ttsPendingMsgId,
    sendingRef,
    sseCompletedRef,
    ttsStartedAtRef,
    ttsSynthCount,
    ttsSynthDone,
    runAssistantStream,
    handleStop,
  } = useAssistantStream({
    currentAgent,
    currentVoice,
    autoPlay,
    synthesize,
    currentTtsModel,
    voices,
    appendMessage,
    setLastTrimmedCount,
    activeModelContextLength,
    tempSystemPrompt,
    player,
    addToast,
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Input_Field（底部输入框 textarea）的 ref：插入预设成功后用于 .focus()。
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping, streamingContent]);

  // 消息定位：按 message id 收集 DOM ref，记录点击结果后待滚动的目标消息。
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);

  // 防抖触发检索（Req 8.1 / 8.2）：规范化后为空不触发；否则 200ms 后运行一次检索，
  // 计时内再次输入则清理上一次计时，保证仅以最新查询触发一次。
  useEffect(() => {
    if (normalizeQuery(searchQuery) === '') return;
    const timer = setTimeout(() => { void runSearch(); }, DEBOUNCE_INTERVAL);
    return () => clearTimeout(timer);
  }, [searchQuery, runSearch]);

  // messages 变更后尝试滚动到目标消息（Req 7.2）；ref 缺失则不滚动并清空（Req 7.3）。
  useEffect(() => {
    if (!pendingScrollId) return;
    const el = messageRefs.current.get(pendingScrollId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setPendingScrollId(null);
  }, [messages, pendingScrollId]);

  // 点击检索结果：切换到对应会话（Req 7.1）→ 退出搜索视图恢复会话列表（Req 7.4）→
  // Message_Match 且有 messageId 时记录待滚动目标（滚动在 messages 更新后的 effect 中执行）。
  const handleResultClick = useCallback(async (result: SearchResult) => {
    await switchSession(result.sessionId);
    clearSearch();
    if (result.matchType === 'message' && result.messageId) {
      setPendingScrollId(result.messageId);
    }
  }, [switchSession, clearSearch]);

  // 麦克风不可用时提示用户（文本输入始终保留作为替代）
  useEffect(() => {
    if (recorder.error) {
      addToast({ message: recorder.error, type: 'error' });
    }
  }, [recorder.error, addToast]);

  // Draft persistence: restore draft for current session on mount or session switch
  useEffect(() => {
    if (currentSessionId) {
      const draft = localStorage.getItem(`${DRAFT_KEY}:${currentSessionId}`);
      setInputText(draft ?? '');
    }
    // Only run on mount (currentSessionId being set for the first time)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId]);

  // Auto-save draft to localStorage whenever inputText changes
  useEffect(() => {
    if (currentSessionId) {
      localStorage.setItem(`${DRAFT_KEY}:${currentSessionId}`, inputText);
    }
  }, [inputText, currentSessionId]);

  // 合成并播放某条 assistant 消息的 TTS（自动朗读与手动朗读共用）
  const speakMessage = useCallback(async (msg: ChatMessage) => {
    setTtsLoadingId(msg.id);
    try {
      const ref = resolveVoiceRef(activePersona?.voiceId, voices);
      const res = await synthesize.mutateAsync({
        text: msg.content,
        modelId: currentTtsModel,
        refAudio: ref.ref_audio,
        refText: ref.ref_text,
      });
      if (res.success && res.output_path) {
        useUIStore.getState().updateMessageAudio(msg.id, res.output_path);
        player.playNow(msg.id, apiUrl(`/api/audio/${res.output_path}`));
      } else {
        addToast({ message: res.error || 'TTS 合成失败', type: 'error' });
      }
    } catch (err: unknown) {
      addToast({ message: errorMessage(err, 'TTS 请求失败'), type: 'error' });
    } finally {
      setTtsLoadingId(null);
    }
  }, [activePersona, voices, currentTtsModel, synthesize, player, addToast, setTtsLoadingId]);

  const handleSend = useCallback(async () => {
    if (!inputText.trim() || isTyping || sendingRef.current) return;
    sendingRef.current = true;

    // 1) 用户消息落库（appendMessage 负责 push、自动标题、更新 updatedAt 与持久化）。
    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', content: inputText };
    await appendMessage(userMsg);
    setInputText('');

    // Save draft (cleared after send)
    if (currentSessionId) {
      localStorage.setItem(`${DRAFT_KEY}:${currentSessionId}`, '');
    }

    // Reset textarea height and re-focus
    const ta = document.querySelector('textarea');
    if (ta) { ta.style.height = 'auto'; ta.focus(); }

    // 2) history 取发送前的 store messages 快照，再拼上本次用户消息（与既有 /api/chat 一致），
    //    交由可复用的 runAssistantStream 完成建连/流式/降级/定型/朗读。
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    const payloadMessages = [...history, { role: 'user', content: userMsg.content }];
    await runAssistantStream(payloadMessages);
  }, [inputText, isTyping, messages, setInputText, appendMessage, runAssistantStream, currentSessionId, sendingRef]);

  // Keyboard shortcuts: Ctrl+K for palette, Ctrl+N for new session, Escape for stop/clear
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in input/textarea (except Escape)
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA';
      if (isInput && e.key !== 'Escape') return;

      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault();
        openPalette();
        return;
      }
      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        createSession(currentAgentId);
        return;
      }
      if (e.key === 'Escape') {
        if (isTyping) {
          e.preventDefault();
          handleStop();
        } else if (isInput) {
          // 斜杠菜单打开时，Escape 已被 textarea 自身的 onKeyDown 消费用于关闭菜单
          // （见下方 slashMenuVisible 相关 handler），此处不应再清空输入文本。
          // 仅当菜单未激活时，Escape 才清空 inputText。
          const ta = e.target as HTMLTextAreaElement;
          if (ta.value && !slashMenuVisibleRef.current) {
            setInputText('');
          }
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isTyping, currentAgentId, openPalette, createSession, handleStop, setInputText]);

  // Copy_Action：Clipboard API → execCommand 两级回退，确保非安全上下文也可用。
  const handleCopy = useCallback(async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      addToast({ message: '已复制', type: 'success' });
      return;
    } catch { /* Clipboard API unavailable — try fallback */ }
    // Fallback: legacy execCommand (works in non-secure contexts, iframes, old browsers)
    try {
      const ta = document.createElement('textarea');
      ta.value = content;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) {
        addToast({ message: '已复制', type: 'success' });
      } else {
        addToast({ message: '复制失败', type: 'error' });
      }
    } catch {
      addToast({ message: '复制失败', type: 'error' });
    }
  }, [addToast]);

  // Regenerate_Action：Generating_State 时禁用（Req 1.4）；移除 Last_Assistant_Message
  // 后以截断历史复用 runAssistantStream 重新生成（Placeholder 由 isStreaming 渲染，Req 2.2）。
  // handleStop 对 runAssistantStream 创建的同一 abortController 生效，故生成中可停止（Req 2.6/2.7）。
  // 可选 temperature 参数：传入时临时设置 chatGenParams.temperature 再发起生成。
  const handleRegenerate = useCallback(async (temperature?: number) => {
    if (isTyping) return; // Req 1.4：生成中禁止再次发起
    if (temperature !== undefined) {
      useUIStore.getState().setChatParam('temperature', temperature);
    }
    const history = await regenerateLast();
    if (history === null) return; // 无 Last_Assistant_Message：不进入生成态（Req 2.1）
    await runAssistantStream(history);
  }, [isTyping, regenerateLast, runAssistantStream]);

  // Edit_Resend_Action 入口：以原 content 预填进入内联编辑态（Req 3.1）。
  // 生成中禁用（Req 1.4，按钮可用性已由 actionAvailabilityFor 控制，这里再防御一次）。
  const handleEditEntry = useCallback((msg: ChatMessage) => {
    if (isTyping) return;
    setEditingId(msg.id);
    setEditDraft(msg.content);
  }, [isTyping]);

  // 取消内联编辑：仅清理本地态，不改任何消息（Req 3.2）。
  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditDraft('');
  }, []);

  // 提交 Edit_Resend：清理编辑态后调用 editAndResend；返回 null（取消/空内容/非 user）
  // 则不发起生成（Req 3.2/3.3）；否则以截断后历史复用 runAssistantStream（Req 3.6/3.8）。
  const submitEdit = useCallback(async (messageId: string) => {
    if (isTyping) return; // Req 1.4：生成中禁止再次发起
    const draft = editDraft;
    setEditingId(null);
    setEditDraft('');
    const history = await editAndResend(messageId, draft);
    if (history === null) return; // 取消/空内容/非 user 消息：不发起生成
    await runAssistantStream(history);
  }, [isTyping, editDraft, editAndResend, runAssistantStream]);

  const handleToggleRecord = useCallback(async () => {
    if (recorder.isRecording) {
      const blob = await recorder.stop();
      if (!blob) {
        addToast({ message: '录音太短，请重试', type: 'info' });
        return;
      }
      setAsrLoading(true);
      try {
        const data = await transcribe.mutateAsync({ audio: blob, modelId: currentAsrModel });
        if (data.success && data.text) {
          setInputText(data.text);
          addToast({ message: '语音识别完成', type: 'success' });
        } else {
          addToast({ message: data.error || '语音识别失败', type: 'error' });
        }
      } catch (err: unknown) {
        addToast({ message: errorMessage(err, '语音识别失败'), type: 'error' });
      } finally {
        setAsrLoading(false);
      }
      return;
    }
    // 开始录音（麦克风不可用时 useRecorder 会设置 error，由 useEffect 提示）
    await recorder.start();
  }, [recorder, transcribe, currentAsrModel, setInputText, addToast]);

  const handlePlayTTS = useCallback((msg: ChatMessage) => {
    if (player.isPlaying(msg.id)) {
      player.clear();
      return;
    }
    if (ttsLoadingId === msg.id) return;
    if (ttsPendingMsgId === msg.id) return;
    if (msg.audioUrl) {
      // Handle streaming TTS segments (comma-separated paths) vs single full-text audio
      const paths = msg.audioUrl.split(',');
      if (paths.length > 1) {
        // Streaming: play first segment immediately, enqueue the rest
        player.playNow(`${msg.id}-s0`, apiUrl(`/api/audio/${paths[0]}`));
        paths.slice(1).forEach((p, i) => {
          player.enqueue(`${msg.id}-s${i + 1}`, apiUrl(`/api/audio/${p}`));
        });
      } else {
        player.playNow(msg.id, apiUrl(`/api/audio/${paths[0]}`));
      }
      return;
    }
    void speakMessage(msg);
  }, [player, ttsLoadingId, ttsPendingMsgId, speakMessage]);

  // 进入内联重命名编辑态，预填当前标题。
  const startRename = useCallback((id: string, title: string) => {
    setRenamingId(id);
    setRenameDraft(title);
  }, []);

  // 提交重命名（trim 语义由 store.renameSession 处理：空白则保持原值）。
  const submitRename = useCallback((id: string) => {
    void renameSession(id, renameDraft);
    setRenamingId(null);
    setRenameDraft('');
  }, [renameSession, renameDraft]);

  // ── Slash_Command 集成 ──────────────────────────────────────────────
  // 渲染期从 inputText 与 presets 即时派生（无新增 store 字段，无跨次可变状态）。
  const slashActive = isSlashActive(inputText);
  const slashQuery = parseSlashQuery(inputText);
  const slashCatalog = useMemo(() => buildCommandCatalog(presets), [presets]);
  const slashFiltered = slashActive && !slashDismissed
    ? filterCommands(slashCatalog, slashQuery ?? '')
    : [];
  // 菜单可见性：激活、未被临时关闭、且过滤结果非空（Req 4.1, 4.2）。
  const slashMenuVisible = slashFiltered.length > 0;
  // 规整后的合法高亮下标（空列表为 -1）（Req 4.3）。
  const slashHl = clampHighlightIndex(slashHighlight, slashFiltered.length);

  useEffect(() => {
    slashMenuVisibleRef.current = slashMenuVisible;
  }, [slashMenuVisible]);

  // 关闭斜杠菜单但保留 Input_Field 文本（Escape/选中后用）（Req 4.8）。
  const closeSlashMenu = useCallback(() => {
    setSlashDismissed(true);
    setSlashHighlight(0);
  }, []);

  // 选中某 Command_Item 并执行（Req 5.1–5.7）。
  const selectCommand = useCallback((item: CommandItem) => {
    if (item.kind === 'preset') {
      const preset = presets.find((p) => p.id === item.presetId);
      if (preset) {
        const processed = processTemplateVariables(preset.content);
        const text = buildInsertedPresetText(processed);
        if (Array.from(text).length > INPUT_MAX_LENGTH) {
          // 超长：保持原文不变并提示（Req 5.3）。
          addToast({ message: '内容超出长度上限，无法插入', type: 'warning' });
        } else {
          setInputText(text); // 用预设 content 替换整段斜杠查询（Req 5.1）。
          inputRef.current?.focus();
        }
      }
    } else {
      switch (item.commandKey) {
        case 'clear':
          setInputText(''); // Req 5.4
          break;
        case 'retry':
          // 复用既有重新生成链路：无 Last_Assistant_Message 时内部直接返回（Req 5.5, 5.6）。
          void handleRegenerate();
          break;
        case 'presets':
          setPage('presets'); // Req 5.7
          break;
      }
    }
    closeSlashMenu(); // 任一选中后关闭菜单（Req 5.2）。
  }, [presets, addToast, setInputText, handleRegenerate, setPage, closeSlashMenu]);

  // Session_Organize：以 sessions 为依赖的 memo 分组，避免每次渲染重复计算
  const sessionGroups = useMemo(() => organizeSessions(sessions, new Date()), [sessions]);

  return (
    <div className="flex flex-col h-full relative" style={{ zIndex: 10 }}>
      {/* Header */}
      <header className="relative z-20 flex items-center justify-between px-5 py-3 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-3">
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
              <User size={16} style={{ color: 'var(--bg)' }} />
            </div>
            <span className="text-base font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>女娲</span>
            <button
              aria-label="系统提示词"
              className="flex items-center justify-center"
              style={{ width: 28, height: 28, borderRadius: 8, color: sysPromptOpen ? 'var(--primary)' : 'var(--text-muted)', background: sysPromptOpen ? 'rgba(72,202,228,0.12)' : 'transparent', border: 'none', cursor: 'pointer', transition: 'all 0.2s ease' }}
              onClick={() => setSysPromptOpen((v) => !v)}
              onMouseEnter={(e) => { if (!sysPromptOpen) { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'; } }}
              onMouseLeave={(e) => { if (!sysPromptOpen) { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'; } }}
            >
              <Code size={14} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full glass" style={{ border: '1px solid var(--border)' }}>
            <Monitor size={14} style={{ color: 'var(--text-secondary)' }} />
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{currentLlmModel?.replace(/^llm\//, '')}</span>
          </div>
          {/* Agent dropdown */}
          <div className="relative">
            <button
              className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full glass"
              style={{ border: '1px solid var(--border)', cursor: 'pointer', background: charMenuOpen ? 'rgba(72,202,228,0.08)' : undefined }}
              onClick={() => setCharMenuOpen((v) => !v)}
            >
              <div className="w-4 h-4 rounded-full" style={{ background: activePersona?.avatar || 'linear-gradient(135deg, #48CAE4, #0096C7)' }} />
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{activePersona?.name ?? 'Agent'}</span>
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>▼</span>
            </button>
            {charMenuOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setCharMenuOpen(false)} />
                <div className="glass rounded-xl" style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 50, width: 240, maxHeight: 280, overflowY: 'auto', border: '1px solid var(--border)', boxShadow: '0 8px 32px rgba(0,0,0,0.35)', padding: 6 }}>
                  {agents.length === 0 && (
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-xs rounded-lg"
                      style={{ color: 'var(--primary)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                      onClick={() => { setCharMenuOpen(false); setPage('agents'); }}
                    >
                      前往创建 Agent…
                    </button>
                  )}
                  {agents.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => {
                        setCurrentAgent(a.id);
                        if (currentSessionId) void bindSessionAgent(currentSessionId, a.id);
                        setCharMenuOpen(false);
                        setTempSystemPrompt(null);
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all"
                      style={{ background: a.id === currentAgentId ? 'rgba(72,202,228,0.08)' : 'transparent', border: 'none', cursor: 'pointer' }}
                      onMouseEnter={(e) => { if (a.id !== currentAgentId) (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)'; }}
                      onMouseLeave={(e) => { if (a.id !== currentAgentId) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                    >
                      <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: a.avatar }}>
                        <User size={10} style={{ color: 'white' }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{a.name}</div>
                        <div className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>{a.description || a.pipeline}</div>
                      </div>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-[11px] rounded-lg mt-1"
                    style={{ color: 'var(--text-muted)', background: 'transparent', border: 'none', borderTop: '1px solid var(--border)', cursor: 'pointer' }}
                    onClick={() => { setCharMenuOpen(false); setPage('agents'); }}
                  >
                    管理 Agent…
                  </button>
                </div>
              </>
            )}
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

      {/* System prompt collapsible editor */}
      {sysPromptOpen && (
        <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--border)', background: 'rgba(72,202,228,0.03)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>系统提示词（临时编辑，仅本次会话生效）</span>
            <button
              aria-label="重置系统提示词"
              className="text-xs px-2 py-1 rounded"
              style={{ color: 'var(--text-muted)', background: 'transparent', border: '1px solid var(--border)', cursor: 'pointer' }}
              onClick={() => setTempSystemPrompt(null)}
            >
              重置为默认
            </button>
          </div>
          <textarea
            className="w-full outline-none resize-none rounded-lg text-sm leading-relaxed"
            style={{ padding: '8px 12px', minHeight: 80, color: 'var(--text-primary)', background: 'var(--surface-hover)', border: '1px solid var(--border)', caretColor: 'var(--primary)' }}
            value={tempSystemPrompt ?? activePersona?.systemPrompt ?? ''}
            onChange={(e) => setTempSystemPrompt(e.target.value || null)}
          />
        </div>
      )}

      <div className="flex flex-1 min-h-0 relative">
        <SessionSidebar
          currentAgentId={currentAgentId}
          createSession={createSession}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          showSearch={showSearch}
          clearSearch={clearSearch}
          searchResults={searchResults}
          isSearching={isSearching}
          onResultClick={handleResultClick}
          sessionsLoading={sessionsLoading}
          sessions={sessions}
          sessionGroups={sessionGroups}
          currentSessionId={currentSessionId}
          isTyping={isTyping}
          inputText={inputText}
          onStop={handleStop}
          switchSession={switchSession}
          renamingId={renamingId}
          renameDraft={renameDraft}
          setRenameDraft={setRenameDraft}
          setRenamingId={setRenamingId}
          submitRename={submitRename}
          startRename={startRename}
          confirmDeleteId={confirmDeleteId}
          setConfirmDeleteId={setConfirmDeleteId}
          deleteSession={deleteSession}
          togglePin={togglePin}
        />

        {/* Main Chat Area */}
        <main className="flex-1 flex flex-col min-w-0 relative">
          {/* Token usage progress bar */}
          {(() => {
            const ctx = resolveContextLength(activeModelContextLength);
            const reserved = resolveReservedTokens(useUIStore.getState().chatGenParams);
            const budget = computeBudget({
              contextLength: ctx.contextLength,
              isEstimated: ctx.isEstimated,
              systemPrompt: tempSystemPrompt ?? activePersona?.systemPrompt ?? '',
              messages,
              reservedTokens: reserved,
            });
            const pct = Math.min(budget.usageRatio * 100, 100);
            const barColor = budget.usageState === 'over' ? '#FF6B6B' : budget.usageState === 'warning' ? '#FFB347' : 'var(--primary)';
            return (
              <div className="px-4 md:px-8 py-1 shrink-0" style={{ background: 'rgba(72,202,228,0.02)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    Tokens: {budget.usedTokens}/{budget.contextLength}
                  </span>
                  <div className="flex-1 h-1 rounded-full" style={{ background: 'var(--surface-hover)' }}>
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{ width: `${pct}%`, background: barColor }}
                    />
                  </div>
                </div>
              </div>
            );
          })()}
          {lastTrimmedCount > 0 && (
            <div className="px-4 md:px-8 py-1 text-center" style={{ background: 'rgba(255,179,71,0.08)' }}>
              <span className="text-[10px]" style={{ color: '#FFB347' }}>
                上下文窗口不足，已裁剪较早的 {lastTrimmedCount} 条消息
              </span>
            </div>
          )}
          <MessageList
            messages={messages}
            messageRefs={messageRefs}
            currentCharacter={activePersona}
            editingId={editingId}
            editDraft={editDraft}
            setEditDraft={setEditDraft}
            submitEdit={submitEdit}
            cancelEdit={cancelEdit}
            isTyping={isTyping}
            regenMenuOpen={regenMenuOpen}
            setRegenMenuOpen={setRegenMenuOpen}
            onCopy={handleCopy}
            onEdit={handleEditEntry}
            onRegenerate={handleRegenerate}
            onDelete={deleteMessage}
            player={player}
            ttsLoadingId={ttsLoadingId}
            ttsPendingMsgId={ttsPendingMsgId}
            ttsSynthCount={ttsSynthCount}
            ttsSynthDone={ttsSynthDone}
            onPlayTTS={handlePlayTTS}
            isStreaming={isStreaming}
            streamingThinking={streamingThinking}
            thinkOpen={thinkOpen}
            setThinkOpen={setThinkOpen}
            thinkRef={thinkRef}
            streamingContent={streamingContent}
            currentLlmModel={currentLlmModel}
            accRef={accRef}
            ttsStartedAtRef={ttsStartedAtRef}
            autoPlay={autoPlay}
            sseCompletedRef={sseCompletedRef}
            messagesEndRef={messagesEndRef}
          />

          <ChatComposer
            inputRef={inputRef}
            inputText={inputText}
            setInputText={setInputText}
            slashMenuVisible={slashMenuVisible}
            slashFiltered={slashFiltered}
            slashHl={slashHl}
            setSlashHighlight={setSlashHighlight}
            setSlashDismissed={setSlashDismissed}
            selectCommand={selectCommand}
            closeSlashMenu={closeSlashMenu}
            isTyping={isTyping}
            handleSend={handleSend}
            handleStop={handleStop}
            autoPlay={autoPlay}
            player={player}
            playbackRate={playbackRate}
            setPlaybackRate={setPlaybackRate}
            recorder={recorder}
            asrLoading={asrLoading}
            handleToggleRecord={handleToggleRecord}
          />
        </main>
      </div>
    </div>
  );
}

export default ChatPage;
