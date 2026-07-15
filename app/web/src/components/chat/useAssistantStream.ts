// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { useRef, useEffect, useState, useCallback } from 'react';
import { useUIStore, type ChatMessage } from '@/store/uiStore';
import { apiClient } from '@/api/client';
import { type ErrorDetail } from '@/lib/errorDetail';
import type { TtsResponse } from '@/hooks/useApi';
import type { UseAudioQueue } from '@/hooks/useAudioQueue';
import type { Voice } from '@/store';
import { resolveVoiceRef } from '@/lib/voice';
import { accumulateDelta, shouldPersistFinal, type StreamChunk } from '@/lib/streamChat';
import { buildRequestFragment } from '@/lib/generationParams';
import { resolveContextLength } from '@/lib/contextWindow';
import { resolveReservedTokens } from '@/lib/contextBudget';
import { trimMessages } from '@/lib/contextTrim';
import { estimateText } from '@/lib/tokenEstimate';
import { extractNewSentences } from '@/lib/sentenceSplit';

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

type SynthesizeMutate = {
  mutateAsync: (args: {
    text: string;
    modelId?: string;
    refAudio?: string;
    refText?: string;
  }) => Promise<TtsResponse>;
};

export type UseAssistantStreamArgs = {
  currentCharacter: { voiceId?: string; systemPrompt?: string } | undefined;
  currentVoice: string;
  autoPlay: boolean;
  synthesize: SynthesizeMutate;
  currentTtsModel: string | undefined;
  voices: Voice[];
  appendMessage: (msg: ChatMessage) => Promise<void>;
  setLastTrimmedCount: (n: number) => void;
  activeModelContextLength: number | undefined;
  tempSystemPrompt: string | null;
  player: UseAudioQueue;
  addToast: (toast: { message: string; type: 'error' | 'success' | 'info' | 'warning'; duration?: number }) => void;
};

export function useAssistantStream({
  currentCharacter,
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
}: UseAssistantStreamArgs) {
  const [isTyping, setIsTyping] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingThinking, setStreamingThinking] = useState('');
  const [thinkOpen, setThinkOpen] = useState(true);
  const accRef = useRef('');
  const thinkRef = useRef('');
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [ttsLoadingId, setTtsLoadingId] = useState<string | null>(null);
  const [ttsPendingMsgId, setTtsPendingMsgId] = useState<string | null>(null);
  const sentBoundaryRef = useRef(0);
  const streamingMsgIdRef = useRef<string | null>(null);
  const streamLlmDoneRef = useRef(false);
  const sendingRef = useRef(false);
  const abortedTtsRef = useRef(false);
  const sseCompletedRef = useRef(false);
  const streamTotalDurRef = useRef(0);
  const ttsStartedAtRef = useRef(0);
  const MAX_STREAM_SENTENCES = 20;
  const streamAudioPathsRef = useRef<string[]>([]);
  const [ttsSynthCount, setTtsSynthCount] = useState(0);
  const [ttsSynthDone, setTtsSynthDone] = useState(0);

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
          // Synthesize the full text once so audio is cached for instant replay —
          // but only when autoPlay is on (Req 5.3: autoPlay OFF must not call TTS at all).
          if (autoPlay && ttsSentenceCount === 0 && accRef.current.trim().length > 0 && !ctrl.signal.aborted) {
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
    [currentCharacter, currentVoice, addToast, autoPlay, synthesize, currentTtsModel, voices, appendMessage, setLastTrimmedCount, activeModelContextLength, tempSystemPrompt, player, ttsSynthCount, ttsSynthDone],
  );

  useEffect(() => {
    if (!isStreaming) return;
    // 仅当 LLM 流本身已结束（streamLlmDoneRef，由 onDone 设置）时，才允许"TTS 追上进度"
    // 这一条件收尾流式气泡；否则 TTS 合成过快会在 LLM 仍在输出文本时提前清空气泡。
    if (!streamLlmDoneRef.current) return;
    if (ttsSynthCount > 0 && ttsSynthDone >= ttsSynthCount) {
      setIsStreaming(false);
      setStreamingContent('');
    }
  }, [isStreaming, ttsSynthCount, ttsSynthDone]);

  // Stop_Action：中断 fetch/consume + 清空音频队列；已接收增量在 finalize 中保留并定型。
  const handleStop = useCallback(() => {
    abortController?.abort();
    sendingRef.current = false;
    abortedTtsRef.current = true;
    player.clear();
  }, [abortController, player]);

  return {
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
    abortedTtsRef,
    sseCompletedRef,
    ttsStartedAtRef,
    ttsSynthCount,
    ttsSynthDone,
    runAssistantStream,
    handleStop,
  };
}
