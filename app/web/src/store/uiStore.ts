// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { create } from 'zustand';
import { useSettingsStore } from './settingsStore';
import { useCharacterStore, defaultCharacters, setCharacterDbForTesting } from './characterStore';
export { defaultCharacters, setCharacterDbForTesting };
import { createChatDb, type ChatDb, type PersistedMessage } from '@/lib/chatDb';
// 类型定义已提取至 types.ts，此处重导出保持向后兼容
import type { AppPage, VoiceItem, Character, CharacterInput, ChatSession, ChatMessage, PromptPreset, GenerationParams } from './types';
export type { AppPage, VoiceItem, Character, CharacterInput, ChatSession, ChatMessage, PromptPreset, GenerationParams };
import { createPresetDb, type PresetDb } from '@/lib/promptPresetDb';
import { DEFAULT_TITLE, deriveTitle } from '@/lib/chatTitle';
import { pickLatestSession } from '@/lib/chatSession';
import { normalizePinned, togglePinnedIn, setPinnedIn } from '@/lib/sessionOrganize';
import { parseImportBundle, type ImportError, type ExportedSession } from '@/lib/conversationExport';

import {
  validatePreset,
  generatePresetId,
  buildInsertedText,
  INPUT_MAX_LENGTH,
} from '@/lib/promptPreset';
import {
  searchCorpus,
  normalizeQuery,
  type SearchResult,
  type SearchCorpus,
} from '@/lib/chatSearch';
import { moveHighlightIndex } from '@/lib/commandPalette';
import { useToastStore } from '@/store/toastStore';
import {
  type ChatGenParams,
  type ChatParamKey,
  clampParam,
  loadChatGenParams,
  saveChatGenParams,
  DEFAULT_CHAT_GEN_PARAMS,
} from '@/lib/generationParams';

interface AppSettings {
  backendUrl: string;
  modelsDir: string;
  theme: 'dark' | 'light' | 'system';
  autoPlay: boolean;
  language: string;
}

interface UIState {
  // Navigation
  currentPage: AppPage;
  setPage: (page: AppPage) => void;

  // Settings
  settings: AppSettings;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;

  // Characters
  characters: Character[];
  currentCharacterId: string;
  charactersLoading: boolean; // 启动加载态，初始 true
  charactersPersistent: boolean; // false 表示处于 Memory_Fallback_Mode（角色侧）
  setCurrentCharacter: (id: string) => void;
  loadCharacters: () => Promise<void>;
  createCharacter: (input: CharacterInput) => Promise<void>;
  updateCharacter: (id: string, input: CharacterInput) => Promise<void>;
  deleteCharacter: (id: string) => Promise<void>;

  // Prompt presets
  presets: PromptPreset[];
  presetsLoading: boolean; // 启动加载态，初始 true
  presetsPersistent: boolean; // false 表示处于 Memory_Fallback_Mode（预设侧）
  /** 启动时调用：init -> 读取恢复 presets；失败进入 Memory_Fallback_Mode（presets=[]）。 */
  loadPresets: () => Promise<void>;
  /** 新建预设：validatePreset 通过才创建，分配集内唯一 id，记录 trim 后字段并持久化。 */
  createPreset: (rawTitle: string, rawContent: string, tags?: string[]) => Promise<void>;
  /** 编辑预设：validatePreset 通过才更新 title/content（id 不变）并持久化。 */
  updatePreset: (id: string, rawTitle: string, rawContent: string, tags?: string[]) => Promise<void>;
  /** 删除预设：从 presets 移除并经 Preset_DB 删除其记录（确认在 UI 层完成）。 */
  deletePreset: (id: string) => Promise<void>;
  /**
   * 一键插入：读取 inputText 与所选预设 content，经 buildInsertedText 计算并写回
   * inputText；超 Input_Max_Length 时不修改且 toast；返回是否成功插入（供 ChatPage
   * 决定是否聚焦）；presets 始终不变。
   */
  insertPresetIntoInput: (id: string) => boolean;

