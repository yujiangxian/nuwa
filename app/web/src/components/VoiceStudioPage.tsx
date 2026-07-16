// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { useState, useRef, useEffect, useMemo } from 'react';
import { useUIStore } from '@/store/uiStore';
import { useToastStore } from '@/store/toastStore';
import { apiClient, apiUrl } from '@/api/client';
import { errorMessage } from '@/lib/errorDetail';
import { useVoices, useSynthesize, useConfig, useUploadVoice, useDeleteVoice, voiceAudioUrl } from '@/hooks/useApi';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useRecorder } from '@/hooks/useRecorder';
import type { AppConfig } from '@/store';
import { ArrowLeft, Settings, Plus, Play, Upload, User, Music, Mic, Square, Loader2, FileAudio, AlertCircle, Trash2, Check, X, FolderOpen } from 'lucide-react';

/**
 * 格式化时长：≥60s 用 `mm:ss`，否则用 `x.x s`；未知（null/undefined）返回 null。
 */
function formatDuration(sec: number | null | undefined): string | null {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return null;
  if (sec >= 60) {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  return `${sec.toFixed(1)} s`;
}

/**
 * WaveformCanvas：从音频 URL 解码并在 80x30 canvas 上渲染波形峰值。
 * 使用 AudioContext 离线解码，提取峰值后绘制竖条。
 */
function WaveformCanvas({ audioUrl }: { audioUrl: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let aborted = false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    void (async () => {
      try {
        const res = await fetch(audioUrl);
        if (!res.ok || aborted) return;
        const buffer = await res.arrayBuffer();
        if (aborted) return;
        const audioCtx = new AudioContext();
        const audioBuffer = await audioCtx.decodeAudioData(buffer);
        if (aborted) { await audioCtx.close(); return; }

        // 提取单声道峰值：将多声道合并取绝对值最大值，再按列降采样到 canvas 宽度。
        const raw = audioBuffer.getChannelData(0);
        const w = canvas.width;
        const h = canvas.height;
        const samplesPerBar = Math.floor(raw.length / w) || 1;
        const peaks: number[] = [];
        for (let i = 0; i < w; i++) {
          let max = 0;
          for (let j = 0; j < samplesPerBar; j++) {
            const idx = i * samplesPerBar + j;
            if (idx < raw.length) {
              const v = Math.abs(raw[idx]);
              if (v > max) max = v;
            }
          }
          peaks.push(max);
        }
        // 归一化到 [0, h*0.8]，留上下边距。
        const peakMax = Math.max(...peaks, 0.001);
        const norm = peaks.map((p) => (p / peakMax) * (h * 0.8));

        ctx.clearRect(0, 0, w, h);
        const barW = Math.max(1, w / w - 0.5);
        for (let i = 0; i < norm.length; i++) {
          const barH = Math.max(1, norm[i]);
          const y = (h - barH) / 2;
          ctx.fillStyle = 'rgba(72,202,228,0.35)';
          ctx.fillRect(i * (w / w), y, barW, barH);
        }
        await audioCtx.close();
      } catch {
        // 解码失败：静默降级，不渲染波形。
      }
    })();

    return () => { aborted = true; };
  }, [audioUrl]);

  return (
    <canvas
      ref={canvasRef}
      width={80}
      height={30}
      style={{ width: 80, height: 30, borderRadius: 6, display: 'block' }}
    />
  );
}

/**
 * 读取当前 TTS 模型 ID：优先 `current_models.tts`，回退兼容字段 `current_tts_model`。
 * 后端 `AppConfig` 实际包含这些字段（前端类型清理见任务 11.2），此处做容忍式读取。
 */
function readCurrentTtsModel(config: AppConfig | undefined): string | undefined {
  const cfg = config as
    | (AppConfig & { current_tts_model?: string | null; current_models?: Record<string, string> })
    | undefined;
  return cfg?.current_models?.tts ?? cfg?.current_tts_model ?? undefined;
}

