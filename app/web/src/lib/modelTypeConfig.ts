/// 模型类型与下载状态视觉配置 — 从 ModelsPage 提取，供全项目复用。
import { Cpu, Mic, MessageSquare, Box, AudioLines, Music, Volume2, Wand2, Activity, Users, Fingerprint, Heart, Brain, Languages, Check, Clock, Gauge, AlertTriangle, X } from 'lucide-react';

export const typeConfig: Record<string, { label: string; icon: typeof Cpu; color: string; bg: string; glow: string }> = {
  asr: { label: '语音识别', icon: Mic, color: '#52B788', bg: 'rgba(82,183,136,0.08)', glow: 'rgba(82,183,136,0.25)' },
  tts: { label: '语音合成', icon: MessageSquare, color: '#FF6B9D', bg: 'rgba(255,107,157,0.08)', glow: 'rgba(255,107,157,0.25)' },
  llm: { label: '大语言模型', icon: Cpu, color: '#48CAE4', bg: 'rgba(72,202,228,0.08)', glow: 'rgba(72,202,228,0.25)' },
  svs: { label: '歌声合成', icon: AudioLines, color: '#A78BFA', bg: 'rgba(167,139,250,0.08)', glow: 'rgba(167,139,250,0.25)' },
  music: { label: '音乐生成', icon: Music, color: '#F59E0B', bg: 'rgba(245,158,11,0.08)', glow: 'rgba(245,158,11,0.25)' },
  sound: { label: '音效生成', icon: Volume2, color: '#D4AF37', bg: 'rgba(212,175,55,0.08)', glow: 'rgba(212,175,55,0.25)' },
  enhance: { label: '语音增强', icon: Wand2, color: '#22D3EE', bg: 'rgba(34,211,238,0.08)', glow: 'rgba(34,211,238,0.25)' },
  vad: { label: '语音检测', icon: Activity, color: '#FB923C', bg: 'rgba(251,146,60,0.08)', glow: 'rgba(251,146,60,0.25)' },
  diarization: { label: '说话人分离', icon: Users, color: '#818CF8', bg: 'rgba(129,140,248,0.08)', glow: 'rgba(129,140,248,0.25)' },
  speaker: { label: '声纹识别', icon: Fingerprint, color: '#C084FC', bg: 'rgba(192,132,252,0.08)', glow: 'rgba(192,132,252,0.25)' },
  emotion: { label: '情感识别', icon: Heart, color: '#F472B6', bg: 'rgba(244,114,182,0.08)', glow: 'rgba(244,114,182,0.25)' },
  audio_lm: { label: '音频大模型', icon: Brain, color: '#38BDF8', bg: 'rgba(56,189,248,0.08)', glow: 'rgba(56,189,248,0.25)' },
  translation: { label: '语音翻译', icon: Languages, color: '#34D399', bg: 'rgba(52,211,153,0.08)', glow: 'rgba(52,211,153,0.25)' },
  other: { label: '其他', icon: Box, color: '#9CA3AF', bg: 'rgba(156,163,175,0.08)', glow: 'rgba(156,163,175,0.25)' },
};

export const statusConfig: Record<string, { label: string; color: string; bg: string; icon: typeof Clock }> = {
  pending: { label: '等待中', color: '#6A9EAD', bg: 'rgba(106,158,173,0.10)', icon: Clock },
  running: { label: '下载中', color: '#48CAE4', bg: 'rgba(72,202,228,0.10)', icon: Gauge },
  completed: { label: '已完成', color: '#52B788', bg: 'rgba(82,183,136,0.10)', icon: Check },
  partial_failed: { label: '部分失败', color: '#FB923C', bg: 'rgba(251,146,60,0.10)', icon: AlertTriangle },
  failed: { label: '失败', color: '#FF6B6B', bg: 'rgba(255,107,107,0.10)', icon: AlertTriangle },
  cancelled: { label: '已取消', color: '#D4AF37', bg: 'rgba(212,175,55,0.10)', icon: X },
};