  // Chat
  sessions: ChatSession[];
  currentSessionId: string | null;
  messages: ChatMessage[];
  sessionsLoading: boolean; // 启动加载态
  isPersistent: boolean; // false 表示处于 Memory_Fallback_Mode
  loadSessions: () => Promise<void>;
  createSession: (characterId: string) => Promise<void>;
  switchSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  /** 切换某会话置顶状态（Req 2.1, 2.2）：内存取反 + 持久化更新后的该会话。 */
  togglePin: (sessionId: string) => Promise<void>;
  /** 显式设置某会话置顶状态：内存置位 + 持久化。 */
  setPinned: (sessionId: string, pinned: boolean) => Promise<void>;
  appendMessage: (msg: ChatMessage) => Promise<void>;
  /** 删除单条消息（Req 5.1, 6.3）。从 messages 移除并经 Chat_DB 删除其记录。 */
  deleteMessage: (messageId: string) => Promise<void>;
  /** 更新消息的 audioUrl/duration（TTS 合成成功后持久化音频引用）。 */
  updateMessageAudio: (id: string, audioUrl: string, duration?: string) => void;
  /** 更新消息的反馈（thumbs up/down）。 */
  updateMessageFeedback: (id: string, feedback: 'up' | 'down') => void;
  /**
   * 重新生成最后一条 assistant 回复（Req 2.1, 6.3）。
   * 移除 Last_Assistant_Message 并删除其持久化记录，返回移除后的对话历史
   * （供 ChatPage 发起流式生成）。无 Last_Assistant_Message 时返回 null。
   */
  regenerateLast: () => Promise<{ role: string; content: string }[] | null>;
  /**
   * 编辑并重发某条 user 消息（Req 3.2-3.5, 6.3）。
   * trim 后为空则整体 no-op 并返回 null；否则更新该消息 content、截断其后全部消息，
   * 返回截断后（含已编辑消息）的对话历史。messageId 不指向 user 消息时返回 null。
   */
  editAndResend: (
    messageId: string,
    newContent: string,
  ) => Promise<{ role: string; content: string }[] | null>;

  /**
   * 从一段文件文本导入会话（JSON_Import 的状态层部分）。
   *
   * 调用 parseImportBundle(text)：
   * - 失败：不改动 sessions/messages/currentSessionId 与持久层，
   *   按 error.kind 展示对应错误 toast，返回该 ImportError（Req 6.1–6.4）。
   * - 成功：为每个 ExportedSession 分配库内唯一新 id（不与现有/批内其他会话冲突，
   *   Req 4.2–4.3），消息按原序追加并各分配唯一 id（Req 4.4），保留全部现有会话与
   *   消息（Req 4.5）；持久模式下经 Chat_DB 持久化新会话与消息（Req 4.6, 8.2 失败 toast）；
   *   切换 currentSessionId 到导入会话中 updatedAt 最新者并加载其消息（Req 4.7）；
   *   展示含数量的成功 toast（Req 6.5）。返回 null。
   */
  importSessions: (text: string) => Promise<ImportError | null>;

  /**
   * 收集用于导出的会话数据（导出 UI 的数据源）。
   * - scope==='current'：仅当前 Active_Session 与内存中其消息（Req 1.1, 2.1）。
   * - scope==='all'：持久模式经 Chat_DB 跨会话取全量会话与消息；降级模式用内存会话
   *   （仅当前会话有已加载消息）（Req 1.2, 2.2, 8.1）。只读，不写入。
   */
  collectExportSessions: (scope: 'current' | 'all') => Promise<ExportedSession[]>;

  // Chat search
  /** Search_Input 原始文本，初始 ''。 */
  searchQuery: string;
  /** 最近一次检索结果，初始 []。 */
  searchResults: SearchResult[];
  /** 语料组装 + 检索进行中，初始 false。 */
  isSearching: boolean;
  /** 仅更新 searchQuery（不触发检索）。 */
  setSearchQuery: (query: string) => void;
  /** 组装 Search_Corpus 并计算 searchResults。 */
  runSearch: () => Promise<void>;
  /** 重置搜索状态（导航 / 退出搜索视图用）。 */
  clearSearch: () => void;

  // Voice
  selectedVoiceId: string;
  setSelectedVoiceId: (id: string) => void;

  // Generation params (for synth mode)
  params: GenerationParams;
  setParam: <K extends keyof GenerationParams>(key: K, value: GenerationParams[K]) => void;

  // Chat generation params (chat-generation-parameters feature; independent of synth `params`)
  chatGenParams: ChatGenParams;
  /** 设置某参数为 Active 并记录经 clampParam 钳制后的数值；随后持久化。 */
  setChatParam: (key: ChatParamKey, rawValue: number) => void;
  /** 将某参数重置为 Inactive（采用模型内建默认、不随请求下发）；随后持久化。 */
  clearChatParam: (key: ChatParamKey) => void;
  /** Restore_Defaults：所有参数重置为 Default_State 并持久化。 */
  restoreChatParamDefaults: () => void;

  // Playback
  isPlaying: boolean;
  playbackProgress: number;
  togglePlay: () => void;

  // Generation
  isGenerating: boolean;
  statusText: string;
  setIsGenerating: (v: boolean) => void;
  setStatusText: (text: string) => void;

  // UI panels
  isSettingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
  isHistoryOpen: boolean;
  toggleHistory: () => void;