export default function VoiceStudioPage() {
  const setPage = useUIStore((s) => s.setPage);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const autoPlay = useUIStore((s) => s.settings.autoPlay);
  const addToast = useToastStore((s) => s.addToast);
  const [activeTab, setActiveTab] = useState<'library' | 'synth' | 'clone'>('library');

  // 真实数据来源
  const voicesQuery = useVoices();
  const { data: config } = useConfig();
  const synthesize = useSynthesize();
  const player = useAudioPlayer();
  const uploadVoice = useUploadVoice();
  const deleteVoice = useDeleteVoice();
  const voices = useMemo(() => voicesQuery.data ?? [], [voicesQuery.data]);
  const currentTtsModel = readCurrentTtsModel(config);

  // Synth tab states
  const [synthText, setSynthText] = useState('');
  const [synthMode, setSynthMode] = useState<'single' | 'script'>('single');
  const [synthScript, setSynthScript] = useState(() => JSON.stringify([
    {text:"你好呀！我是季莹莹，很高兴认识你！",emotion:"happy"},
    {text:"今天天气真不错呢，阳光暖洋洋的。",emotion:"calm"},
  ], null, 2));
  const [scriptGenerating, setScriptGenerating] = useState(false);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [generatedPath, setGeneratedPath] = useState<string | null>(null);
  const [synthError, setSynthError] = useState<string | null>(null);
  const [synthHistory, setSynthHistory] = useState<Array<{ path: string; text: string; time: number }>>([]);
  const isGenerating = synthesize.isPending;

  // 音色加载完成且尚未选择时，默认选中第一个，保证 ref_audio 有值
  useEffect(() => {
    if (selectedVoiceId === null && voices.length > 0) {
      setSelectedVoiceId(voices[0].id);
    }
  }, [voices, selectedVoiceId]);

  const selectedVoice = voices.find((v) => v.id === selectedVoiceId) ?? null;

  // Recording states (录音转写：把语音转成可编辑的合成文本)
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const SYNTH_KEY = 'voice-studio-synth';

  // ==================== 声音库 Tab：试听 / 删除 ====================
  // 内联二次确认：记录当前待确认删除的条目 id（需求 4.1–4.3）。
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  /** 试听某条音色：toggle 播放/停止（需求 3.5/3.8）。 */
  const handlePreview = (voiceId: string) => {
    void player.play(`voice-${voiceId}`, voiceAudioUrl(voiceId));
  };

  /** 确认删除某条音色（需求 4.2/4.7）。 */
  const handleConfirmDelete = async (voiceId: string) => {
    // 删除前停止可能正在播放的该条试听，避免悬挂的音频请求。
    if (player.isPlaying(`voice-${voiceId}`)) player.stop();
    try {
      await deleteVoice.mutateAsync(voiceId);
      addToast({ message: '已删除音色', type: 'success' });
    } catch (err: unknown) {
      const msg = errorMessage(err, '删除失败');
      addToast({ message: msg, type: 'error' });
    } finally {
      setConfirmDeleteId(null);
    }
  };

  // ==================== 声音克隆 Tab：上传创建 ====================
  const recorder = useRecorder();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // 待上传音频：来自本地文件或录音二选一（需求 1.2/1.3）。
  const [cloneAudio, setCloneAudio] = useState<Blob | null>(null);
  const [cloneFilename, setCloneFilename] = useState('');
  const [cloneAudioLabel, setCloneAudioLabel] = useState('');
  const [cloneName, setCloneName] = useState('');
  const [cloneTranscript, setCloneTranscript] = useState('');
  const isUploading = uploadVoice.isPending;

  // 录音权限/设备错误以 toast 呈现（需求 1.3 错误反馈）。
  useEffect(() => {
    if (recorder.error) {
      addToast({ message: recorder.error, type: 'error' });
    }
  }, [recorder.error, addToast]);

  /** 选择本地音频文件，形成待上传 Blob。 */
  const handleFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCloneAudio(file);
    setCloneFilename(file.name);
    setCloneAudioLabel(file.name);
    // 允许再次选择同一文件触发 onChange。
    e.target.value = '';
  };

  /** 开始/停止录音；停止后将录音 Blob 作为待上传音频。 */
  const handleToggleRecord = async () => {
    if (recorder.isRecording) {
      const blob = await recorder.stop();
      if (blob) {
        setCloneAudio(blob);
        setCloneFilename('recording.webm');
        setCloneAudioLabel(`录音 (${(blob.size / 1024).toFixed(0)} KB)`);
      } else {
        addToast({ message: '录音太短，请重新录制', type: 'warning' });
      }
    } else {
      await recorder.start();
    }
  };

  /** 提交创建参考音色（需求 1.2/1.3/6.1/6.2/6.5/1.8）。 */
  const handleUpload = async () => {
    // 校验顺序：先音频（独立于名称/文本），再名称（需求 6.1/6.2）。
    if (!cloneAudio) {
      addToast({ message: '请先选择或录制音频', type: 'warning' });
      return;
    }
    if (!cloneName.trim()) {
      addToast({ message: '请填写音色名称', type: 'warning' });
      return;
    }
    if (isUploading) return;
    try {
      await uploadVoice.mutateAsync({
        audio: cloneAudio,
        filename: cloneFilename || 'audio.webm',
        name: cloneName.trim(),
        transcript: cloneTranscript,
      });
      addToast({ message: '音色创建成功', type: 'success' });
      // 重置表单（列表经 ['voices'] 失效自动刷新，需求 1.8）。
      setCloneAudio(null);
      setCloneFilename('');
      setCloneAudioLabel('');
      setCloneName('');
      setCloneTranscript('');
    } catch (err: unknown) {
      // 展示后端 error 文本，不向列表插入新条目（需求 6.5）。
      const msg = errorMessage(err, '上传失败');
      addToast({ message: msg, type: 'error' });
    }
  };

  const handleSynthesize = async () => {
    if (!synthText.trim()) { addToast({ message: '请输入要合成的文本', type: 'warning' }); return; }
    if (isGenerating) return;
    setSynthError(null);
    setGeneratedPath(null);
    player.stop();
    try {
      const data = await synthesize.mutateAsync({
        text: synthText,
        modelId: currentTtsModel,
        refAudio: selectedVoice?.path ?? '',
        refText: selectedVoice?.transcript ?? '',
      });
      if (data.success && data.output_path) {
        const path = data.output_path;
        setGeneratedPath(path);
        setSynthHistory((prev) => [...prev, { path, text: synthText, time: Date.now() }]);
        addToast({ message: '合成完成', type: 'success' });
        if (autoPlay) {
          void player.play(SYNTH_KEY, apiUrl(`/api/audio/${path}`));
        }
      } else {
        const msg = data.error || '合成失败';
        setSynthError(msg);
        addToast({ message: msg, type: 'error' });
      }
    } catch (err: unknown) {
      const msg = errorMessage(err, '合成请求失败');
      setSynthError(msg);
      addToast({ message: msg, type: 'error' });
    }
  };

  const handleSynthesizeScript = async () => {
    if (scriptGenerating) return;
    setSynthError(null);
    setGeneratedPath(null);
    player.stop();
    try {
      let segments;
      try { segments = JSON.parse(synthScript); } catch { setSynthError('JSON 格式错误，请检查脚本'); setScriptGenerating(false); return; }
      if (!Array.isArray(segments)) { setSynthError('脚本必须是 JSON 数组'); return; }
      setScriptGenerating(true);
      const { data } = await apiClient.post('/api/inference/tts/script', {
        segments,
        model_id: currentTtsModel,
        ref_audio: selectedVoice?.path ?? '',
        ref_text: selectedVoice?.transcript ?? '',
      });
      setScriptGenerating(false);
      if (data.success && data.output_path) {
        setGeneratedPath(data.output_path);
        setSynthHistory((prev) => [...prev, { path: data.output_path, text: synthScript, time: Date.now() }]);
        addToast({ message: '多段合成完成', type: 'success' });
        if (autoPlay) void player.play(SYNTH_KEY, apiUrl(`/api/audio/${data.output_path}`));
      } else {
        const msg = data.error || '合成失败';
        setSynthError(msg);
        addToast({ message: msg, type: 'error' });
      }
    } catch (err: unknown) {
      setScriptGenerating(false);
      const msg = errorMessage(err, '合成请求失败');
      setSynthError(msg);
      addToast({ message: msg, type: 'error' });
    }
  };

  return (
    <div className="flex flex-col h-full relative" style={{ zIndex: 10 }}>
      <header className="relative z-20 flex items-center justify-between px-5 py-3 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-3">
          <button onClick={() => setPage('home')} className="flex items-center justify-center" style={{ width: 36, height: 36, borderRadius: 10, color: 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer', transition: 'all 0.2s ease' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'; }}>
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-dim))', boxShadow: '0 0 16px var(--primary-glow)' }}>
              <Music size={16} style={{ color: 'var(--bg)' }} />
            </div>
            <span className="text-base font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>声音工坊</span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <div className="hidden md:flex items-center gap-1 glass rounded-full px-1.5 py-1">
            {(['library', 'synth', 'clone'] as const).map((t) => (
              <button key={t} onClick={() => setActiveTab(t)} className="transition-all" style={{ padding: '7px 18px', borderRadius: 100, fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', border: 'none', cursor: 'pointer', background: activeTab === t ? 'rgba(255,255,255,0.06)' : 'transparent', color: activeTab === t ? 'var(--text-primary)' : 'var(--text-secondary)', boxShadow: activeTab === t ? 'inset 0 1px 0 rgba(255,255,255,0.05)' : 'none' }}>
                {t === 'library' ? '声音库' : t === 'synth' ? '语音合成' : '声音克隆'}
              </button>
            ))}
          </div>
          <button className="flex items-center justify-center" style={{ width: 36, height: 36, borderRadius: 10, color: 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer', transition: 'all 0.2s ease' }}
            onClick={() => setSettingsOpen(true)}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'; }}>
            <Settings size={22} />
          </button>
        </div>
      </header>

      {/* Mobile Tabs */}
      <div className="md:hidden flex gap-2 p-3 pb-0 overflow-x-auto">
        {(['library', 'synth', 'clone'] as const).map((t) => (
          <button key={t} onClick={() => setActiveTab(t)} className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all border"
            style={{ background: activeTab === t ? 'rgba(72,202,228,0.08)' : 'transparent', color: activeTab === t ? 'var(--primary)' : 'var(--text-secondary)', borderColor: activeTab === t ? 'rgba(72,202,228,0.2)' : 'var(--border)' }}>
            {t === 'library' ? '声音库' : t === 'synth' ? '语音合成' : '声音克隆'}
          </button>
        ))}
      </div>

      {/* Library Tab */}
      {activeTab === 'library' && (
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>我的声音库</h2>
              <button className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium cursor-pointer transition-all" style={{ color: 'var(--primary)', background: 'rgba(72,202,228,0.08)', border: '1px solid rgba(72,202,228,0.15)' }}
                onClick={() => setActiveTab('clone')}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(72,202,228,0.12)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(72,202,228,0.08)'; }}>
                <Plus size={16} />
                添加声音
              </button>
            </div>

            {voicesQuery.isLoading && (
              <div className="flex items-center justify-center gap-2 py-12 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <Loader2 size={16} className="animate-spin" /> 正在加载音色...
              </div>
            )}
            {!voicesQuery.isLoading && voicesQuery.isError && (
              <div className="flex items-center justify-center gap-2 py-12 text-sm" style={{ color: '#FF6B6B' }}>
                <AlertCircle size={16} /> 音色库加载失败，请稍后重试
              </div>
            )}
            {!voicesQuery.isLoading && !voicesQuery.isError && voices.length === 0 && (
              <div className="text-center py-12 text-sm" style={{ color: 'var(--text-muted)' }}>暂无可用音色</div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {voices.map((v) => {
                const previewKey = `voice-${v.id}`;
                const isPreviewing = player.isPlaying(previewKey);
                const durationText = formatDuration(v.duration_seconds);
                const confirming = confirmDeleteId === v.id;
                return (
                  <div key={v.id} className="glass rounded-2xl p-5 glow-edge transition-all" style={{ border: '1px solid var(--border)' }}>
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, rgba(72,202,228,0.15), rgba(0,150,199,0.1))', border: '1px solid rgba(72,202,228,0.15)' }}>
                        <User size={24} style={{ color: 'var(--primary)' }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-base font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{v.name}</h3>
                        <p className="text-xs mt-1 truncate" style={{ color: 'var(--text-secondary)' }}>{v.transcript || '参考音色'}</p>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <span className="text-[11px] font-mono px-1.5 py-0.5 rounded-md" style={{ background: 'var(--surface)', color: 'var(--text-muted)' }}>
                            {v.sample_rate > 0 ? `${v.sample_rate} Hz` : '采样率未知'}
                          </span>
                          {durationText && (
                            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded-md" style={{ background: 'var(--surface)', color: 'var(--text-muted)' }}>
                              {durationText}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Waveform visualization */}
                    <div className="mt-3">
                      <WaveformCanvas audioUrl={voiceAudioUrl(v.id)} />
                    </div>

                    <div className="flex items-center gap-2 mt-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
                      {/* 试听（toggle 播放/停止，需求 3.5/3.8） */}
                      <button
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all"
                        style={{ color: 'var(--primary)', background: 'rgba(72,202,228,0.08)', border: '1px solid rgba(72,202,228,0.15)' }}
                        onClick={() => handlePreview(v.id)}
                        title={isPreviewing ? '停止试听' : '试听'}
                      >
                        {isPreviewing ? <Square size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
                        {isPreviewing ? '停止' : '试听'}
                      </button>
                      {/* 用此音色合成 */}
                      <button
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all"
                        style={{ color: 'var(--text-secondary)', background: 'transparent', border: '1px solid var(--border)' }}
                        onClick={() => { setSelectedVoiceId(v.id); setActiveTab('synth'); }}
                        title="用此音色合成"
                      >
                        <Music size={13} />
                        合成
                      </button>

                      <div className="flex-1" />

                      {/* 删除（内联二次确认，需求 4.1–4.3） */}
                      {confirming ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>确认删除?</span>
                          <button
                            className="flex items-center justify-center cursor-pointer"
                            style={{ width: 30, height: 30, borderRadius: 8, color: '#FF6B6B', background: 'rgba(255,107,107,0.1)', border: '1px solid rgba(255,107,107,0.2)' }}
                            onClick={() => handleConfirmDelete(v.id)}
                            disabled={deleteVoice.isPending}
                            title="确认删除"
                          >
                            {deleteVoice.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                          </button>
                          <button
                            className="flex items-center justify-center cursor-pointer"
                            style={{ width: 30, height: 30, borderRadius: 8, color: 'var(--text-secondary)', background: 'transparent', border: '1px solid var(--border)' }}
                            onClick={() => setConfirmDeleteId(null)}
                            disabled={deleteVoice.isPending}
                            title="取消"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <button
                          className="flex items-center justify-center cursor-pointer transition-all"
                          style={{ width: 30, height: 30, borderRadius: 8, color: 'var(--text-muted)', background: 'transparent', border: '1px solid var(--border)' }}
                          onClick={() => setConfirmDeleteId(v.id)}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#FF6B6B'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,107,107,0.3)'; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; }}
                          title="删除音色"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Synth Tab */}
      {activeTab === 'synth' && (
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="max-w-2xl mx-auto">
            <h2 className="text-lg font-semibold mb-6" style={{ color: 'var(--text-primary)' }}>语音合成</h2>

            {/* 录音转写区域：把语音转成可编辑文本 */}
            <div className="glass glow-edge rounded-2xl p-5 mb-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <FileAudio size={16} style={{ color: 'var(--primary)' }} />
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>录音转写</span>
                </div>
                {isRecording && (
                  <span className="text-xs font-mono px-2 py-0.5 rounded-lg" style={{ background: 'rgba(255,107,107,0.1)', color: '#FF6B6B' }}>
                    录音中 {Math.floor(recordingTime / 60)}:{String(recordingTime % 60).padStart(2, '0')}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={async () => {
                    if (isRecording) {
                      // 停止录音
                      mediaRecorderRef.current?.stop();
                      if (recordingTimerRef.current) {
                        clearInterval(recordingTimerRef.current);
                        recordingTimerRef.current = null;
                      }
                      setIsRecording(false);
                      setRecordingTime(0);
                    } else {
                      // 开始录音
                      try {
                        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                        const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
                        mediaRecorderRef.current = mediaRecorder;
                        audioChunksRef.current = [];

                        mediaRecorder.ondataavailable = (e) => {
                          if (e.data.size > 0) audioChunksRef.current.push(e.data);
                        };

                        mediaRecorder.onstop = async () => {
                          // 停止所有轨道
                          stream.getTracks().forEach((t) => t.stop());

                          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                          if (audioBlob.size < 1000) {
                            addToast({ message: '录音太短，请重新录制', type: 'warning' });
                            setIsTranscribing(false);
                            return;
                          }

                          setIsTranscribing(true);
                          try {
                            const formData = new FormData();
                            formData.append('audio', audioBlob, 'recording.webm');

                            const { data } = await apiClient.post<{
                              success: boolean;
                              text: string;
                              error?: string;
                            }>('/api/inference/asr/upload', formData, {
                              headers: { 'Content-Type': 'multipart/form-data' },
                              timeout: 60000,
                            });

                            if (data.success) {
                              setSynthText((prev) => (prev ? prev + '\n' + data.text : data.text));
                              addToast({ message: '转写完成', type: 'success' });
                            } else {
                              addToast({ message: data.error || '转写失败', type: 'error' });
                            }
                          } catch (err: unknown) {
                            addToast({ message: errorMessage(err, '转写请求失败'), type: 'error' });
                          } finally {
                            setIsTranscribing(false);
                          }
                        };

                        mediaRecorder.start();
                        setIsRecording(true);
                        setRecordingTime(0);
                        recordingTimerRef.current = setInterval(() => {
                          setRecordingTime((t) => t + 1);
                        }, 1000);
                      } catch {
                        addToast({ message: '无法访问麦克风，请检查权限', type: 'error' });
                      }
                    }
                  }}
                  className="flex items-center gap-2"
                  style={{
                    background: isRecording ? 'rgba(255,107,107,0.15)' : 'rgba(72,202,228,0.08)',
                    color: isRecording ? '#FF6B6B' : 'var(--primary)',
                    borderRadius: 10,
                    padding: '8px 16px',
                    fontWeight: 600,
                    fontSize: 13,
                    border: isRecording ? '1px solid rgba(255,107,107,0.2)' : '1px solid rgba(72,202,228,0.15)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                  disabled={isTranscribing}
                >
                  {isRecording ? <Square size={14} fill="currentColor" /> : <Mic size={14} />}
                  {isRecording ? '停止录音' : '开始录音'}
                </button>
                {isTranscribing && (
                  <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    <Loader2 size={12} className="animate-spin" />
                    正在识别...
                  </span>
                )}
              </div>
            </div>

            {/* 参考音色选择 */}
            <div className="glass glow-edge rounded-2xl p-5 mb-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>参考音色</span>
                {currentTtsModel && (
                  <span className="text-xs font-mono px-2 py-0.5 rounded-lg" style={{ background: 'var(--surface)', color: 'var(--primary)', border: '1px solid rgba(72,202,228,0.15)' }}>
                    {currentTtsModel}
                  </span>
                )}
              </div>
              {voicesQuery.isLoading ? (
                <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <Loader2 size={12} className="animate-spin" /> 正在加载音色...
                </div>
              ) : voices.length === 0 ? (
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>暂无可用音色，将使用后端默认参考音</div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {voices.map((v) => {
                    const active = v.id === selectedVoiceId;
                    return (
                      <div
                        key={v.id}
                        className="flex items-center gap-1 rounded-xl transition-all"
                        style={{
                          background: active ? 'rgba(72,202,228,0.1)' : 'transparent',
                          border: `1px solid ${active ? 'rgba(72,202,228,0.3)' : 'var(--border)'}`,
                        }}
                      >
                        <button
                          onClick={() => setSelectedVoiceId(v.id)}
                          className="flex items-center gap-2 px-3 py-2 text-left flex-1 min-w-0"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                          }}
                        >
                          <User size={16} style={{ color: active ? 'var(--primary)' : 'var(--text-secondary)', flexShrink: 0 }} />
                          <span className="text-xs font-medium truncate" style={{ color: active ? 'var(--primary)' : 'var(--text-primary)' }}>{v.name}</span>
                        </button>
                        {v.path && (
                          <button
                            onClick={(e) => { e.stopPropagation(); void player.play(`voice-preview-${v.id}`, apiUrl(`/api/audio/${v.path}`)); }}
                            className="flex items-center justify-center shrink-0 mr-1"
                            style={{
                              width: 24, height: 24, borderRadius: 6,
                              color: 'var(--primary)', background: 'rgba(72,202,228,0.08)',
                              border: 'none', cursor: 'pointer',
                            }}
                            title={`试听 ${v.name}`}
                          >
                            {player.isPlaying(`voice-preview-${v.id}`) ? <Square size={10} fill="currentColor" /> : <Play size={10} fill="currentColor" />}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="glass glow-edge rounded-2xl p-5 mb-4">
              {/* Mode toggle */}
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>合成模式</span>
                <div className="flex rounded-lg p-0.5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                  {(['single','script'] as const).map(m => (
                    <button key={m} onClick={() => { player.stop(); setSynthMode(m); setGeneratedPath(null); setSynthError(null); }}
                      className="px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer"
                      style={{ background: synthMode === m ? 'var(--primary)' : 'transparent', color: synthMode === m ? 'var(--bg)' : 'var(--text-secondary)' }}>
                      {m === 'single' ? '单句' : '多段脚本'}
                    </button>
                  ))}
                </div>
              </div>
              {synthMode === 'single' ? (
                <textarea className="w-full outline-none resize-none bg-transparent text-sm leading-relaxed"
                  style={{ color: 'var(--text-primary)', caretColor: 'var(--primary)', minHeight: 100 }}
                  placeholder="输入要合成的文本..." value={synthText}
                  onChange={e => setSynthText(e.target.value)} maxLength={500} />
              ) : (
                <textarea className="w-full outline-none resize-none bg-transparent text-sm leading-relaxed"
                  style={{ color: 'var(--text-primary)', caretColor: 'var(--primary)', minHeight: 160, fontFamily: 'JetBrains Mono, monospace' }}
                  placeholder={`[{"text":"你好！","emotion":"happy"},\n{"text":"今天天气不错。","emotion":"calm"}]`}
                  value={synthScript} onChange={e => setSynthScript(e.target.value)} rows={8} />
              )}
              <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                  {synthMode === 'single' ? `${synthText.length} / 500 字` : `${synthScript.split('\n').length} 行 JSON`}
                </span>
                <button
                  className="flex items-center gap-2"
                  style={{
                    background: (isGenerating || scriptGenerating) ? 'rgba(72,202,228,0.06)' : 'linear-gradient(135deg, var(--primary), var(--primary-dim))',
                    color: 'var(--bg)', borderRadius: 12, padding: '10px 24px', fontWeight: 600, fontSize: 14,
                    border: 'none', cursor: (isGenerating || scriptGenerating) ? 'not-allowed' : 'pointer',
                    boxShadow: (isGenerating || scriptGenerating) ? 'none' : '0 0 24px var(--primary-glow)',
                    transition: 'all 0.2s ease', opacity: (isGenerating || scriptGenerating) ? 0.6 : 1,
                  }}
                  onClick={synthMode === 'single' ? handleSynthesize : handleSynthesizeScript}
                  disabled={isGenerating || scriptGenerating}
                  onMouseEnter={(e) => { if (!isGenerating && !scriptGenerating) { (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 40px var(--primary-glow-strong)'; (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'; } }}
                  onMouseLeave={(e) => { if (!isGenerating && !scriptGenerating) { (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 24px var(--primary-glow)'; (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'; } }}
                >
                  {(isGenerating || scriptGenerating) ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} fill="currentColor" />}
                  {(isGenerating || scriptGenerating) ? '合成中...' : '开始合成'}
                </button>
              </div>

              {synthError && (
                <div className="mt-4 pt-3 flex items-start gap-2 text-sm" style={{ borderTop: '1px solid var(--border)', color: '#FF6B6B' }}>
                  <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>{synthError}</span>
                </div>
              )}

              {generatedPath && !synthError && (
                <div className="mt-4 pt-3 flex items-center gap-3" style={{ borderTop: '1px solid var(--border)' }}>
                  <button
                    onClick={() => player.play(SYNTH_KEY, apiUrl(`/api/audio/${generatedPath}`))}
                    className="flex items-center gap-2"
                    style={{ background: 'rgba(72,202,228,0.08)', color: 'var(--primary)', borderRadius: 10, padding: '8px 16px', fontWeight: 600, fontSize: 13, border: '1px solid rgba(72,202,228,0.15)', cursor: 'pointer' }}
                  >
                    {player.isPlaying(SYNTH_KEY) ? <Square size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
                    {player.isPlaying(SYNTH_KEY) ? '停止播放' : '播放'}
                  </button>
                  <span className="text-xs font-mono truncate" style={{ color: 'var(--text-muted)' }}>{generatedPath}</span>
                </div>
              )}
            </div>

            {/* Synthesis history */}
            {synthHistory.length > 0 && (
              <div className="glass glow-edge rounded-2xl p-5">
                <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>合成历史</h3>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {[...synthHistory].reverse().map((entry, idx) => {
                    const historyKey = `synth-history-${entry.time}`;
                    const isPlayingHistory = player.isPlaying(historyKey);
                    return (
                      <div key={`${entry.time}-${idx}`} className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                        <button
                          onClick={() => player.play(historyKey, apiUrl(`/api/audio/${entry.path}`))}
                          className="flex items-center justify-center shrink-0"
                          style={{ width: 28, height: 28, borderRadius: 8, color: 'var(--primary)', background: 'rgba(72,202,228,0.08)', border: 'none', cursor: 'pointer' }}
                          title={isPlayingHistory ? '停止' : '重播'}
                        >
                          {isPlayingHistory ? <Square size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
                        </button>
                        <span className="text-xs truncate flex-1" style={{ color: 'var(--text-secondary)' }}>
                          {entry.text.length > 50 ? entry.text.slice(0, 50) + '...' : entry.text}
                        </span>
                        <span className="text-[10px] font-mono shrink-0" style={{ color: 'var(--text-muted)' }}>
                          {new Date(entry.time).toLocaleTimeString()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Clone Tab */}
      {activeTab === 'clone' && (
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="max-w-2xl mx-auto">
            <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>声音克隆</h2>
            <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>上传本地音频或录制一段干净人声，标注名称与参考文本，保存为可复用的参考音色。</p>

            {/* 音频来源：本地文件 或 录音 二选一 */}
            <div className="glass glow-edge rounded-2xl p-5 mb-4">
              <div className="flex items-center gap-2 mb-3">
                <FileAudio size={16} style={{ color: 'var(--primary)' }} />
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>参考音频</span>
              </div>

              {/* 隐藏的文件输入 */}
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                style={{ display: 'none' }}
                onChange={handleFilePicked}
                aria-label="选择音频文件"
              />

              <div className="flex items-center gap-3 flex-wrap">
                {/* 选择本地文件 */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={recorder.isRecording}
                  className="flex items-center gap-2"
                  style={{
                    background: 'rgba(72,202,228,0.08)',
                    color: 'var(--primary)',
                    borderRadius: 10,
                    padding: '8px 16px',
                    fontWeight: 600,
                    fontSize: 13,
                    border: '1px solid rgba(72,202,228,0.15)',
                    cursor: recorder.isRecording ? 'not-allowed' : 'pointer',
                    opacity: recorder.isRecording ? 0.5 : 1,
                    transition: 'all 0.2s ease',
                  }}
                >
                  <FolderOpen size={14} />
                  选择文件
                </button>

                {/* 录音开始/停止 */}
                <button
                  onClick={handleToggleRecord}
                  className="flex items-center gap-2"
                  style={{
                    background: recorder.isRecording ? 'rgba(255,107,107,0.15)' : 'rgba(72,202,228,0.08)',
                    color: recorder.isRecording ? '#FF6B6B' : 'var(--primary)',
                    borderRadius: 10,
                    padding: '8px 16px',
                    fontWeight: 600,
                    fontSize: 13,
                    border: recorder.isRecording ? '1px solid rgba(255,107,107,0.2)' : '1px solid rgba(72,202,228,0.15)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {recorder.isRecording ? <Square size={14} fill="currentColor" /> : <Mic size={14} />}
                  {recorder.isRecording ? '停止录音' : '开始录音'}
                </button>

                {recorder.isRecording && (
                  <span className="text-xs font-mono px-2 py-0.5 rounded-lg" style={{ background: 'rgba(255,107,107,0.1)', color: '#FF6B6B' }}>
                    录音中 {Math.floor(recorder.recordingTime / 1000 / 60)}:{String(Math.floor((recorder.recordingTime / 1000) % 60)).padStart(2, '0')}
                  </span>
                )}
              </div>

              {/* 已选音频提示 */}
              {cloneAudio && !recorder.isRecording && (
                <div className="flex items-center gap-2 mt-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <Check size={14} style={{ color: 'var(--primary)' }} />
                  <span className="truncate">已选音频：{cloneAudioLabel}</span>
                </div>
              )}
            </div>

            {/* 名称 */}
            <div className="glass glow-edge rounded-2xl p-5 mb-4">
              <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-primary)' }}>音色名称</label>
              <input
                type="text"
                className="w-full outline-none bg-transparent text-sm"
                style={{ color: 'var(--text-primary)', caretColor: 'var(--primary)', borderBottom: '1px solid var(--border)', padding: '6px 0' }}
                placeholder="给这个音色起个名字..."
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
                maxLength={50}
              />
            </div>

            {/* 参考文本 */}
            <div className="glass glow-edge rounded-2xl p-5 mb-4">
              <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-primary)' }}>参考文本</label>
              <textarea
                className="w-full outline-none resize-none bg-transparent text-sm leading-relaxed"
                style={{ color: 'var(--text-primary)', caretColor: 'var(--primary)', minHeight: 80 }}
                placeholder="输入参考音频对应的文本内容（可选，用于提升克隆相似度）..."
                value={cloneTranscript}
                onChange={(e) => setCloneTranscript(e.target.value)}
                maxLength={500}
              />
            </div>

            {/* 提交 */}
            <button
              className="flex items-center gap-2 w-full justify-center"
              style={{
                background: isUploading ? 'rgba(72,202,228,0.06)' : 'linear-gradient(135deg, var(--primary), var(--primary-dim))',
                color: 'var(--bg)',
                borderRadius: 12,
                padding: '12px 24px',
                fontWeight: 600,
                fontSize: 14,
                border: 'none',
                cursor: isUploading ? 'not-allowed' : 'pointer',
                boxShadow: isUploading ? 'none' : '0 0 24px var(--primary-glow)',
                transition: 'all 0.2s ease',
                opacity: isUploading ? 0.6 : 1,
              }}
              onClick={handleUpload}
              disabled={isUploading}
            >
              {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              {isUploading ? '创建中...' : '创建音色'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
