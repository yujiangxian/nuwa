import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useUIStore, type ChatMessage } from '@/store/uiStore';
import { useToastStore } from '@/store/toastStore';
import { apiClient } from '@/api/client';
import { errorMessage, type ErrorDetail } from '@/lib/errorDetail';
import { useTranscribe, useSynthesize, useConfig, useVoices } from '@/hooks/useApi';
import { useRecorder } from '@/hooks/useRecorder';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { resolveVoiceRef } from '@/lib/voice';
import { formatRelativeTime } from '@/lib/chatSession';
import { organizeSessions, isPinned } from '@/lib/sessionOrganize';
import { consumeChatStream, accumulateDelta, shouldPersistFinal, type StreamChunk } from '@/lib/streamChat';
import { buildRequestFragment } from '@/lib/generationParams';
import { resolveContextLength } from '@/lib/contextWindow';
import { computeBudget, resolveReservedTokens } from '@/lib/contextBudget';
import { trimMessages } from '@/lib/contextTrim';
import { estimateText } from '@/lib/tokenEstimate';
import { actionAvailabilityFor } from '@/lib/messageActions';
import { normalizeQuery, DEBOUNCE_INTERVAL, type SearchResult, type HighlightRange } from '@/lib/chatSearch';
import { buildExportBundle, toMarkdown } from '@/lib/conversationExport';
import { INPUT_MAX_LENGTH } from '@/lib/promptPreset';
import {
  isSlashActive,
  parseSlashQuery,
  buildCommandCatalog,
  filterCommands,
  clampHighlightIndex,
  buildInsertedPresetText,
  type CommandItem,
} from '@/lib/slashCommand';
import SlashCommandMenu from '@/components/SlashCommandMenu';
import MarkdownMessage from '@/components/MarkdownMessage';
import ParamPanel from '@/components/ParamPanel';
import UsageIndicator from '@/components/UsageIndicator';
import { ArrowLeft, Settings, Plus, Play, Paperclip, Mic, Send, MessageSquare, User, Square, Monitor, Loader2, Trash2, Check, X, Copy, RotateCcw, Pencil, Search, Download, Upload, FileText, Pin, PinOff } from 'lucide-react';

/**
 * 将文本内容触发为浏览器文件下载（File_Download）。
 * Blob + 锚点 + 即时 revokeObjectURL，不依赖任何后端。
 */