  // Command Palette（command-palette 新增切片）
  /** Palette_Open_State：面板是否可见，初始 false。 */
  paletteOpen: boolean;
  /** Palette_Query：搜索框原始查询，初始 ''。 */
  paletteQuery: string;
  /** Highlight_Index：当前高亮下标，空列表约定 -1，初始 -1。 */
  highlightIndex: number;
  /** 打开面板：paletteOpen=true，重置 query='' 与 highlightIndex=-1（Req 1.3）。 */
  openPalette: () => void;
  /** 关闭面板：paletteOpen=false（Req 1.2, 5.6）。 */
  closePalette: () => void;
  /** 设置查询文本（Req 4.3 的规整由组件经 setHighlightIndex 协同完成）。 */
  setPaletteQuery: (query: string) => void;
  /** 方向键移动高亮（带回绕）；listLength 由调用方传入当前 Filtered_Commands 长度（Req 4.1, 4.2）。 */
  moveHighlight: (delta: number, listLength: number) => void;
  /** 直接设置高亮下标（用于 query 变化后的 clampHighlight 规整与鼠标悬停）。 */
  setHighlightIndex: (index: number) => void;
  isAdvancedOpen: boolean;
  toggleAdvanced: () => void;

  // Input
  inputText: string;
  setInputText: (text: string) => void;

  // Context window management（context-window-management 新增展示态）
  /** 本次外发请求实际裁剪掉的历史消息条数（驱动 Trim_Notice）。0 表示未裁剪。 */
  lastTrimmedCount: number;
  /** 设置本次外发的裁剪条数（由 ChatPage 在构造 payload 后调用）。 */
  setLastTrimmedCount: (n: number) => void;
}


const defaultVoices: VoiceItem[] = [
  { id: 'jyy', name: '佳怡音色', tags: '清晰 · 温暖 · 女声', icon: 'face', iconColor: '#48CAE4', gradient: 'linear-gradient(135deg, rgba(72,202,228,0.15), rgba(0,150,199,0.1))' },
  { id: 'stefanie', name: '孙燕姿', tags: '唱歌 · 甜美 · 明星', icon: 'music', iconColor: '#FF6B9D', gradient: 'linear-gradient(135deg, rgba(255,107,157,0.1), rgba(255,107,157,0.05))' },
  { id: 'narrator', name: '旁白君', tags: '沉稳 · 磁性 · 男声', icon: 'mic', iconColor: '#52B788', gradient: 'linear-gradient(135deg, rgba(82,183,136,0.1), rgba(82,183,136,0.05))' },
  { id: 'anime', name: '二次元少女', tags: '活泼 · 元气 · 角色', icon: 'bot', iconColor: '#7B82E1', gradient: 'linear-gradient(135deg, rgba(123,130,225,0.1), rgba(123,130,225,0.05))' },
  { id: 'english', name: '英文主播', tags: '标准 · 专业 · 英音', icon: 'globe', iconColor: '#D4AF37', gradient: 'linear-gradient(135deg, rgba(212,175,55,0.1), rgba(212,175,55,0.05))' },
];

// Chat_DB 实例。createChatDb() 不在构造时抛错（失败延迟到 init()），
// 因此模块加载在任何环境（含未注入 IndexedDB 的 jsdom）下都安全。
let chatDb: ChatDb = createChatDb();

/**
 * 测试注入点：替换 Chat_DB 实例（例如注入 fake-indexeddb 包装或内存 stub）。
 * 仅供单元/属性测试使用。
 */
export function setChatDbForTesting(db: ChatDb): void {
  chatDb = db;
}

// Preset_DB 实例。createPresetDb() 不在构造时抛错（失败延迟到 init()），
// 因此模块加载在任何环境（含未注入 IndexedDB 的 jsdom）下都安全。
let presetDb: PresetDb = createPresetDb();

/**
 * 测试注入点：替换 Preset_DB 实例（例如注入 fake-indexeddb 包装或会 reject 的 stub）。
 * 仅供单元/属性测试使用。
 */
export function setPresetDbForTesting(db: PresetDb): void {
  presetDb = db;
}

/** 统一的「保存失败」提示，写操作 reject 时调用。 */
function toastSaveFailed(): void {
  useToastStore.getState().addToast({ message: '保存失败', type: 'error' });
}

/**
 * 组装一次检索的 Search_Corpus（模块内私有 helper）。
 *
 * - 持久模式（isPersistent===true）：经既有 chatDb 跨会话读取全量语料
 *   （getAllSessions + 逐会话 getMessages）。读取失败（任一 reject）由
 *   try/catch 捕获，降级到内存语料（Req 9.2），不抛出、不中断 runSearch。
 * - Memory_Fallback_Mode（isPersistent===false）：直接走内存语料——全部会话
 *   标题参与检索，仅当前会话已加载的消息可被检索，其余会话消息为 []（Req 4.2）。
 *
 * 仅调用 Chat_DB 的读取接口（getAllSessions / getMessages），不写入，满足检索只读（Req 9.1）。
 */
