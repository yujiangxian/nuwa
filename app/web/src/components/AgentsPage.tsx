// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import { useState, useRef } from 'react';
import {
  useUIStore,
  type Agent,
  type AgentInput,
  type AgentKind,
  type AgentPipeline,
  type AgentStep,
} from '@/store/uiStore';
import { useToastStore } from '@/store/toastStore';
import { useVoices } from '@/hooks/useApi';
import { validateName, NAME_MAX_LENGTH } from '@/lib/agent';
import {
  CAPABILITY_LABELS,
  WORKFLOW_PRESETS,
  makeSteps,
  resolvePipelineFromSteps,
  type AgentCapability,
} from '@/lib/agentWorkflow';
import {
  loadExternalApiKey,
  probeExternalAgent,
  parseProtocol,
  DEFAULT_PROTOCOL,
} from '@/lib/gateway';
import ExternalAgentFields from '@/components/agents/ExternalAgentFields';
import {
  ArrowLeft, Settings, Plus, Bot, Pencil, Trash2, Check, X, Loader2,
  AlertCircle, Download, Upload, Copy, GripVertical,
} from 'lucide-react';

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const GRADIENT_PRESETS: string[] = [
  'linear-gradient(135deg, #48CAE4, #0096C7)',
  'linear-gradient(135deg, #FF6B9D, #D44D7A)',
  'linear-gradient(135deg, #52B788, #40916C)',
  'linear-gradient(135deg, #7B82E1, #5A60C0)',
  'linear-gradient(135deg, #D4AF37, #B8860B)',
  'linear-gradient(135deg, #F4A261, #E76F51)',
  'linear-gradient(135deg, #9B5DE5, #7B2CBF)',
  'linear-gradient(135deg, #00BBF9, #0077B6)',
];

const PIPELINE_OPTIONS: { id: AgentPipeline; label: string }[] = [
  { id: 'text_chat_stream', label: '流式对话（推荐）' },
  { id: 'text_chat', label: '文本对话 + TTS' },
  { id: 'voice_reply', label: '语音回复（ASR→LLM→TTS）' },
];

const KIND_OPTIONS: { id: AgentKind; label: string; hint: string }[] = [
  { id: 'local', label: '本地', hint: '绑定固定流水线' },
  { id: 'workflow', label: '工作流', hint: '自定义 ASR/LLM/TTS 步骤' },
  { id: 'external', label: '外部', hint: 'AI 网关（OpenAI 兼容 / Anthropic）' },
];

type FormState = AgentInput & { apiKey: string };

const EMPTY_FORM: FormState = {
  name: '',
  systemPrompt: '',
  description: '',
  avatar: GRADIENT_PRESETS[0],
  voiceId: '',
  kind: 'local',
  pipeline: 'text_chat_stream',
  steps: makeSteps(['llm']),
  temperature: 0.7,
  topP: 0.9,
  endpoint: '',
  externalModel: 'gpt-4o-mini',
  protocol: 'openai-compatible',
  apiKey: '',
};

type FormMode = { kind: 'create' } | { kind: 'edit'; id: string } | null;

