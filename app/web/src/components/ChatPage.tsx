// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useUIStore, type ChatMessage } from '@/store/uiStore';
import { useToastStore } from '@/store/toastStore';
import { apiClient } from '@/api/client';
import { errorMessage, type ErrorDetail } from '@/lib/errorDetail';
import { useTranscribe, useSynthesize, useConfig, useVoices, useModels } from '@/hooks/useApi';
import { useRecorder } from '@/hooks/useRecorder';
import { useAudioQueue } from '@/hooks/useAudioQueue';
import { resolveVoiceRef } from '@/lib/voice';
import { formatRelativeTime } from '@/lib/chatSession';
import { organizeSessions, isPinned } from '@/lib/sessionOrganize';
import { accumulateDelta, shouldPersistFinal, type StreamChunk } from '@/lib/streamChat';
import { buildRequestFragment } from '@/lib/generationParams';
import { resolveContextLength } from '@/lib/contextWindow';
import { resolveReservedTokens } from '@/lib/contextBudget';
import { trimMessages } from '@/lib/contextTrim';
import { estimateText } from '@/lib/tokenEstimate';
import { actionAvailabilityFor } from '@/lib/messageActions';
import { normalizeQuery, DEBOUNCE_INTERVAL, type SearchResult, type HighlightRange } from '@/lib/chatSearch';
import { INPUT_MAX_LENGTH, processTemplateVariables } from '@/lib/promptPreset';
import {
  isSlashActive, parseSlashQuery, buildCommandCatalog, filterCommands,
  clampHighlightIndex, buildInsertedPresetText, type CommandItem,
} from '@/lib/slashCommand';
import SlashCommandMenu from '@/components/SlashCommandMenu';
import MarkdownMessage from '@/components/MarkdownMessage';
import { computeBudget } from '@/lib/contextBudget';
import { extractNewSentences } from '@/lib/sentenceSplit';
import { ArrowLeft, Settings, Plus, Play, Mic, Send, MessageSquare, User, Square, Monitor, Loader2, Trash2, Check, X, Copy, RotateCcw, Pencil, Search, Pin, PinOff, Code, ThumbsUp, ThumbsDown, ChevronDown } from 'lucide-react';

const DRAFT_KEY = 'nuwa_chat_draft';

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * 依据 HighlightRange[] 将 Match_Snippet 切成普通段与高亮段，<mark> 包裹高亮段。
 *
 * 以 `Array.from` 按 Unicode 码点切片（与 chatSearch 的区间语义一致），避免破坏
 * emoji / 代理对等多字节字符。highlights 已保证升序且互不重叠。
 */