async function assembleSearchCorpus(): Promise<SearchCorpus> {
  const { sessions, currentSessionId, messages, isPersistent } = useUIStore.getState();
  // 持久模式：经 Chat_DB 跨会话取全量语料。
  if (isPersistent) {
    try {
      const all = await chatDb.getAllSessions();
      return await Promise.all(
        all.map(async (session) => ({
          session,
          messages: await chatDb.getMessages(session.id),
        })),
      );
    } catch { console.warn("nuwa:store: error"); }
  }
  // Memory_Fallback_Mode 或读取失败：用内存中可用的会话标题 +
  // 当前会话已加载的消息（其余会话消息不在内存中，标题仍可被检索）。
  return sessions.map((session) => ({
    session,
    messages: session.id === currentSessionId ? messages : [],
  }));
}

export const useUIStore = create<UIState>((set, get) => ({
  currentPage: 'home',
  setPage: (page) => set({ currentPage: page }),

  settings: useSettingsStore.getState().settings,
  updateSetting: (key, value) => {
    useSettingsStore.getState().updateSetting(key, value);
    set({ settings: useSettingsStore.getState().settings });
  },

  // Character domain delegates to characterStore
  characters: useCharacterStore.getState().characters,
  currentCharacterId: useCharacterStore.getState().currentCharacterId,
  charactersLoading: useCharacterStore.getState().charactersLoading,
  charactersPersistent: useCharacterStore.getState().charactersPersistent,
  setCurrentCharacter: (id) => { useCharacterStore.getState().setCurrentCharacter(id); set({ currentCharacterId: id }); },
  loadCharacters: () => useCharacterStore.getState().loadCharacters().then(() => {
    const cs = useCharacterStore.getState();
    set({ characters: cs.characters, currentCharacterId: cs.currentCharacterId, charactersLoading: cs.charactersLoading, charactersPersistent: cs.charactersPersistent });
  }),
  createCharacter: (input) => useCharacterStore.getState().createCharacter(input).then(() => {
    set({ characters: useCharacterStore.getState().characters });
  }),
  updateCharacter: (id, input) => useCharacterStore.getState().updateCharacter(id, input).then(() => {
    set({ characters: useCharacterStore.getState().characters });
  }),
  deleteCharacter: (id) => useCharacterStore.getState().deleteCharacter(id).then(() => {
    const cs = useCharacterStore.getState();
    set({ characters: cs.characters, currentCharacterId: cs.currentCharacterId });
  }),

  presets: [],
  presetsLoading: true,
  presetsPersistent: true,

  loadPresets: async () => {
    set({ presetsLoading: true });
    // 1) 初始化持久层；失败则进入 Memory_Fallback_Mode（空 presets 内存维护）。
    try {
      await presetDb.init();
    } catch {
      set({ presets: [], presetsPersistent: false, presetsLoading: false });
      useToastStore.getState().addToast({ message: '预设无法保存', type: 'warning' });
      return;
    }

    // 2) 读取已持久化的预设；读取失败按空 presets 继续（保持 persistent=true）。
    let stored: PromptPreset[] = [];
    try {
      stored = await presetDb.getAllPresets();
    } catch {
      stored = [];
    }
    // 保持持久层顺序恢复到 presets。
    set({ presets: stored, presetsLoading: false });
  },

  createPreset: async (rawTitle, rawContent, tags?: string[]) => {
    const validation = validatePreset(rawTitle, rawContent);
    if (!validation.ok) return; // 任一字段 trim 后为空则整体 no-op（Property 3）

    const newPreset: PromptPreset = {
      id: generatePresetId(get().presets),
      title: validation.title,
      content: validation.content,
      tags: tags && tags.length > 0 ? tags : undefined,
    };
    // 先更新内存（追加到末尾，稳定顺序），后持久化。
    set((s) => ({ presets: [...s.presets, newPreset] }));
    if (get().presetsPersistent) {
      try {
        await presetDb.savePreset(newPreset);
      } catch {
        toastSaveFailed();
      }
    }
  },

  updatePreset: async (id, rawTitle, rawContent, tags?: string[]) => {
    const validation = validatePreset(rawTitle, rawContent);
    if (!validation.ok) return; // 任一字段 trim 后为空则整体 no-op（Property 3）

    let updated: PromptPreset | undefined;
    set((s) => ({
      presets: s.presets.map((p) => {
        if (p.id === id) {
          updated = { ...p, title: validation.title, content: validation.content, tags: tags && tags.length > 0 ? tags : undefined };
          return updated;
        }
        return p;
      }),
    }));
    if (updated && get().presetsPersistent) {
      try {
        await presetDb.savePreset(updated);
      } catch {
        toastSaveFailed();
      }
    }
  },

  deletePreset: async (id) => {
    const remaining = get().presets.filter((p) => p.id !== id);
    // 先更新内存，后持久化。
    set({ presets: remaining });
    if (get().presetsPersistent) {
      try {
        await presetDb.deletePreset(id);
      } catch {
        toastSaveFailed();
      }
    }
  },

  insertPresetIntoInput: (id) => {
    const { presets, inputText } = get();
    const preset = presets.find((p) => p.id === id);
    if (!preset) return false; // 未命中则 no-op（presets 与 inputText 均不变）
    const result = buildInsertedText(inputText, preset.content, INPUT_MAX_LENGTH);
    if (!result.ok) {
      // 超出长度上限：不修改 inputText（Req 6.5），presets 始终不变（Req 6.7）。
      useToastStore.getState().addToast({ message: '内容超出长度上限，无法插入', type: 'warning' });
      return false;
    }
    set({ inputText: result.text });
    return true;
  },

  sessions: [],
  currentSessionId: null,
  messages: [],
  sessionsLoading: true,
  isPersistent: true,

  loadSessions: async () => {
    set({ sessionsLoading: true });
    // 1) 初始化持久层；失败则进入 Memory_Fallback_Mode。
    try {
      await chatDb.init();
    } catch {
      set({ isPersistent: false });
      useToastStore.getState().addToast({ message: '本地历史无法保存', type: 'warning' });
      // 自动建一个内存会话（isPersistent=false，createSession 跳过持久化）。
      await get().createSession(get().currentCharacterId);
      set({ sessionsLoading: false });
      return;
    }

    // 2) 读取已持久化的会话；读取失败按空集合处理（触发空状态）。
    let stored: ChatSession[] = [];
    try {
      stored = (await chatDb.getAllSessions()).map(normalizePinned); // 缺省归一（Req 1.3）
    } catch {
      stored = [];
    }

    if (stored.length > 0) {
      const latest = pickLatestSession(stored);
      set({ sessions: stored, currentSessionId: latest?.id ?? null });
      if (latest) {
        try {
          const msgs = await chatDb.getMessages(latest.id);
          set({ messages: msgs });
        } catch {
          set({ messages: [] });
        }
      }
    } else {
      // 空状态：自动新建会话并设为当前。
      set({ sessions: [], currentSessionId: null, messages: [] });
      await get().createSession(get().currentCharacterId);
    }
    set({ sessionsLoading: false });
  },

  createSession: async (characterId) => {
    const voiceId = get().characters.find((c) => c.id === characterId)?.voiceId || 'jyy';
    const newSession: ChatSession = {
      id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
      title: DEFAULT_TITLE,
      characterId,
      voiceId,
      updatedAt: new Date().toISOString(),
      pinned: false,
    };
    set((s) => ({ sessions: [newSession, ...s.sessions], currentSessionId: newSession.id, messages: [] }));
    if (get().isPersistent) {
      try {
        await chatDb.saveSession(newSession);
      } catch {
        toastSaveFailed();
      }
    }
  },

  switchSession: async (sessionId) => {
    // 选中已是当前会话则保持 messages 不变。
    if (get().currentSessionId === sessionId) return;
    set({ currentSessionId: sessionId });
    try {
      const msgs = await chatDb.getMessages(sessionId);
      set({ messages: msgs });
    } catch {
      set({ messages: [] });
    }
  },

  deleteSession: async (sessionId) => {
    const { sessions, currentSessionId, isPersistent } = get();
    const remaining = sessions.filter((s) => s.id !== sessionId);

    if (isPersistent) {
      try {
        await chatDb.deleteSession(sessionId);
      } catch {
        toastSaveFailed();
      }
    }

    if (currentSessionId === sessionId) {
      if (remaining.length > 0) {
        // 切到剩余中 updatedAt 最新者并加载其消息。
        const latest = pickLatestSession(remaining);
        set({ sessions: remaining, currentSessionId: latest?.id ?? null });
        if (latest) {
          try {
            const msgs = await chatDb.getMessages(latest.id);
            set({ messages: msgs });
          } catch {
            set({ messages: [] });
          }
        }
      } else {
        // 删除后已无会话：进入空状态并自动新建。
        set({ sessions: [], currentSessionId: null, messages: [] });
        await get().createSession(get().currentCharacterId);
      }
    } else {
      // 非当前会话：currentSessionId 与 messages 保持不变。
      set({ sessions: remaining });
    }
  },

  renameSession: async (sessionId, title) => {
    const trimmed = title.trim();
    if (trimmed.length === 0) return; // 空标题不变更
    let updated: ChatSession | undefined;
    set((s) => ({
      sessions: s.sessions.map((sess) => {
        if (sess.id === sessionId) {
          updated = { ...sess, title: trimmed };
          return updated;
        }
        return sess;
      }),
    }));
    if (updated && get().isPersistent) {
      try {
        await chatDb.saveSession(updated);
      } catch {
        toastSaveFailed();
      }
    }
  },

  togglePin: async (sessionId) => {
    const { sessions, isPersistent } = get();
    // 纯函数仅改目标会话 pinned（取反），其余字段与会话不变（Req 2.3, 2.4）。
    const next = togglePinnedIn(sessions, sessionId);
    set({ sessions: next }); // 先改内存，立即触发重渲染
    const updated = next.find((s) => s.id === sessionId);
    if (updated && isPersistent) {
      // 持久模式持久化含 pinned（Req 3.1）；降级模式仅内存（Req 3.2）。
      try {
        await chatDb.saveSession(updated);
      } catch {
        toastSaveFailed(); // 失败保留内存并提示（Req 3.4）
      }
    }
  },

  setPinned: async (sessionId, pinned) => {
    const { sessions, isPersistent } = get();
    const next = setPinnedIn(sessions, sessionId, pinned);
    set({ sessions: next });
    const updated = next.find((s) => s.id === sessionId);
    if (updated && isPersistent) {
      try {
        await chatDb.saveSession(updated);
      } catch {
        toastSaveFailed();
      }
    }
  },

  appendMessage: async (msg) => {
    const { messages, sessions, currentSessionId, isPersistent } = get();
    const seq = messages.length;
    const msgWithSeq = { ...msg, _seq: seq };
    const hadUserMessage = messages.some((m) => m.role === 'user');
    const now = new Date().toISOString();

    // 计算（必要时）自动标题与更新后的会话。
    const activeSession = sessions.find((s) => s.id === currentSessionId);
    let updatedSession: ChatSession | undefined;
    if (activeSession) {
      let title = activeSession.title;
      if (msg.role === 'user' && title === DEFAULT_TITLE && !hadUserMessage) {
        title = deriveTitle(msg.content);
      }
      updatedSession = { ...activeSession, title, updatedAt: now };
    }

    set((s) => ({
      messages: [...s.messages, msgWithSeq],
      sessions: updatedSession
        ? s.sessions.map((sess) => (sess.id === updatedSession!.id ? updatedSession! : sess))
        : s.sessions,
    }));

    if (isPersistent && currentSessionId) {
      try {
        const persisted: PersistedMessage = { ...msg, sessionId: currentSessionId, seq };
        await chatDb.saveMessage(persisted);
        if (updatedSession) {
          await chatDb.saveSession(updatedSession);
        }
      } catch {
        toastSaveFailed();
      }
    }
  },

  deleteMessage: async (messageId) => {
    const { messages, isPersistent } = get();
    const exists = messages.some((m) => m.id === messageId);
    if (!exists) return; // 不存在则 no-op，保持 messages 与持久化一致
    // 先改内存：保留其余消息相对顺序（filter 稳定）。
    set((s) => ({ messages: s.messages.filter((m) => m.id !== messageId) }));
    if (isPersistent) {
      try {
        await chatDb.deleteMessage(messageId);
      } catch {
        toastSaveFailed();
      }
    }
    // 注意：Delete_Action 不改 title、不改 updatedAt（Req 6.7）。
  },

  updateMessageAudio: (id, audioUrl, duration) => {
    const { messages, currentSessionId, isPersistent } = get();
    const idx = messages.findIndex((m) => m.id === id);
    if (idx < 0) return;
    const updated = { ...messages[idx], audioUrl, duration };
    const newMessages = [...messages];
    newMessages[idx] = updated;
    set({ messages: newMessages });

    const seq = messages[idx]._seq ?? idx;
    if (isPersistent && currentSessionId) {
      const persisted: PersistedMessage = { ...updated, sessionId: currentSessionId, seq };
      chatDb.saveMessage(persisted).catch((err: unknown) => {
        console.warn('Failed to persist message audio update', err);
      });
    }
  },

  updateMessageFeedback: (id, feedback) => {
    const { messages, currentSessionId, isPersistent } = get();
    const idx = messages.findIndex((m) => m.id === id);
    if (idx < 0) return;
    const updated = { ...messages[idx], feedback };
    const newMessages = [...messages];
    newMessages[idx] = updated;
    set({ messages: newMessages });

    const seq = messages[idx]._seq ?? idx;
    if (isPersistent && currentSessionId) {
      const persisted: PersistedMessage = { ...updated, sessionId: currentSessionId, seq };
      chatDb.saveMessage(persisted).catch((err: unknown) => {
        console.warn('Failed to persist message feedback update', err);
      });
    }
  },

  regenerateLast: async () => {
    const { messages, isPersistent } = get();
    // Last_Assistant_Message：最后一条且 role==='assistant'。
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return null;
    const remaining = messages.slice(0, -1);
    set({ messages: remaining });
    if (isPersistent) {
      try {
        await chatDb.deleteMessage(last.id);
      } catch {
        toastSaveFailed();
      }
    }
    return remaining.map((m) => ({ role: m.role, content: m.content }));
  },

  editAndResend: async (messageId, newContent) => {
    const { messages, currentSessionId, isPersistent } = get();
    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx < 0 || messages[idx].role !== 'user') return null;
    const trimmed = newContent.trim();
    if (trimmed.length === 0) return null; // Req 3.3：空内容整体 no-op

    // seq 语义 = 数组下标（与 appendMessage 的 seq=messages.length 一致）。
    const editedSeq = idx;
    const editedMsg: ChatMessage = { ...messages[idx], content: trimmed };
    // 截断：保留 [0, idx]，移除 idx 之后的全部消息（Req 3.5）。
    const truncated = [...messages.slice(0, idx), editedMsg];
    set({ messages: truncated });

    if (isPersistent && currentSessionId) {
      try {
        const persisted: PersistedMessage = {
          ...editedMsg,
          sessionId: currentSessionId,
          seq: editedSeq,
        };
        await chatDb.saveMessage(persisted); // 更新该 user 消息记录（Req 3.4）
        await chatDb.truncateMessagesAfter(currentSessionId, editedSeq); // Req 3.5
      } catch {
        toastSaveFailed();
      }
    }
    return truncated.map((m) => ({ role: m.role, content: m.content }));
  },

  importSessions: async (text) => {
    const result = parseImportBundle(text);
    if (!result.ok) {
      // 失败：不触碰任何状态/持久层，仅按类别提示并回传错误（Req 6.1–6.4）。
      useToastStore.getState().addToast({ message: result.error.message, type: 'error' });
      return result.error;
    }

    const { sessions: existing, isPersistent } = get();
    // 「已占用 id 集合」：现有会话 id + 本批已分配 id，保证库内 + 批内唯一（Req 4.2–4.3）。
    const takenSessionIds = new Set(existing.map((s) => s.id));
    const newSessionId = (): string => {
      let id = '';
      do {
        id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
      } while (takenSessionIds.has(id));
      takenSessionIds.add(id);
      return id;
    };
    // 消息 id 在整批内全局唯一（Chat_DB 以 message.id 作主键，跨会话亦不可冲突）。
    const takenMessageIds = new Set<string>();
    const newMessageId = (): string => {
      let id = '';
      do {
        id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
      } while (takenMessageIds.has(id));
      takenMessageIds.add(id);
      return id;
    };

    const now = new Date().toISOString();
    // 为每个导入条目构造新会话（新 id、updatedAt 缺失回退当前时间）与新消息（保序、新 id）。
    const built = result.sessions.map((entry) => {
      const session: ChatSession = {
        id: newSessionId(),
        title: entry.session.title,
        characterId: entry.session.characterId,
        voiceId: entry.session.voiceId,
        updatedAt: entry.session.updatedAt.length > 0 ? entry.session.updatedAt : now,
        pinned: false,
      };
      const messages: ChatMessage[] = entry.messages.map((m) => ({ ...m, id: newMessageId() }));
      return { session, messages };
    });
    const newSessions = built.map((b) => b.session);

    // 持久模式：经 Chat_DB 持久化每条新会话与其消息；失败保留内存并提示（Req 4.6, 8.2）。
    // 降级模式（isPersistent===false）：跳过 DB，仅内存维护（Req 8.1）。
    if (isPersistent) {
      try {
        for (const b of built) {
          await chatDb.saveSession(b.session);
          for (let i = 0; i < b.messages.length; i++) {
            const persisted: PersistedMessage = { ...b.messages[i], sessionId: b.session.id, seq: i };
            await chatDb.saveMessage(persisted);
          }
        }
      } catch {
        toastSaveFailed();
      }
    }

    // 切换到导入会话中 updatedAt 最新者并加载其消息（Req 4.7）；保留全部现有会话与消息（Req 4.5）。
    const latest = pickLatestSession(newSessions);
    const latestBuilt = latest ? built.find((b) => b.session.id === latest.id) : undefined;
    set((s) => ({
      sessions: [...s.sessions, ...newSessions],
      currentSessionId: latest ? latest.id : s.currentSessionId,
      messages: latestBuilt ? latestBuilt.messages : s.messages,
    }));

    useToastStore.getState().addToast({ message: `成功导入 ${newSessions.length} 个会话`, type: 'success' });
    return null;
  },

  collectExportSessions: async (scope) => {
    const { sessions, currentSessionId, messages, isPersistent } = get();
    if (scope === 'current') {
      // 当前会话：其消息已在内存（store.messages）。
      const current = sessions.find((s) => s.id === currentSessionId);
      if (!current) return [];
      return [{ session: current, messages }];
    }
    // scope === 'all'
    if (isPersistent) {
      try {
        // 持久模式：经 Chat_DB 跨会话取全量语料（复用 assembleSearchCorpus 同款手法）。
        const all = await chatDb.getAllSessions();
        return await Promise.all(
          all.map(async (session) => ({
            session,
            messages: await chatDb.getMessages(session.id),
          })),
        );
      } catch { console.warn("nuwa:store: error"); }
    }
    // Memory_Fallback_Mode 或读取失败：内存会话，仅当前会话有已加载消息。
    return sessions.map((session) => ({
      session,
      messages: session.id === currentSessionId ? messages : [],
    }));
  },

  searchQuery: '',
  searchResults: [],
  isSearching: false,

  setSearchQuery: (query) => set({ searchQuery: query }),

  clearSearch: () => set({ searchQuery: '', searchResults: [], isSearching: false }),

  runSearch: async () => {
    const { searchQuery } = get();
    const nq = normalizeQuery(searchQuery);
    if (nq === '') {
      // 空 / 纯空白查询：立即清空结果，不组装语料（Req 2.2）。
      set({ searchResults: [], isSearching: false });
      return;
    }
    set({ isSearching: true });
    const corpus = await assembleSearchCorpus();
    const results = searchCorpus(corpus, searchQuery);
    set({ searchResults: results, isSearching: false });
  },

  selectedVoiceId: 'jyy',
  setSelectedVoiceId: (id) => set({ selectedVoiceId: id }),

  params: { speed: 1.0, pitch: 0, temperature: 0.6, topK: 20, emotion: '中性' },
  setParam: (key, value) => set((s) => ({ params: { ...s.params, [key]: value } })),

  chatGenParams: loadChatGenParams(),
  setChatParam: (key, rawValue) => {
    const value = clampParam(key, rawValue);
    const next: ChatGenParams = {
      ...get().chatGenParams,
      [key]: { active: true, value },
    };
    saveChatGenParams(next);
    set({ chatGenParams: next });
  },
  clearChatParam: (key) => {
    const next: ChatGenParams = {
      ...get().chatGenParams,
      [key]: { active: false, value: DEFAULT_CHAT_GEN_PARAMS[key].value },
    };
    saveChatGenParams(next);
    set({ chatGenParams: next });
  },
  restoreChatParamDefaults: () => {
    const next: ChatGenParams = {
      temperature: { ...DEFAULT_CHAT_GEN_PARAMS.temperature },
      topP: { ...DEFAULT_CHAT_GEN_PARAMS.topP },
      numPredict: { ...DEFAULT_CHAT_GEN_PARAMS.numPredict },
      topK: { ...DEFAULT_CHAT_GEN_PARAMS.topK },
      repeatPenalty: { ...DEFAULT_CHAT_GEN_PARAMS.repeatPenalty },
    };
    saveChatGenParams(next);
    set({ chatGenParams: next });
  },

  isPlaying: false,
  playbackProgress: 0,
  togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),

  isGenerating: false,
  statusText: '准备就绪',
  setIsGenerating: (v) => set({ isGenerating: v }),
  setStatusText: (text) => set({ statusText: text }),

  isSettingsOpen: false,
  setSettingsOpen: (v) => set({ isSettingsOpen: v }),
  isHistoryOpen: false,
  toggleHistory: () => set((s) => ({ isHistoryOpen: !s.isHistoryOpen })),
  isAdvancedOpen: false,
  toggleAdvanced: () => set((s) => ({ isAdvancedOpen: !s.isAdvancedOpen })),

  // Command Palette（command-palette 新增切片）
  paletteOpen: false,
  paletteQuery: '',
  highlightIndex: -1,
  openPalette: () => set({ paletteOpen: true, paletteQuery: '', highlightIndex: -1 }),
  closePalette: () => set({ paletteOpen: false }),
  setPaletteQuery: (query) => set({ paletteQuery: query }),
  moveHighlight: (delta, listLength) =>
    set((s) => ({ highlightIndex: moveHighlightIndex(s.highlightIndex, delta, listLength) })),
  setHighlightIndex: (index) => set({ highlightIndex: index }),

  inputText: '',
  setInputText: (text) => set({ inputText: text }),

  lastTrimmedCount: 0,
  setLastTrimmedCount: (n) => set({ lastTrimmedCount: n }),
}));

export type { AppSettings };

export { defaultVoices };
