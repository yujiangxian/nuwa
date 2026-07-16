// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * V2: map an ordered capability step list to a backend agent_scheduler pipeline.
 */
import type { AgentPipeline } from '@/store/types';

export type AgentCapability = 'asr' | 'llm' | 'tts';

export interface AgentStep {
  id: string;
  capability: AgentCapability;
  label: string;
}

export const CAPABILITY_LABELS: Record<AgentCapability, string> = {
  asr: '语音识别',
  llm: '大模型对话',
  tts: '语音合成',
};

/** Preset step chains shown in the Agent editor. */
export const WORKFLOW_PRESETS: { id: string; name: string; steps: AgentCapability[] }[] = [
  { id: 'chat', name: '纯文字对话', steps: ['llm'] },
  { id: 'speak', name: '文字对话 + 朗读', steps: ['llm', 'tts'] },
  { id: 'voice', name: '语音回复（听→想→说）', steps: ['asr', 'llm', 'tts'] },
  { id: 'transcribe', name: '仅转写', steps: ['asr'] },
  { id: 'synthesize', name: '仅合成', steps: ['tts'] },
];

export function makeSteps(caps: AgentCapability[]): AgentStep[] {
  return caps.map((capability, i) => ({
    id: `step-${i}-${capability}`,
    capability,
    label: CAPABILITY_LABELS[capability],
  }));
}

/**
 * Resolve fixed backend pipeline from steps.
 * Chat always uses text path when user already typed; ASR in steps means
 * "voice-oriented agent" → prefer voice_reply semantics (FE still does ASR via mic).
 */
export function resolvePipelineFromSteps(steps: AgentStep[]): AgentPipeline {
  const caps = steps.map((s) => s.capability);
  const has = (c: AgentCapability) => caps.includes(c);
  if (has('asr') && has('llm') && has('tts')) return 'voice_reply';
  if (has('llm') && has('tts')) return 'text_chat';
  if (has('llm')) return 'text_chat_stream';
  if (has('asr')) return 'voice_reply'; // chat text still goes through LLM stream; mic fills text
  if (has('tts')) return 'text_chat'; // need LLM text first in chat context
  return 'text_chat_stream';
}

/** Whether Chat should auto-run TTS after LLM for this step chain / pipeline. */
export function shouldAutoTts(steps: AgentStep[] | undefined, pipeline: AgentPipeline): boolean {
  if (steps && steps.some((s) => s.capability === 'tts')) return true;
  return pipeline === 'text_chat' || pipeline === 'voice_reply';
}

export function stepsEqual(a: AgentStep[] | undefined, b: AgentStep[] | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((s, i) => s.capability === b[i].capability);
}