function renderHighlightedSnippet(snippet: string, highlights: HighlightRange[]): React.ReactNode[] {
  const cps = Array.from(snippet);
  const nodes: React.ReactNode[] = [];
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

export default function ChatPage() {
  const setPage = useUIStore((s) => s.setPage);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const characters = useUIStore((s) => s.characters);
  const currentCharacterId = useUIStore((s) => s.currentCharacterId);
  const setCurrentCharacter = useUIStore((s) => s.setCurrentCharacter);
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

  const [isTyping, setIsTyping] = useState(false);
  // Character dropdown state
  const [charMenuOpen, setCharMenuOpen] = useState(false);
  // Regenerate temperature dropdown state
  const [regenMenuOpen, setRegenMenuOpen] = useState(false);
  // 流式生成本地态（不入 uiStore）：占位/打字机内容与累积引用、中断控制器。
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingThinking, setStreamingThinking] = useState('');
  const [thinkOpen, setThinkOpen] = useState(true);
  const accRef = useRef('');
  const thinkRef = useRef('');
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [ttsLoadingId, setTtsLoadingId] = useState<string | null>(null);
  // Track which message currently has sentence-level TTS still running (not yet all done)
  const [ttsPendingMsgId, setTtsPendingMsgId] = useState<string | null>(null);
  const [asrLoading, setAsrLoading] = useState(false);
  // Streaming TTS: track sentence boundary and message ID
  const sentBoundaryRef = useRef(0);
  const streamingMsgIdRef = useRef<string | null>(null);
  const streamLlmDoneRef = useRef(false);
  const sendingRef = useRef(false);
  const abortedTtsRef = useRef(false);
  const sseCompletedRef = useRef(false);
  const streamTotalDurRef = useRef(0);
  const ttsStartedAtRef = useRef(0);
  const MAX_STREAM_SENTENCES = 20;
  // Collect all TTS audio file paths during streaming for persistence
  const streamAudioPathsRef = useRef<string[]>([]);
  // Pipeline status display
  const [ttsSynthCount, setTtsSynthCount] = useState(0);
  const [ttsSynthDone, setTtsSynthDone] = useState(0);

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

  // System prompt visibility and temporary edit state
  const [tempSystemPrompt, setTempSystemPrompt] = useState<string | null>(null);
  const [sysPromptOpen, setSysPromptOpen] = useState(false);

  // Audio playback speed
  const [playbackRate, setPlaybackRate] = useState(1);

  // Command palette access
  const openPalette = useUIStore((s) => s.openPalette);

  const currentCharacter = characters.find((c) => c.id === currentCharacterId);
  // 当前音色名经 voices 解析 currentCharacter.voiceId（去写死映射）；未命中回退占位。
  const currentVoice = voices.find((v) => v.id === currentCharacter?.voiceId)?.name ?? '默认音色';

  // Context_Window：当前 LLM 模型上下文长度候选值。InstalledModel 元数据暂无该字段，
  // 故为 undefined → Context_Resolver 回退默认值并标记为估算（forward-compatible）。
  const activeModelContextLength: number | undefined = useMemo(() => {
    if (!currentLlmModel) return undefined;
    const model = models.find((m: any) => m.id === `llm/${currentLlmModel}` || m.id === currentLlmModel);
    return model?.context_length ?? undefined;
  }, [currentLlmModel, models]);

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
      const ref = resolveVoiceRef(currentCharacter?.voiceId, voices);
      const res = await synthesize.mutateAsync({
        text: msg.content,
        modelId: currentTtsModel,
        refAudio: ref.ref_audio,
        refText: ref.ref_text,
      });
      if (res.success && res.output_path) {
        useUIStore.getState().updateMessageAudio(msg.id, res.output_path);
        player.playNow(msg.id, `/api/audio/${res.output_path}`);
      } else {
        addToast({ message: res.error || 'TTS 合成失败', type: 'error' });
      }
    } catch (err: unknown) {
      addToast({ message: errorMessage(err, 'TTS 请求失败'), type: 'error' });
    } finally {
      setTtsLoadingId(null);
    }
  }, [currentCharacter, voices, currentTtsModel, synthesize, player, addToast]);

  /**
   * 以给定对话历史发起一次流式 assistant 生成并定型（可复用）。
   * 复用 streamChat 纯逻辑与既有 /api/chat/stream、/api/chat 降级链路。
   * 调用方负责在调用前已将 history 对应的状态写入 store messages
   * （落用户消息 / 截断 / 移除末条 assistant）。
   * handleSend、handleRegenerate、submitEdit 三处共用，消除重复。
   */
  const runAssistantStream = useCallback(
    async (payloadMessages: { role: string; content: string }[]) => {
      // 进入流式生成态：展示 assistant 占位气泡（本地态，不入 store）。
      setIsTyping(true);
      setIsStreaming(true);
      setStreamingContent('');
      setStreamingThinking('');
      setThinkOpen(true);
      thinkRef.current = '';
      setTtsSynthCount(0);
      setTtsSynthDone(0);
      streamAudioPathsRef.current = [];
      streamTotalDurRef.current = 0;
      ttsStartedAtRef.current = Date.now();
      streamLlmDoneRef.current = false;
      abortedTtsRef.current = false;
      sseCompletedRef.current = false;
      accRef.current = '';
      const ctrl = new AbortController();
      setAbortController(ctrl);
      const system = tempSystemPrompt ?? currentCharacter?.systemPrompt;

      // chat-generation-parameters：合并当前 Active 生成参数（Default_State 为 {}，逐字段无回归）。
      const genFragment = buildRequestFragment(useUIStore.getState().chatGenParams);

      // context-window-management：在将超上下文预算时裁剪历史消息（始终保留 System_Prompt
      // 与 Latest_User_Message）。裁剪只减少随请求下发的 messages 条数，请求体形状不变。
      const { contextLength } = resolveContextLength(activeModelContextLength);
      const reservedTokens = resolveReservedTokens(useUIStore.getState().chatGenParams);
      const trimInput: ChatMessage[] = payloadMessages.map((m, i) => ({
        id: `send-${i}`,
        role: m.role as ChatMessage['role'],
        content: m.content,
      }));
      const { messages: trimmed, trimmedCount } = trimMessages({
        messages: trimInput,
        systemPromptTokens: estimateText(system ?? ''),
        contextLength,
        reservedTokens,
      });
      setLastTrimmedCount(trimmedCount);
      // 下发体仅取 role/content，确保不新增任何后端字段（契约不变）。
      const sendMessages = trimmed.map((m) => ({ role: m.role, content: m.content }));

      let streamErrorMsg: string | null = null;
      let ttsSentenceCount = 0;

      // Pre-assign a streaming message ID for TTS segments
      const streamMsgId = (Date.now() + 1).toString();
      streamingMsgIdRef.current = streamMsgId;
      sentBoundaryRef.current = 0;

      // Streaming TTS: detect complete sentences in each delta and enqueue TTS
      const onChunk = (chunk: StreamChunk) => {
        if (typeof chunk.delta === 'string') {
          accRef.current = accumulateDelta(accRef.current, chunk);
          setStreamingContent(accRef.current);

          if (autoPlay && ttsSentenceCount < MAX_STREAM_SENTENCES) {
            const { sentences, boundary } = extractNewSentences(accRef.current, sentBoundaryRef.current);
            if (sentences.length > 0 && boundary > sentBoundaryRef.current) {
              sentBoundaryRef.current = boundary;
              const ref = resolveVoiceRef(currentCharacter?.voiceId, voices);
              sentences.forEach((sentence) => {
                if (ttsSentenceCount >= MAX_STREAM_SENTENCES) return;
                if (ttsSentenceCount === 0) setTtsPendingMsgId(streamMsgId);
                ttsSentenceCount++;
                const sentenceNum = ttsSentenceCount; // capture before async — ttsSentenceCount changes synchronously
                setTtsSynthCount((c) => c + 1);
                synthesize.mutateAsync({
                  text: sentence,
                  modelId: currentTtsModel,
                  refAudio: ref.ref_audio,
                  refText: ref.ref_text,
                }).then((res) => {
                  if (res.success && res.output_path) {
                    setTtsSynthDone((d) => d + 1);
                    streamAudioPathsRef.current.push(res.output_path);
                    if (res.duration_sec) streamTotalDurRef.current += res.duration_sec;
                    if (streamAudioPathsRef.current.length >= ttsSentenceCount) setTtsPendingMsgId(null);
                    const dur = streamTotalDurRef.current > 0 ? formatDuration(streamTotalDurRef.current) : undefined;
                    useUIStore.getState().updateMessageAudio(streamMsgId, streamAudioPathsRef.current.join(','), dur);
                    if (!abortedTtsRef.current) {
                      player.enqueue(`${streamMsgId}-s${sentenceNum}`, `/api/audio/${res.output_path}`);
                    }
                  }
                }).catch(() => {
                  setTtsSynthDone((d) => d + 1);
                });
              });
            }
          }
        } else if (typeof chunk.error === 'string') {
          streamErrorMsg = chunk.error;
        }
      };

      try {
        let connectFailed = false;
        let agentFailed = false;

        // Primary: Agent streaming pipeline
        try {
          const agentInput: Record<string, unknown> = {
            messages: sendMessages,
          };
          if (system) agentInput['system'] = system;
          if (Object.keys(genFragment).length > 0) Object.assign(agentInput, genFragment);

          const { data } = await apiClient.post<{ success: boolean; task_id: string; error?: string }>(
            '/api/agents/run-stream',
            { pipeline: 'text_chat_stream', input: agentInput },
            { signal: ctrl.signal, timeout: 300000 },
          );

          if (data?.success && data?.task_id) {
            const taskId = data.task_id;
            let sseDone = false;
            sseCompletedRef.current = false;

            await new Promise<void>((resolve) => {
              const cleanup = () => {
                eventSource.close();
                if (!sseDone) { sseDone = true; resolve(); }
              };
              ctrl.signal.addEventListener('abort', cleanup, { once: true });

              const eventSource = new EventSource(`/api/agents/tasks/${taskId}/events`);
              eventSource.onmessage = (e) => {
                try {
                  const ev = JSON.parse(e.data);
                  if (ev.thinking) {
                    thinkRef.current += ev.thinking;
                    setStreamingThinking(thinkRef.current);
                  }
                  if (ev.delta) {
                    onChunk({ delta: ev.delta });
                  } else if (ev.status === 'failed') {
                    streamErrorMsg = ev.message || 'Agent pipeline failed';
                    cleanup();
                  } else if (ev.status === 'completed') {
                    sseCompletedRef.current = true;
                    cleanup();
                  }
                } catch { /* malformed event, skip */ }
              };
              eventSource.onerror = () => {
                // SSE closed unexpectedly
                if (!accRef.current) agentFailed = true;
                cleanup();
              };
            });

            if (!accRef.current && agentFailed) {
              connectFailed = true;
            }
          } else {
            agentFailed = true;
            connectFailed = true;
          }
        } catch (err: unknown) {
          connectFailed = !(ctrl.signal.aborted || (err as ErrorDetail)?.name === 'AbortError');
        }

        // Fallback: if agent/stream failed and no content, try direct /api/chat
        if (connectFailed && accRef.current === '') {
          try {
            const { data } = await apiClient.post<{ content: string }>(
              '/api/chat',
              { messages: sendMessages, system, ...genFragment },
              { signal: ctrl.signal, timeout: 120000 },
            );
            accRef.current = data.content ?? '';
          } catch (err: unknown) {
            const ed = err as ErrorDetail;
            if (ed?.name === 'AbortError' || ed?.code === 'ERR_CANCELED') {
              // intentional stop, no content
            } else if (ed?.response?.data?.error) {
              addToast({ message: ed.response.data.error, type: 'error', duration: 5000 });
            } else {
              addToast({ message: streamErrorMsg || '对话请求失败，请检查网络', type: 'error' });
            }
          }
        }
      } finally {
        // 定型：累积非空才落库一次（Property 5）；为空则移除占位、不产生空消息。
        if (shouldPersistFinal(accRef.current)) {
          const collectedPaths = streamAudioPathsRef.current;
          const finalMsg: ChatMessage = {
            id: streamMsgId,
            role: 'assistant',
            content: accRef.current,
            voiceName: currentVoice,
            duration: undefined,
            audioUrl: collectedPaths.length > 0 ? collectedPaths[0] : undefined,
          };
          await appendMessage(finalMsg);
          // Streaming TTS persisting audio paths: each per-sentence .then() callback
          // calls updateMessageAudio incrementally with accumulated duration.
          // Only write here for the non-streaming (full-text) case.
          if (collectedPaths.length > 0 && ttsSentenceCount === 0) {
            useUIStore.getState().updateMessageAudio(finalMsg.id, collectedPaths.join(','));
          }
          // Fallback: short replies don't trigger sentence-level TTS (min 3 chars).
          // Synthesize the full text once so audio is cached for instant replay.
          // Set ttsLoadingId to prevent race: user clicking "play" before TTS completes.
          if (ttsSentenceCount === 0 && accRef.current.trim().length > 0 && !ctrl.signal.aborted) {
            setTtsLoadingId(finalMsg.id);
            const ref = resolveVoiceRef(currentCharacter?.voiceId, voices);
            synthesize.mutateAsync({
              text: accRef.current,
              modelId: currentTtsModel,
              refAudio: ref.ref_audio,
              refText: ref.ref_text,
            }).then((res) => {
              if (res.success && res.output_path) {
                const dur = res.duration_sec ? formatDuration(res.duration_sec) : undefined;
                useUIStore.getState().updateMessageAudio(finalMsg.id, res.output_path, dur);
                if (autoPlay && !player.playing && !abortedTtsRef.current) {
                  player.playNow(finalMsg.id, `/api/audio/${res.output_path}`);
                }
              }
            }).catch(() => {}).finally(() => {
              setTtsLoadingId(null);
            });
          }
        }
        setIsTyping(false);
        sendingRef.current = false;
        // Keep streaming bubble visible only while streaming TTS is still running.
        // Fallback full-text TTS closes the bubble immediately — the persisted
        // message shows "合成中..." via per-message ttsLoadingId / ttsPendingMsgId.
        if (!ctrl.signal.aborted && ttsSynthCount > 0 && ttsSynthDone < ttsSynthCount) {
          setStreamingContent(accRef.current);
          streamLlmDoneRef.current = true;
        } else {
          setIsStreaming(false);
          setStreamingContent('');
        }
        accRef.current = '';
        setAbortController(null);
        streamingMsgIdRef.current = null;
        sentBoundaryRef.current = 0;
      }
    },
    [currentCharacter, currentVoice, addToast, autoPlay, synthesize, currentTtsModel, voices, appendMessage, setLastTrimmedCount, activeModelContextLength, tempSystemPrompt],
  );

  useEffect(() => {
    if (!isStreaming) return;
    if (ttsSynthCount > 0 && ttsSynthDone >= ttsSynthCount) {
      setIsStreaming(false);
      setStreamingContent('');
    }
  }, [isStreaming, ttsSynthCount, ttsSynthDone]);

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
  }, [inputText, isTyping, messages, setInputText, appendMessage, runAssistantStream]);

  // Stop_Action：中断 fetch/consume + 清空音频队列；已接收增量在 finalize 中保留并定型。
  const handleStop = () => {
    abortController?.abort();
    sendingRef.current = false;
    abortedTtsRef.current = true;
    player.clear();
  };

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
        createSession(currentCharacterId);
        return;
      }
      if (e.key === 'Escape') {
        if (isTyping) {
          e.preventDefault();
          handleStop();
        } else if (isInput) {
          // clear input — handled by textarea's own Escape key for slash menu;
          // for plain Escape (no slash menu active), clear inputText
          const ta = e.target as HTMLTextAreaElement;
          if (ta.value) {
            setInputText('');
          }
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isTyping, currentCharacterId, openPalette, createSession]);

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

  // 单条已定型消息的操作入口（Message_Actions）。可用性由纯函数 actionAvailabilityFor
  // 依据消息角色、是否末条 assistant 与 Generating_State（isTyping）推导。
  // 流式气泡（isStreaming 分支）不调用此函数，天然不渲染任何操作入口（Req 1.5）。
  const renderMessageActions = (msg: ChatMessage, index: number) => {
    const avail = actionAvailabilityFor(messages, index, isTyping);
    const iconBtn: React.CSSProperties = {
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
    const hoverIn = (e: React.MouseEvent<HTMLButtonElement>) => {
      (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)';
      (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)';
    };
    const hoverOut = (e: React.MouseEvent<HTMLButtonElement>) => {
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
          <button aria-label="复制" style={iconBtn} onMouseEnter={hoverIn} onMouseLeave={hoverOut} onClick={() => void handleCopy(msg.content)}>
            <Copy size={14} />
          </button>
        )}
        {/* Edit_Resend 仅对 user 消息且非生成态（Req 1.3, 1.4）。 */}
        {avail.canEdit && (
          <button aria-label="编辑重发" style={iconBtn} onMouseEnter={hoverIn} onMouseLeave={hoverOut} onClick={() => handleEditEntry(msg)}>
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
                        void handleRegenerate(opt.temp);
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
          <button aria-label="删除消息" style={iconBtn} onMouseEnter={hoverIn} onMouseLeave={hoverOut} onClick={() => void deleteMessage(msg.id)}>
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
  };

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
        player.playNow(`${msg.id}-s0`, `/api/audio/${paths[0]}`);
        paths.slice(1).forEach((p, i) => {
          player.enqueue(`${msg.id}-s${i + 1}`, `/api/audio/${p}`);
        });
      } else {
        player.playNow(msg.id, `/api/audio/${paths[0]}`);
      }
      return;
    }
    void speakMessage(msg);
  }, [player, ttsLoadingId, speakMessage]);

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
          {/* Character dropdown */}
          <div className="relative">
            <button
              className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full glass"
              style={{ border: '1px solid var(--border)', cursor: 'pointer', background: charMenuOpen ? 'rgba(72,202,228,0.08)' : undefined }}
              onClick={() => setCharMenuOpen((v) => !v)}
            >
              <div className="w-4 h-4 rounded-full" style={{ background: 'linear-gradient(135deg, #48CAE4, #0096C7)' }} />
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{currentCharacter?.name}</span>
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>▼</span>
            </button>
            {charMenuOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setCharMenuOpen(false)} />
                <div className="glass rounded-xl" style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 50, width: 220, maxHeight: 280, overflowY: 'auto', border: '1px solid var(--border)', boxShadow: '0 8px 32px rgba(0,0,0,0.35)', padding: 6 }}>
                  {characters.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => { setCurrentCharacter(c.id); setCharMenuOpen(false); }}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all"
                      style={{ background: c.id === currentCharacterId ? 'rgba(72,202,228,0.08)' : 'transparent', border: 'none', cursor: 'pointer' }}
                      onMouseEnter={(e) => { if (c.id !== currentCharacterId) (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)'; }}
                      onMouseLeave={(e) => { if (c.id !== currentCharacterId) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                    >
                      <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: c.avatar }}>
                        <User size={10} style={{ color: 'white' }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{c.name}</div>
                        <div className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>{c.description}</div>
                      </div>
                    </button>
                  ))}
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
            value={tempSystemPrompt ?? currentCharacter?.systemPrompt ?? ''}
            onChange={(e) => setTempSystemPrompt(e.target.value || null)}
          />
        </div>
      )}

      <div className="flex flex-1 min-h-0 relative">
        {/* Sidebar */}
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
                      onClick={() => void handleResultClick(result)}
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
                          if (isTyping) handleStop();
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

        {/* Main Chat Area */}
        <main className="flex-1 flex flex-col min-w-0 relative">
          {/* Token usage progress bar */}
          {(() => {
            const ctx = resolveContextLength(activeModelContextLength);
            const reserved = resolveReservedTokens(useUIStore.getState().chatGenParams);
            const budget = computeBudget({
              contextLength: ctx.contextLength,
              isEstimated: ctx.isEstimated,
              systemPrompt: tempSystemPrompt ?? currentCharacter?.systemPrompt ?? '',
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
                        {renderMessageActions(msg, index)}
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
                              onClick={() => handlePlayTTS(msg)}
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
                      {renderMessageActions(msg, index)}
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

          {/* Input */}
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
        </main>
      </div>
    </div>
  );
}