function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
  const isPersistent = useUIStore((s) => s.isPersistent);
  const inputText = useUIStore((s) => s.inputText);
  const setInputText = useUIStore((s) => s.setInputText);
  // Prompt_Preset：插入入口所需的预设列表与一键插入 action（presets 只读）。
  const presets = useUIStore((s) => s.presets);
  const insertPresetIntoInput = useUIStore((s) => s.insertPresetIntoInput);
  const createSession = useUIStore((s) => s.createSession);
  const switchSession = useUIStore((s) => s.switchSession);
  const deleteSession = useUIStore((s) => s.deleteSession);
  const renameSession = useUIStore((s) => s.renameSession);
  const togglePin = useUIStore((s) => s.togglePin);
  const appendMessage = useUIStore((s) => s.appendMessage);
  const deleteMessage = useUIStore((s) => s.deleteMessage);
  const regenerateLast = useUIStore((s) => s.regenerateLast);
  const editAndResend = useUIStore((s) => s.editAndResend);
  const importSessions = useUIStore((s) => s.importSessions);
  const collectExportSessions = useUIStore((s) => s.collectExportSessions);
  const autoPlay = useUIStore((s) => s.settings.autoPlay);
  const addToast = useToastStore((s) => s.addToast);

  // Context_Window：生成参数（解析 Reserved_Response_Tokens）与本次外发裁剪展示态。
  const chatGenParams = useUIStore((s) => s.chatGenParams);
  const lastTrimmedCount = useUIStore((s) => s.lastTrimmedCount);
  const setLastTrimmedCount = useUIStore((s) => s.setLastTrimmedCount);

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
  const recorder = useRecorder();
  const player = useAudioPlayer();

  // 当前 ASR/TTS 模型：优先 current_models[type]，回退兼容字段
  const currentAsrModel = config?.current_models?.asr ?? config?.current_asr_model ?? undefined;
  const currentTtsModel = config?.current_models?.tts ?? config?.current_tts_model ?? undefined;

  const [isTyping, setIsTyping] = useState(false);
  // 流式生成本地态（不入 uiStore）：占位/打字机内容与累积引用、中断控制器。
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const accRef = useRef('');
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [ttsLoadingId, setTtsLoadingId] = useState<string | null>(null);
  const [asrLoading, setAsrLoading] = useState(false);

  // 会话生命周期 UI 的本地交互态：删除二次确认与内联重命名编辑。
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  // Edit_Resend_Action 内联编辑态：当前编辑的 user 消息 id 与编辑草稿（预填原 content）。
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  // Preset_Insert_Entry 弹层开关：在 Input_Field 旁列出 presets 供选择插入。
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);

  // Slash_Command 本地态：当前高亮项候选下标（渲染时经 clampHighlightIndex 规整），
  // 以及 Escape/选中后临时关闭菜单的标志（输入变化即重置以便重新弹出）。
  const [slashHighlight, setSlashHighlight] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);

  const currentCharacter = characters.find((c) => c.id === currentCharacterId);
  // 当前音色名经 voices 解析 currentCharacter.voiceId（去写死映射）；未命中回退占位。
  const currentVoice = voices.find((v) => v.id === currentCharacter?.voiceId)?.name ?? '默认音色';

  // Context_Window：当前 LLM 模型上下文长度候选值。InstalledModel 元数据暂无该字段，
  // 故为 undefined → Context_Resolver 回退默认值并标记为估算（forward-compatible）。
  const activeModelContextLength: number | undefined = undefined;

  // Context_Budget：由 messages / systemPrompt / 生成参数 / 模型上下文长度纯派生（不入 store）。
  const budget = useMemo(() => {
    const { contextLength, isEstimated } = resolveContextLength(activeModelContextLength);
    const reservedTokens = resolveReservedTokens(chatGenParams);
    return computeBudget({
      contextLength,
      isEstimated,
      systemPrompt: currentCharacter?.systemPrompt ?? '',
      messages,
      reservedTokens,
    });
  }, [messages, currentCharacter, chatGenParams, activeModelContextLength]);

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
        await player.play(msg.id, `/api/audio/${res.output_path}`);
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
      accRef.current = '';
      const ctrl = new AbortController();
      setAbortController(ctrl);
      const system = currentCharacter?.systemPrompt;

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

      // 单块处理：delta 累积并刷新渲染（打字机）；error 记录；done 无需额外操作。
      const onChunk = (chunk: StreamChunk) => {
        if (typeof chunk.delta === 'string') {
          accRef.current = accumulateDelta(accRef.current, chunk);
          setStreamingContent(accRef.current);
        } else if (typeof chunk.error === 'string') {
          streamErrorMsg = chunk.error;
        }
      };

      try {
        let connectFailed = false;
        let body: ReadableStream<Uint8Array> | null = null;
        try {
          const res = await fetch('/api/chat/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: sendMessages, system, ...genFragment }),
            signal: ctrl.signal,
          });
          if (!res.ok || !res.body) {
            connectFailed = true;
          } else {
            body = res.body;
          }
        } catch (err: unknown) {
          // 建连阶段被 Stop_Action 中断视为正常停止，不降级；其余视为连接失败。
          connectFailed = !(ctrl.signal.aborted || (err as ErrorDetail)?.name === 'AbortError');
        }

        if (body) {
          // 正常流式消费；AbortError 由 consumeChatStream 吞掉，视为停止。
          await consumeChatStream(body, onChunk);
          if (streamErrorMsg) {
            // error chunk：透传后端友好文案（含 Ollama 未启动/模型未加载提示）。
            addToast({ message: streamErrorMsg, type: 'error', duration: 5000 });
          }
        } else if (connectFailed && accRef.current === '') {
          // Fallback_Strategy：尚无任何增量且无法建立流式连接 → 改调既有 /api/chat。
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
              // 降级阶段被停止：无内容，静默退出。
            } else if (ed?.response?.data?.error) {
              addToast({ message: ed.response.data.error, type: 'error', duration: 5000 });
            } else {
              addToast({ message: '对话请求失败，请检查网络', type: 'error' });
            }
          }
        }
      } finally {
        // 定型：累积非空才落库一次（Property 5）；为空则移除占位、不产生空消息。
        if (shouldPersistFinal(accRef.current)) {
          const finalMsg: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: accRef.current,
            voiceName: currentVoice,
            duration: '0:05',
          };
          await appendMessage(finalMsg);
          // autoPlay 开启时，对完整 Final_Message 文本触发一次 TTS（生成中不逐字朗读）。
          if (autoPlay) {
            void speakMessage(finalMsg);
          }
        }
        setIsTyping(false);
        setIsStreaming(false);
        setStreamingContent('');
        accRef.current = '';
        setAbortController(null);
      }
    },
    [currentCharacter, currentVoice, addToast, autoPlay, speakMessage, appendMessage, setLastTrimmedCount, activeModelContextLength],
  );

  const handleSend = useCallback(async () => {
    if (!inputText.trim() || isTyping) return;

    // 1) 用户消息落库（appendMessage 负责 push、自动标题、更新 updatedAt 与持久化）。
    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', content: inputText };
    await appendMessage(userMsg);
    setInputText('');

    // Reset textarea height
    const ta = document.querySelector('textarea');
    if (ta) ta.style.height = 'auto';

    // 2) history 取发送前的 store messages 快照，再拼上本次用户消息（与既有 /api/chat 一致），
    //    交由可复用的 runAssistantStream 完成建连/流式/降级/定型/朗读。
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    const payloadMessages = [...history, { role: 'user', content: userMsg.content }];
    await runAssistantStream(payloadMessages);
  }, [inputText, isTyping, messages, setInputText, appendMessage, runAssistantStream]);

  // Stop_Action：中断 fetch/consume；已接收增量在 finalize 中保留并定型。
  const handleStop = () => {
    abortController?.abort();
  };

  // Copy_Action：把消息文本写入系统剪贴板，成功/失败各给一次 toast（Req 4.1-4.3）。
  const handleCopy = useCallback(async (content: string) => {
    try {
      await navigator.clipboard.writeText(content); // Req 4.1
      addToast({ message: '已复制', type: 'success' }); // Req 4.2
    } catch {
      addToast({ message: '复制失败', type: 'error' }); // Req 4.3
    }
  }, [addToast]);

  // Regenerate_Action：Generating_State 时禁用（Req 1.4）；移除 Last_Assistant_Message
  // 后以截断历史复用 runAssistantStream 重新生成（Placeholder 由 isStreaming 渲染，Req 2.2）。
  // handleStop 对 runAssistantStream 创建的同一 abortController 生效，故生成中可停止（Req 2.6/2.7）。
  const handleRegenerate = useCallback(async () => {
    if (isTyping) return; // Req 1.4：生成中禁止再次发起
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
        {/* Regenerate 仅对 Last_Assistant_Message 且非生成态（Req 1.2, 1.4）。 */}
        {avail.canRegenerate && (
          <button aria-label="重新生成" style={iconBtn} onMouseEnter={hoverIn} onMouseLeave={hoverOut} onClick={() => void handleRegenerate()}>
            <RotateCcw size={14} />
          </button>
        )}
        {/* Delete 非生成态可用（Req 1.4, 5.1, 5.2）。 */}
        {avail.canDelete && (
          <button aria-label="删除消息" style={iconBtn} onMouseEnter={hoverIn} onMouseLeave={hoverOut} onClick={() => void deleteMessage(msg.id)}>
            <Trash2 size={14} />
          </button>
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
    // 同一消息播放中再次点击则停止（useAudioPlayer 互斥）
    if (player.isPlaying(msg.id)) {
      player.stop();
      return;
    }
    if (ttsLoadingId) return; // 合成进行中，忽略重复触发
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

  // 导入文件选择入口：隐藏 input[type=file][accept='.json'] 的 ref。
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 角色名解析器：注入给 toMarkdown，characterId -> Character.name | undefined（Req 2.3）。
  const characterNameOf = useCallback(
    (id: string): string | undefined => characters.find((c) => c.id === id)?.name,
    [characters],
  );

  // 导出：收集 scope 范围会话 → 序列化为 JSON / Markdown → File_Download（Req 1.5, 2.6, 7.1, 7.2）。
  const handleExport = useCallback(
    async (scope: 'current' | 'all', format: 'json' | 'md') => {
      const data = await collectExportSessions(scope);
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      if (format === 'json') {
        const text = JSON.stringify(buildExportBundle(data, new Date().toISOString()), null, 2);
        downloadText(`nuwa-chat-${scope}-${ts}.json`, text, 'application/json');
      } else {
        const text = toMarkdown(data, characterNameOf);
        downloadText(`nuwa-chat-${scope}-${ts}.md`, text, 'text/markdown');
      }
    },
    [collectExportSessions, characterNameOf],
  );

  // 导入入口：触发隐藏文件选择器（Req 7.3）。
  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // 文件选择回调：读取文本后交给 importSessions（Req 7.4）；读取异常给通用提示且不调用导入。
  // 读取后重置 input.value 以便重复选择同一文件。
  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      let text: string;
      try {
        text = await file.text();
      } catch {
        addToast({ message: '文件读取失败', type: 'error' });
        return;
      }
      await importSessions(text);
    },
    [importSessions, addToast],
  );

  // Preset_Insert_Entry：选择一条预设插入 Input_Field。insertPresetIntoInput 写回 inputText
  // 并返回是否成功；成功（true）则对 Input_Field（textarea）调用 .focus()，失败（false，
  // 如超长，store 已 toast）则不聚焦。任一情况都关闭弹层。presets 始终不变。
  const handleInsertPreset = useCallback((id: string) => {
    const ok = insertPresetIntoInput(id);
    setPresetMenuOpen(false);
    if (ok) inputRef.current?.focus();
  }, [insertPresetIntoInput]);

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
        const text = buildInsertedPresetText(preset.content);
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

  const hasSessions = sessions.length > 0;

  // Session_Organize：以渲染时刻的 now 计算分组（纯函数，省略空组，按 Group_Order 排列，Req 7.1）。
  const sessionGroups = organizeSessions(sessions, new Date());

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
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full glass" style={{ border: '1px solid var(--border)' }}>
            <Monitor size={14} style={{ color: 'var(--text-secondary)' }} />
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Gemma 4</span>
          </div>
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full glass" style={{ border: '1px solid var(--border)' }}>
            <div className="w-4 h-4 rounded-full" style={{ background: 'linear-gradient(135deg, #48CAE4, #0096C7)' }} />
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{currentVoice}</span>
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

          {/* Export / Import controls（Session_Sidebar 导出与导入入口，Req 7.1–7.5）。 */}
          <div className="px-4 pb-1">
            {/* 隐藏文件选择器：限定 .json（Req 7.3）。 */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              aria-label="导入会话文件"
              data-testid="import-file-input"
              style={{ display: 'none' }}
              onChange={(e) => void handleFileChange(e)}
            />
            {/* 导出当前会话（Req 7.1）：JSON / Markdown。无会话时禁用（Req 7.5）。 */}
            <div className="flex items-center gap-1 mb-1.5">
              <span className="flex items-center gap-1 text-[11px] shrink-0" style={{ color: 'var(--text-muted)', width: 64 }}>
                <Download size={12} /> 当前
              </span>
              <button
                aria-label="导出当前会话 JSON"
                disabled={!hasSessions}
                onClick={() => void handleExport('current', 'json')}
                className="flex-1 text-xs py-1.5 rounded-lg transition-all"
                style={{ background: 'var(--surface-hover)', color: hasSessions ? 'var(--text-secondary)' : 'var(--text-muted)', border: '1px solid var(--border)', cursor: hasSessions ? 'pointer' : 'not-allowed', opacity: hasSessions ? 1 : 0.5 }}
              >
                JSON
              </button>
              <button
                aria-label="导出当前会话 Markdown"
                disabled={!hasSessions}
                onClick={() => void handleExport('current', 'md')}
                className="flex-1 text-xs py-1.5 rounded-lg transition-all"
                style={{ background: 'var(--surface-hover)', color: hasSessions ? 'var(--text-secondary)' : 'var(--text-muted)', border: '1px solid var(--border)', cursor: hasSessions ? 'pointer' : 'not-allowed', opacity: hasSessions ? 1 : 0.5 }}
              >
                Markdown
              </button>
            </div>
            {/* 导出全部（Req 7.2）：JSON / Markdown。无会话时禁用（Req 7.5）。 */}
            <div className="flex items-center gap-1 mb-1.5">
              <span className="flex items-center gap-1 text-[11px] shrink-0" style={{ color: 'var(--text-muted)', width: 64 }}>
                <Download size={12} /> 全部
              </span>
              <button
                aria-label="导出全部 JSON"
                disabled={!hasSessions}
                onClick={() => void handleExport('all', 'json')}
                className="flex-1 text-xs py-1.5 rounded-lg transition-all"
                style={{ background: 'var(--surface-hover)', color: hasSessions ? 'var(--text-secondary)' : 'var(--text-muted)', border: '1px solid var(--border)', cursor: hasSessions ? 'pointer' : 'not-allowed', opacity: hasSessions ? 1 : 0.5 }}
              >
                JSON
              </button>
              <button
                aria-label="导出全部 Markdown"
                disabled={!hasSessions}
                onClick={() => void handleExport('all', 'md')}
                className="flex-1 text-xs py-1.5 rounded-lg transition-all"
                style={{ background: 'var(--surface-hover)', color: hasSessions ? 'var(--text-secondary)' : 'var(--text-muted)', border: '1px solid var(--border)', cursor: hasSessions ? 'pointer' : 'not-allowed', opacity: hasSessions ? 1 : 0.5 }}
              >
                Markdown
              </button>
            </div>
            {/* 导入入口（Req 7.3, 7.4）。 */}
            <button
              aria-label="导入会话"
              onClick={handleImportClick}
              className="w-full flex items-center justify-center gap-2 py-1.5 rounded-lg transition-all"
              style={{ background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: 12 }}
            >
              <Upload size={13} />
              导入会话
            </button>
          </div>

          {/* Current Character */}
          <div className="px-4 pb-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] mb-2" style={{ color: 'var(--text-muted)' }}>当前角色</div>
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all" style={{ background: 'rgba(72,202,228,0.06)', border: '1px solid rgba(72,202,228,0.12)' }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: currentCharacter?.avatar || 'var(--primary)', boxShadow: '0 0 10px var(--primary-glow)' }}>
                <User size={14} style={{ color: 'var(--bg)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{currentCharacter?.name}</div>
                <div className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{currentCharacter?.description} · {currentVoice}</div>
              </div>
            </div>
          </div>

          <div className="h-px mx-4 mb-2" style={{ background: 'var(--border)' }} />

          {/* Param_Panel：对话生成参数调节（chat-generation-parameters）。 */}
          <ParamPanel />

          <div className="h-px mx-4 mb-2" style={{ background: 'var(--border)' }} />

          {/* Character List */}
          <div className="px-4 pb-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] mb-2" style={{ color: 'var(--text-muted)' }}>我的角色</div>
            <div className="space-y-1">
              {characters.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer transition-all"
                  style={{ background: c.id === currentCharacterId ? 'rgba(72,202,228,0.06)' : 'transparent', border: c.id === currentCharacterId ? '1px solid rgba(72,202,228,0.1)' : '1px solid transparent' }}
                  onClick={() => setCurrentCharacter(c.id)}
                  onMouseEnter={(e) => { if (c.id !== currentCharacterId) (e.currentTarget as HTMLDivElement).style.background = 'var(--surface-hover)'; }}
                  onMouseLeave={(e) => { if (c.id !== currentCharacterId) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                >
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: c.avatar }}>
                    <User size={12} style={{ color: 'white' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{c.name}</div>
                    <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{c.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="h-px mx-4 mb-2" style={{ background: 'var(--border)' }} />

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
              ) : !isSearching ? (
                // 空状态：仅在非检索中且无结果时显示（Req 6.4）。
                <div data-testid="search-empty" className="px-3 py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                  未找到匹配结果
                </div>
              ) : null
            ) : sessionsLoading ? (
              // 启动加载态：显示加载占位，不渲染任何硬编码占位会话。
              <div className="flex items-center gap-2 px-3 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                <Loader2 size={14} className="animate-spin" />
                加载会话中…
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
                        onClick={() => switchSession(s.id)}
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
          {/* Memory_Fallback_Mode 非阻断提示条 */}
          {!isPersistent && (
            <div
              role="alert"
              className="px-4 py-2 text-xs text-center shrink-0"
              style={{ background: 'rgba(212,175,55,0.12)', color: '#D4AF37', borderBottom: '1px solid rgba(212,175,55,0.2)' }}
            >
              本地历史无法保存
            </div>
          )}
          {/* context-window-management：上下文占用指示 + 临近/超限告警 + 裁剪提示 */}
          <UsageIndicator budget={budget} />
          {budget.usageState === 'warning' && (
            <div
              role="alert"
              data-testid="context-warning"
              className="px-4 md:px-8 py-1.5 text-xs shrink-0"
              style={{ background: 'rgba(212,175,55,0.1)', color: '#D4AF37' }}
            >
              对话已接近上下文上限，较旧的历史消息可能在下次发送时被裁剪。
            </div>
          )}
          {budget.usageState === 'over' && (
            <div
              role="alert"
              data-testid="context-over"
              className="px-4 md:px-8 py-1.5 text-xs shrink-0"
              style={{ background: 'rgba(255,107,107,0.1)', color: '#FF6B6B' }}
            >
              对话已超出上下文上限，发送时将自动裁剪较旧的历史消息。
            </div>
          )}
          {lastTrimmedCount > 0 && (
            <div
              role="status"
              data-testid="context-trim-notice"
              className="px-4 md:px-8 py-1.5 text-xs shrink-0"
              style={{ background: 'rgba(72,202,228,0.08)', color: 'var(--text-secondary)' }}
            >
              已裁剪 {lastTrimmedCount} 条历史消息以适配上下文窗口。
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
                          {msg.voiceName && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(72,202,228,0.08)', color: 'var(--primary)' }}>{msg.voiceName}</span>
                          )}
                        </div>
                        <div className="mb-3">
                          <MarkdownMessage source={msg.content} />
                        </div>
                        {msg.voiceName && (
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
                              disabled={ttsLoadingId === msg.id}
                            >
                              {ttsLoadingId === msg.id ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : player.isPlaying(msg.id) ? (
                                <Square size={14} fill="currentColor" />
                              ) : (
                                <Play size={14} fill="currentColor" />
                              )}
                              {ttsLoadingId === msg.id ? '合成中...' : player.isPlaying(msg.id) ? '停止' : '播放'}
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
                  {streamingContent.length > 0 ? (
                    <div data-testid="streaming-content">
                      <MarkdownMessage source={streamingContent} streaming />
                      <span aria-hidden="true" style={{ display: 'inline-block', marginLeft: 2, color: 'var(--primary)', animation: 'pulse-dot 1s steps(1) infinite' }}>▍</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--text-muted)', animation: 'pulse-dot 1.4s infinite 0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--text-muted)', animation: 'pulse-dot 1.4s infinite 200ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--text-muted)', animation: 'pulse-dot 1.4s infinite 400ms' }} />
                      <span className="text-xs ml-1" style={{ color: 'var(--text-muted)' }}>正在思考...</span>
                    </div>
                  )}
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
                  <button className="flex items-center justify-center" style={{ width: 32, height: 32, borderRadius: 10, color: 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer', transition: 'all 0.2s ease' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'; }}>
                    <Paperclip size={18} />
                  </button>
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
                  <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{inputText.length}/2000</span>

                  {/* Preset_Insert_Entry：「提示词」按钮 + 弹层。点击切换弹层，选择某条调用
                      handleInsertPreset（经 insertPresetIntoInput 写 inputText，仅成功时聚焦）。
                      presets 为空时弹层展示空提示并提供进入 Preset_Manager 的入口。 */}
                  <div className="relative">
                    <button
                      type="button"
                      aria-label="插入提示词预设"
                      aria-expanded={presetMenuOpen}
                      onClick={() => setPresetMenuOpen((v) => !v)}
                      className="flex items-center gap-1.5 px-2.5"
                      style={{ height: 32, borderRadius: 10, color: presetMenuOpen ? 'var(--primary)' : 'var(--text-secondary)', background: presetMenuOpen ? 'rgba(72,202,228,0.1)' : 'transparent', border: 'none', cursor: 'pointer', transition: 'all 0.2s ease', fontSize: 12 }}
                      onMouseEnter={(e) => { if (!presetMenuOpen) { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'; } }}
                      onMouseLeave={(e) => { if (!presetMenuOpen) { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'; } }}
                    >
                      <FileText size={16} />
                      提示词
                    </button>
                    {presetMenuOpen && (
                      <>
                        {/* 点击遮罩关闭弹层 */}
                        <div
                          style={{ position: 'fixed', inset: 0, zIndex: 40 }}
                          onClick={() => setPresetMenuOpen(false)}
                        />
                        <div
                          role="menu"
                          aria-label="提示词预设列表"
                          className="glass rounded-xl"
                          style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, zIndex: 50, width: 280, maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', boxShadow: '0 8px 32px rgba(0,0,0,0.35)', padding: 6 }}
                        >
                          {presets.length === 0 ? (
                            <div className="px-3 py-4 text-center">
                              <div className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>还没有预设</div>
                              <button
                                type="button"
                                onClick={() => { setPresetMenuOpen(false); setPage('presets'); }}
                                className="text-xs"
                                style={{ color: 'var(--primary)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                              >
                                去管理预设
                              </button>
                            </div>
                          ) : (
                            <>
                              {presets.map((preset) => (
                                <button
                                  key={preset.id}
                                  type="button"
                                  role="menuitem"
                                  aria-label={`插入预设 ${preset.title}`}
                                  onClick={() => handleInsertPreset(preset.id)}
                                  className="w-full text-left rounded-lg px-3 py-2 transition-all"
                                  style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)'; }}
                                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                                >
                                  <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{preset.title}</div>
                                  <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{preset.content}</div>
                                </button>
                              ))}
                              <div className="h-px my-1" style={{ background: 'var(--border)' }} />
                              <button
                                type="button"
                                onClick={() => { setPresetMenuOpen(false); setPage('presets'); }}
                                className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-all"
                                style={{ color: 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'; }}
                                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'; }}
                              >
                                <Settings size={13} />
                                管理预设
                              </button>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
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
