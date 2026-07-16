// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// 共享类型定义 — 从 uiStore.ts 提取，供全项目引用。
// 所有 lib/ 模块的类型导入应使用此文件而非 uiStore.ts，
// 消除运行时依赖，仅保持类型级耦合。

export type AppPage = 'home' | 'chat' | 'playground' | 'voice' | 'transcribe' | 'models' | 'presets' | 'agents';

/** V1: local only. V2 adds workflow; V3 adds external. */
export type AgentKind = 'local' | 'workflow' | 'external';

/** Local execution pipeline ids backed by agent_scheduler. */
export type AgentPipeline = 'text_chat_stream' | 'text_chat' | 'voice_reply';

/** V2 workflow step capability. */
export type AgentCapability = 'asr' | 'llm' | 'tts';

export interface AgentStep {
  id: string;
  capability: AgentCapability;
  label: string;
}

/** 外部 Agent 接入协议（AI 网关按此分派适配器）。 */
export type ExternalProtocol = 'openai-compatible' | 'anthropic';

export interface Agent {
  id: string;
  name: string;
  description: string;
  avatar: string;
  systemPrompt: string;
  voiceId: string;
  kind: AgentKind;
  /** Used when kind === 'local' (and as fallback for workflow). */
  pipeline: AgentPipeline;
  /** V2: ordered capabilities when kind === 'workflow'. */
  steps?: AgentStep[];
  /** Optional mood label (migrated from Character). */
  mood?: string;
  temperature?: number;
  topP?: number;
  /** V3: OpenAI-compatible base URL (no trailing slash required). */
  endpoint?: string;
  /** V3: model id on the remote provider. */
  externalModel?: string;
  protocol?: ExternalProtocol;
}

export interface AgentInput {
  name: string;
  description: string;
  avatar: string;
  systemPrompt: string;
  voiceId: string;
  kind: AgentKind;
  pipeline: AgentPipeline;
  steps?: AgentStep[];
  mood?: string;
  temperature?: number;
  topP?: number;
  endpoint?: string;
  externalModel?: string;
  protocol?: ExternalProtocol;
  /** V3: written to localStorage only, not persisted in IndexedDB. */
  apiKey?: string;
}

export interface VoiceItem {
  id: string;
  name: string;
  tags: string;
  icon: string;
  iconColor: string;
  gradient: string;
}

export interface Character {
  id: string;
  name: string;
  avatar: string;
  systemPrompt: string;
  voiceId: string;
  description: string;
  mood?: string;
  temperature?: number;
  topP?: number;
}

export interface CharacterInput {
  name: string;
  systemPrompt: string;
  description: string;
  avatar: string;
  voiceId: string;
  mood?: string;
  temperature?: number;
  topP?: number;
}

export interface ChatSession {
  id: string;
  title: string;
  /**
   * @deprecated use agentId — kept as alias for import/export compatibility.
   * New sessions write characterId = agentId.
   */
  characterId: string;
  /** Bound Agent for this session (Chat calls this Agent). Optional for legacy sessions. */
  agentId?: string;
  voiceId: string;
  updatedAt: string;
  pinned: boolean;
  archived?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  audioUrl?: string;
  voiceName?: string;
  duration?: string;
  feedback?: 'up' | 'down';
  /** Opaque persistence sequence: only set at append, reused by updateMessageAudio. */
  _seq?: number;
}

export interface PromptPreset {
  id: string;
  title: string;
  content: string;
  tags?: string[];
}

export interface GenerationParams {
  speed: number;
  pitch: number;
  temperature: number;
  topK: number;
  emotion: string;
}

export interface AppSettings {
  backendUrl: string;
  modelsDir: string;
  theme: 'dark' | 'light' | 'system';
  autoPlay: boolean;
  language: string;
}
