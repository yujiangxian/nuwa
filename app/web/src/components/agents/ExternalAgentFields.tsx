// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * 外部 Agent 配置区（AgentsPage 表单子组件）。
 * 提供商预设一键填充 + 协议选择 + Base URL / 模型 / 密钥 + 连通性探测。
 */

import { Loader2, AlertCircle } from 'lucide-react';
import type { ExternalProtocol } from '@/store/types';
import { PROTOCOL_OPTIONS, PROVIDER_PRESETS, DEFAULT_PROTOCOL } from '@/lib/gateway';

const PLACEHOLDERS: Record<ExternalProtocol, { baseUrl: string; model: string }> = {
  'openai-compatible': { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-6' },
};

export interface ExternalFieldsValue {
  endpoint: string;
  externalModel: string;
  protocol: ExternalProtocol;
  apiKey: string;
}

interface ExternalAgentFieldsProps {
  value: ExternalFieldsValue;
  endpointError: boolean;
  probing: boolean;
  onPatch: (patch: Partial<ExternalFieldsValue>) => void;
  onProbe: () => void;
}

export default function ExternalAgentFields({
  value, endpointError, probing, onPatch, onProbe,
}: ExternalAgentFieldsProps) {
  const protocol = value.protocol ?? DEFAULT_PROTOCOL;
  const placeholder = PLACEHOLDERS[protocol];

  return (
    <>
      <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>提供商预设</label>
      <div className="flex flex-wrap gap-1.5">
        {PROVIDER_PRESETS.map((p) => (
          <button key={p.id} type="button"
            onClick={() => onPatch({ protocol: p.protocol, endpoint: p.baseUrl, externalModel: p.defaultModel })}
            className="text-[11px] px-2 py-1 rounded cursor-pointer"
            style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            {p.label}
          </button>
        ))}
      </div>

      <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>接入协议</label>
      <select value={protocol} onChange={(e) => onPatch({ protocol: e.target.value as ExternalProtocol })}
        className="rounded-xl px-3 py-2 text-sm outline-none"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
        {PROTOCOL_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
        {PROTOCOL_OPTIONS.find((o) => o.id === protocol)?.hint}
      </p>

      <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>Base URL</label>
      <input value={value.endpoint} onChange={(e) => onPatch({ endpoint: e.target.value })}
        placeholder={placeholder.baseUrl}
        className="rounded-xl px-3 py-2 text-sm outline-none"
        style={{ background: 'var(--surface)', border: `1px solid ${endpointError ? '#FF6B6B' : 'var(--border)'}`, color: 'var(--text-primary)' }} />
      {endpointError && <span className="text-[11px] flex items-center gap-1" style={{ color: '#FF6B6B' }}><AlertCircle size={12} />请填写地址</span>}

      <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>模型 ID</label>
      <input value={value.externalModel} onChange={(e) => onPatch({ externalModel: e.target.value })}
        placeholder={placeholder.model}
        className="rounded-xl px-3 py-2 text-sm outline-none"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />

      <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>API Key（仅存本机）</label>
      <input type="password" value={value.apiKey} onChange={(e) => onPatch({ apiKey: e.target.value })}
        autoComplete="off"
        className="rounded-xl px-3 py-2 text-sm outline-none"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />

      <button type="button" onClick={onProbe} disabled={probing}
        className="self-start text-xs px-3 py-1.5 rounded-lg cursor-pointer flex items-center gap-1"
        style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
        {probing ? <Loader2 size={12} className="animate-spin" /> : null}
        测试连通性
      </button>
    </>
  );
}
