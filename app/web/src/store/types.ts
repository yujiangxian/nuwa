// 共享类型定义 — 从 uiStore.ts 提取，供全项目引用。
// 所有 lib/ 模块的类型导入应使用此文件而非 uiStore.ts，
// 消除运行时依赖，仅保持类型级耦合。

export type AppPage = 'home' | 'chat' | 'voice' | 'transcribe' | 'models' | 'characters' | 'presets' | 'workflow';

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
}

export interface CharacterInput {
  name: string;
  systemPrompt: string;
  description: string;
  avatar: string;
  voiceId: string;
}

export interface ChatSession {
  id: string;
  title: string;
  characterId: string;
  voiceId: string;
  updatedAt: string;
  pinned: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  audioUrl?: string;
  voiceName?: string;
  duration?: string;
}

export interface PromptPreset {
  id: string;
  title: string;
  content: string;
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