export default function AgentsPage() {
  const setPage = useUIStore((s) => s.setPage);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const agents = useUIStore((s) => s.agents);
  const createAgent = useUIStore((s) => s.createAgent);
  const updateAgent = useUIStore((s) => s.updateAgent);
  const deleteAgent = useUIStore((s) => s.deleteAgent);
  const setCurrentAgent = useUIStore((s) => s.setCurrentAgent);
  const currentAgentId = useUIStore((s) => s.currentAgentId);
  const addToast = useToastStore((s) => s.addToast);

  const voicesQuery = useVoices();
  const voices = voicesQuery.data ?? [];

  const [formMode, setFormMode] = useState<FormMode>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [nameError, setNameError] = useState(false);
  const [promptError, setPromptError] = useState(false);
  const [endpointError, setEndpointError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [probing, setProbing] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openCreate = () => {
    setForm({ ...EMPTY_FORM, voiceId: voices[0]?.id ?? 'jyy', steps: makeSteps(['llm']) });
    setNameError(false);
    setPromptError(false);
    setEndpointError(false);
    setFormMode({ kind: 'create' });
  };

  const openEdit = (a: Agent) => {
    setForm({
      name: a.name,
      systemPrompt: a.systemPrompt,
      description: a.description,
      avatar: a.avatar,
      voiceId: a.voiceId,
      kind: a.kind,
      pipeline: a.pipeline,
      steps: a.steps?.length ? a.steps : makeSteps(['llm']),
      temperature: a.temperature,
      topP: a.topP,
      endpoint: a.endpoint ?? '',
      externalModel: a.externalModel ?? 'gpt-4o-mini',
      protocol: a.protocol ?? DEFAULT_PROTOCOL,
      apiKey: loadExternalApiKey(a.id),
    });
    setNameError(false);
    setPromptError(false);
    setEndpointError(false);
    setFormMode({ kind: 'edit', id: a.id });
  };

  const setKind = (kind: AgentKind) => {
    setForm((f) => {
      const next = { ...f, kind };
      if (kind === 'workflow' && (!f.steps || f.steps.length === 0)) {
        next.steps = makeSteps(['llm', 'tts']);
        next.pipeline = resolvePipelineFromSteps(next.steps);
      }
      if (kind === 'local') next.steps = undefined;
      return next;
    });
  };

  const applyPreset = (caps: AgentCapability[]) => {
    const steps = makeSteps(caps);
    setForm((f) => ({
      ...f,
      steps,
      pipeline: resolvePipelineFromSteps(steps),
    }));
  };

  const addStep = (cap: AgentCapability) => {
    setForm((f) => {
      const steps: AgentStep[] = [
        ...(f.steps ?? []),
        { id: `step-${Date.now()}-${cap}`, capability: cap, label: CAPABILITY_LABELS[cap] },
      ];
      return { ...f, steps, pipeline: resolvePipelineFromSteps(steps) };
    });
  };

  const removeStep = (id: string) => {
    setForm((f) => {
      const steps = (f.steps ?? []).filter((s) => s.id !== id);
      return {
        ...f,
        steps: steps.length ? steps : makeSteps(['llm']),
        pipeline: resolvePipelineFromSteps(steps.length ? steps : makeSteps(['llm'])),
      };
    });
  };

  const moveStep = (index: number, dir: -1 | 1) => {
    setForm((f) => {
      const steps = [...(f.steps ?? [])];
      const j = index + dir;
      if (j < 0 || j >= steps.length) return f;
      [steps[index], steps[j]] = [steps[j], steps[index]];
      return { ...f, steps, pipeline: resolvePipelineFromSteps(steps) };
    });
  };

  const handleProbe = async () => {
    setProbing(true);
    try {
      const result = await probeExternalAgent(form.protocol, {
        baseUrl: form.endpoint || '',
        apiKey: form.apiKey,
        model: form.externalModel,
      });
      addToast({ message: result.message, type: result.ok ? 'success' : 'error' });
    } finally {
      setProbing(false);
    }
  };

  const handleSubmit = async () => {
    const nameOk = validateName(form.name).ok;
    const promptOk = form.kind === 'external' || form.systemPrompt.trim().length > 0;
    const endpointOk = form.kind !== 'external' || (form.endpoint?.trim().length ?? 0) > 0;
    setNameError(!nameOk);
    setPromptError(!promptOk);
    setEndpointError(!endpointOk);
    if (!nameOk || !promptOk || !endpointOk) return;
    setIsSubmitting(true);
    try {
      const payload: AgentInput = {
        ...form,
        systemPrompt: form.systemPrompt || (form.kind === 'external' ? 'You are a helpful assistant.' : form.systemPrompt),
        pipeline: form.kind === 'workflow' && form.steps
          ? resolvePipelineFromSteps(form.steps)
          : form.pipeline,
        steps: form.kind === 'workflow' ? form.steps : undefined,
        endpoint: form.kind === 'external' ? form.endpoint : undefined,
        externalModel: form.kind === 'external' ? form.externalModel : undefined,
        protocol: form.kind === 'external' ? (form.protocol ?? DEFAULT_PROTOCOL) : undefined,
        apiKey: form.kind === 'external' ? form.apiKey : undefined,
      };
      if (formMode?.kind === 'create') {
        await createAgent(payload);
        addToast({ message: 'Agent 已创建', type: 'success' });
      } else if (formMode?.kind === 'edit') {
        await updateAgent(formMode.id, payload);
        addToast({ message: 'Agent 已更新', type: 'success' });
      }
      setFormMode(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExport = (a: Agent) => {
    downloadText(`${a.name}.agent.json`, JSON.stringify({
      name: a.name,
      systemPrompt: a.systemPrompt,
      description: a.description,
      avatar: a.avatar,
      voiceId: a.voiceId,
      kind: a.kind,
      pipeline: a.pipeline,
      steps: a.steps,
      temperature: a.temperature,
      topP: a.topP,
      endpoint: a.endpoint,
      externalModel: a.externalModel,
      protocol: a.protocol,
    }, null, 2));
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data.name || typeof data.systemPrompt !== 'string') {
        addToast({ message: '无效的 Agent 文件', type: 'error' });
        return;
      }
      const kind: AgentKind = data.kind === 'workflow' || data.kind === 'external' ? data.kind : 'local';
      await createAgent({
        name: String(data.name),
        systemPrompt: String(data.systemPrompt),
        description: String(data.description ?? ''),
        avatar: String(data.avatar || GRADIENT_PRESETS[0]),
        voiceId: String(data.voiceId || voices[0]?.id || 'jyy'),
        kind,
        pipeline: (['text_chat_stream', 'text_chat', 'voice_reply'] as AgentPipeline[]).includes(data.pipeline)
          ? data.pipeline
          : 'text_chat_stream',
        steps: Array.isArray(data.steps) ? data.steps : undefined,
        temperature: typeof data.temperature === 'number' ? data.temperature : 0.7,
        topP: typeof data.topP === 'number' ? data.topP : 0.9,
        endpoint: data.endpoint,
        externalModel: data.externalModel,
        protocol: parseProtocol(data.protocol),
      });
      addToast({ message: '已导入 Agent', type: 'success' });
    } catch {
      addToast({ message: '导入失败', type: 'error' });
    } finally {
      e.target.value = '';
    }
  };

  const kindBadge = (k: AgentKind) => KIND_OPTIONS.find((o) => o.id === k)?.label ?? k;

  return (
    <div className="flex flex-col h-full" style={{ zIndex: 10 }}>
      <header className="flex items-center justify-between px-6 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setPage('home')} className="flex items-center justify-center"
            style={{ width: 36, height: 36, borderRadius: 10, color: 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer' }}
            title="返回首页"><ArrowLeft size={20} /></button>
          <div>
            <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Agent</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>本地 / 工作流 / 外部智能体；对话页选用后调用</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleImportFile} />
          <button type="button" onClick={() => fileInputRef.current?.click()} className="px-3 py-1.5 rounded-lg text-sm"
            style={{ background: 'var(--surface-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border)', cursor: 'pointer' }}>
            <Upload size={14} className="inline mr-1" />导入
          </button>
          <button type="button" onClick={openCreate} className="px-3 py-1.5 rounded-lg text-sm flex items-center gap-1"
            style={{ background: 'var(--primary)', color: 'var(--bg)', border: 'none', cursor: 'pointer' }}>
            <Plus size={16} />新建
          </button>
          <button type="button" aria-label="设置" onClick={() => setSettingsOpen(true)} className="flex items-center justify-center"
            style={{ width: 36, height: 36, borderRadius: 10, color: 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
            <Settings size={20} />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid gap-3 max-w-2xl mx-auto">
          {agents.map((a) => (
            <div key={a.id} className="rounded-2xl p-4 flex gap-3"
              style={{ background: 'var(--surface)', border: `1px solid ${currentAgentId === a.id ? 'rgba(72,202,228,0.35)' : 'var(--border)'}` }}>
              <div className="w-12 h-12 rounded-xl shrink-0" style={{ background: a.avatar }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Bot size={14} style={{ color: 'var(--primary)' }} />
                  <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{a.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)' }}>{kindBadge(a.kind)}</span>
                </div>
                <p className="text-xs mt-1 truncate" style={{ color: 'var(--text-muted)' }}>{a.description || '无描述'}</p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                  {a.kind === 'workflow' && a.steps
                    ? a.steps.map((s) => s.label).join(' → ')
                    : a.kind === 'external'
                      ? `${a.protocol === 'anthropic' ? 'Anthropic · ' : ''}${a.endpoint || '未配置地址'}`
                      : (PIPELINE_OPTIONS.find((o) => o.id === a.pipeline)?.label ?? a.pipeline)}
                </p>
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <button type="button" onClick={() => { setCurrentAgent(a.id); addToast({ message: `已选用 ${a.name}`, type: 'success' }); }}
                  className="text-[11px] px-2 py-1 rounded cursor-pointer"
                  style={{ background: currentAgentId === a.id ? 'rgba(72,202,228,0.15)' : 'var(--surface-hover)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                  {currentAgentId === a.id ? '使用中' : '选用'}
                </button>
                <button type="button" onClick={() => openEdit(a)} className="p-1.5 rounded cursor-pointer" style={{ color: 'var(--text-secondary)', background: 'transparent', border: 'none' }} title="编辑"><Pencil size={14} /></button>
                <button type="button" onClick={() => handleExport(a)} className="p-1.5 rounded cursor-pointer" style={{ color: 'var(--text-secondary)', background: 'transparent', border: 'none' }} title="导出"><Download size={14} /></button>
                <button type="button" onClick={() => {
                  void createAgent({
                    name: `${a.name} 副本`,
                    systemPrompt: a.systemPrompt,
                    description: a.description,
                    avatar: a.avatar,
                    voiceId: a.voiceId,
                    kind: a.kind,
                    pipeline: a.pipeline,
                    steps: a.steps,
                    temperature: a.temperature,
                    topP: a.topP,
                    endpoint: a.endpoint,
                    externalModel: a.externalModel,
                    protocol: a.protocol,
                    apiKey: a.kind === 'external' ? loadExternalApiKey(a.id) : undefined,
                  });
                }} className="p-1.5 rounded cursor-pointer" style={{ color: 'var(--text-secondary)', background: 'transparent', border: 'none' }} title="复制"><Copy size={14} /></button>
                {confirmDeleteId === a.id ? (
                  <div className="flex gap-1">
                    <button type="button" onClick={() => { void deleteAgent(a.id); setConfirmDeleteId(null); }} className="p-1.5 rounded cursor-pointer" style={{ color: '#FF6B6B', background: 'transparent', border: 'none' }} title="确认"><Check size={14} /></button>
                    <button type="button" onClick={() => setConfirmDeleteId(null)} className="p-1.5 rounded cursor-pointer" style={{ color: 'var(--text-secondary)', background: 'transparent', border: 'none' }} title="取消"><X size={14} /></button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setConfirmDeleteId(a.id)} className="p-1.5 rounded cursor-pointer" style={{ color: 'var(--text-secondary)', background: 'transparent', border: 'none' }} title="删除"><Trash2 size={14} /></button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {formMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}>
          <div className="w-full max-w-lg rounded-2xl p-6 flex flex-col gap-3 max-h-[90vh] overflow-y-auto"
            style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              {formMode.kind === 'create' ? '新建 Agent' : '编辑 Agent'}
            </h2>

            <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>类型</label>
            <div className="flex gap-2 flex-wrap">
              {KIND_OPTIONS.map((o) => (
                <button key={o.id} type="button" onClick={() => setKind(o.id)}
                  className="px-3 py-1.5 rounded-lg text-xs cursor-pointer text-left"
                  style={{
                    background: form.kind === o.id ? 'rgba(72,202,228,0.15)' : 'var(--surface-hover)',
                    border: `1px solid ${form.kind === o.id ? 'rgba(72,202,228,0.4)' : 'var(--border)'}`,
                    color: 'var(--text-primary)',
                  }}>
                  <div className="font-medium">{o.label}</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{o.hint}</div>
                </button>
              ))}
            </div>

            <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>名称</label>
            <input value={form.name} maxLength={NAME_MAX_LENGTH} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="rounded-xl px-3 py-2 text-sm outline-none"
              style={{ background: 'var(--surface)', border: `1px solid ${nameError ? '#FF6B6B' : 'var(--border)'}`, color: 'var(--text-primary)' }} />
            {nameError && <span className="text-[11px] flex items-center gap-1" style={{ color: '#FF6B6B' }}><AlertCircle size={12} />名称不能为空</span>}

            <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>描述</label>
            <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="rounded-xl px-3 py-2 text-sm outline-none"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />

            <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>系统提示</label>
            <textarea value={form.systemPrompt} rows={4} onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))}
              className="rounded-xl px-3 py-2 text-sm outline-none resize-none"
              style={{ background: 'var(--surface)', border: `1px solid ${promptError ? '#FF6B6B' : 'var(--border)'}`, color: 'var(--text-primary)' }}
              placeholder={form.kind === 'external' ? '可选；外部模型也可在服务端配置' : ''} />
            {promptError && <span className="text-[11px] flex items-center gap-1" style={{ color: '#FF6B6B' }}><AlertCircle size={12} />系统提示不能为空</span>}

            {form.kind === 'local' && (
              <>
                <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>本地流水线</label>
                <select value={form.pipeline} onChange={(e) => setForm((f) => ({ ...f, pipeline: e.target.value as AgentPipeline }))}
                  className="rounded-xl px-3 py-2 text-sm outline-none"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                  {PIPELINE_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </>
            )}

            {form.kind === 'workflow' && (
              <>
                <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>步骤预设</label>
                <div className="flex flex-wrap gap-1.5">
                  {WORKFLOW_PRESETS.map((p) => (
                    <button key={p.id} type="button" onClick={() => applyPreset(p.steps)}
                      className="text-[11px] px-2 py-1 rounded cursor-pointer"
                      style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                      {p.name}
                    </button>
                  ))}
                </div>
                <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>步骤（可排序）</label>
                <div className="flex flex-col gap-1">
                  {(form.steps ?? []).map((s, i) => (
                    <div key={s.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5"
                      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                      <GripVertical size={14} style={{ color: 'var(--text-muted)' }} />
                      <span className="text-xs flex-1" style={{ color: 'var(--text-primary)' }}>{s.label}</span>
                      <button type="button" className="text-[10px] cursor-pointer" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)' }}
                        onClick={() => moveStep(i, -1)} disabled={i === 0}>上</button>
                      <button type="button" className="text-[10px] cursor-pointer" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)' }}
                        onClick={() => moveStep(i, 1)} disabled={i === (form.steps?.length ?? 0) - 1}>下</button>
                      <button type="button" className="p-0.5 cursor-pointer" style={{ background: 'transparent', border: 'none', color: '#FF6B6B' }}
                        onClick={() => removeStep(s.id)}><X size={12} /></button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-1">
                  {(['asr', 'llm', 'tts'] as AgentCapability[]).map((c) => (
                    <button key={c} type="button" onClick={() => addStep(c)}
                      className="text-[11px] px-2 py-1 rounded cursor-pointer"
                      style={{ background: 'rgba(72,202,228,0.1)', border: '1px solid rgba(72,202,228,0.25)', color: 'var(--primary)' }}>
                      + {CAPABILITY_LABELS[c]}
                    </button>
                  ))}
                </div>
                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  映射流水线：{PIPELINE_OPTIONS.find((o) => o.id === form.pipeline)?.label}
                </p>
              </>
            )}

            {form.kind === 'external' && (
              <ExternalAgentFields
                value={{
                  endpoint: form.endpoint ?? '',
                  externalModel: form.externalModel ?? '',
                  protocol: form.protocol ?? DEFAULT_PROTOCOL,
                  apiKey: form.apiKey,
                }}
                endpointError={endpointError}
                probing={probing}
                onPatch={(patch) => setForm((f) => ({ ...f, ...patch }))}
                onProbe={() => void handleProbe()}
              />
            )}

            {form.kind !== 'external' && (
              <>
                <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>音色</label>
                <select value={form.voiceId} onChange={(e) => setForm((f) => ({ ...f, voiceId: e.target.value }))}
                  className="rounded-xl px-3 py-2 text-sm outline-none"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                  {voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  {voices.length === 0 && <option value="jyy">jyy</option>}
                </select>
              </>
            )}

            <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>头像渐变</label>
            <div className="flex flex-wrap gap-2">
              {GRADIENT_PRESETS.map((g) => (
                <button key={g} type="button" onClick={() => setForm((f) => ({ ...f, avatar: g }))}
                  className="w-8 h-8 rounded-lg cursor-pointer"
                  style={{ background: g, border: form.avatar === g ? '2px solid var(--primary)' : '2px solid transparent' }} />
              ))}
            </div>

            <div className="flex justify-end gap-2 mt-2">
              <button type="button" onClick={() => setFormMode(null)} className="px-3 py-1.5 rounded-lg text-sm cursor-pointer"
                style={{ background: 'var(--surface-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>取消</button>
              <button type="button" onClick={() => void handleSubmit()} disabled={isSubmitting}
                className="px-3 py-1.5 rounded-lg text-sm flex items-center gap-1 cursor-pointer"
                style={{ background: 'var(--primary)', color: 'var(--bg)', border: 'none', opacity: isSubmitting ? 0.7 : 1 }}>
                {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
