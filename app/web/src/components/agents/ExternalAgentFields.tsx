// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * 外部 Agent 配置区（AgentsPage 表单子组件）。
 * 提供商预设一键填充 + 协议选择 + Base URL / 模型 / 密钥 + 连通性探测。
 */

import { Loader2, AlertCircle } from 'lucide-react';
import type { ExternalProtocol } from '@/store/types';
import {
  PROTOCOL_OPTIONS,
  PROVIDER_PRESETS,
  DEFAULT_PROTOCOL,
  XAI_OAUTH_ENDPOINT,
  CLAUDE_CODE_ENDPOINT,
  CURSOR_SDK_ENDPOINT,
  isLocalProxyProtocol,
  isCodingProtocol,
  parseCwdFromEndpoint,
  parsePermissionModeFromEndpoint,
  buildCodingEndpoint,
  type CodingPermissionMode,
} from '@/lib/gateway';

function placeholderFor(protocol: ExternalProtocol): { baseUrl: string; model: string } {
  const preset =
    PROVIDER_PRESETS.find((p) => p.protocol === protocol && p.defaultModel)
    ?? PROVIDER_PRESETS.find((p) => p.protocol === protocol);
  return {
    baseUrl: preset?.baseUrl ?? '',
    model: preset?.defaultModel ?? '',
  };
}

function sentinelFor(protocol: ExternalProtocol): string {
  if (protocol === 'xai-oauth') return XAI_OAUTH_ENDPOINT;
  if (protocol === 'claude-code') return CLAUDE_CODE_ENDPOINT;
  if (protocol === 'cursor-sdk') return CURSOR_SDK_ENDPOINT;
  return '';
}

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
  const placeholder = placeholderFor(protocol);
  const localProxy = isLocalProxyProtocol(protocol);
  const coding = isCodingProtocol(protocol);
  const codingCwd = parseCwdFromEndpoint(value.endpoint) ?? '';
  const codingPermission: CodingPermissionMode =
    parsePermissionModeFromEndpoint(value.endpoint) ?? 'acceptEdits';

  return (
    <>
      <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>提供商预设</label>
      <div className="flex flex-wrap gap-1.5">
        {PROVIDER_PRESETS.map((p) => (
          <button key={p.id} type="button"
            onClick={() => onPatch({
              protocol: p.protocol,
              endpoint: isLocalProxyProtocol(p.protocol) ? (sentinelFor(p.protocol) || p.baseUrl) : p.baseUrl,
              externalModel: p.defaultModel,
            })}
            className="text-[11px] px-2 py-1 rounded cursor-pointer"
            style={{ background: 'var(--surface-hover)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            {p.label}
          </button>
        ))}
      </div>

      <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>接入协议</label>
      <select
        value={protocol}
        onChange={(e) => {
          const next = e.target.value as ExternalProtocol;
          onPatch({
            protocol: next,
            endpoint: isLocalProxyProtocol(next) ? sentinelFor(next) : value.endpoint,
          });
        }}
        className="rounded-xl px-3 py-2 text-sm outline-none"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
        {PROTOCOL_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
        {PROTOCOL_OPTIONS.find((o) => o.id === protocol)?.hint}
      </p>

      {protocol === 'xai-oauth' && (
        <p className="text-[11px] rounded-xl px-3 py-2" style={{ background: 'rgba(72,202,228,0.06)', border: '1px solid rgba(72,202,228,0.15)', color: 'var(--text-secondary)' }}>
          无需 API Key。请先在「设置 → SuperGrok 账号」导入 Grok Build 或完成设备码登录。
        </p>
      )}
      {protocol === 'claude-code' && (
        <p className="text-[11px] rounded-xl px-3 py-2" style={{ background: 'rgba(72,202,228,0.06)', border: '1px solid rgba(72,202,228,0.15)', color: 'var(--text-secondary)' }}>
          使用本机已安装的 Claude Code。优先复用 <code>claude</code> 登录态；可在下方指定工作目录与权限模式。
        </p>
      )}
      {protocol === 'cursor-sdk' && (
        <p className="text-[11px] rounded-xl px-3 py-2" style={{ background: 'rgba(72,202,228,0.06)', border: '1px solid rgba(72,202,228,0.15)', color: 'var(--text-secondary)' }}>
          需安装 Cursor Agent CLI，并用 <code>agent login</code> 或 Dashboard 订阅 Key 鉴权（均走套餐额度，非独立 API 账单）。工作目录默认项目根。
        </p>
      )}

      {coding && (
        <>
          <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>工作目录（cwd）</label>
          <input
            value={codingCwd}
            onChange={(e) => onPatch({
              endpoint: buildCodingEndpoint(
                value.endpoint || sentinelFor(protocol),
                { cwd: e.target.value },
              ),
            })}
            placeholder="空则使用 Nuwa 项目根 / NUWA_CODING_CWD"
            className="rounded-xl px-3 py-2 text-sm outline-none font-mono"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          />
          <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>权限模式</label>
          <select
            value={codingPermission}
            onChange={(e) => onPatch({
              endpoint: buildCodingEndpoint(
                value.endpoint || sentinelFor(protocol),
                { permissionMode: e.target.value },
              ),
            })}
            className="rounded-xl px-3 py-2 text-sm outline-none"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          >
            <option value="acceptEdits">acceptEdits（可改文件，推荐）</option>
            <option value="default">default（按需询问）</option>
            <option value="plan">plan（规划 / 偏只读）</option>
            <option value="dontAsk">dontAsk（拒绝需确认的工具）</option>
            <option value="auto">auto</option>
            <option value="bypassPermissions">bypassPermissions（危险）</option>
          </select>
        </>
      )}

      {!localProxy && (
        <>
          <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>Base URL</label>
          <input value={value.endpoint} onChange={(e) => onPatch({ endpoint: e.target.value })}
            placeholder={placeholder.baseUrl}
            className="rounded-xl px-3 py-2 text-sm outline-none"
            style={{ background: 'var(--surface)', border: `1px solid ${endpointError ? '#FF6B6B' : 'var(--border)'}`, color: 'var(--text-primary)' }} />
          {endpointError && <span className="text-[11px] flex items-center gap-1" style={{ color: '#FF6B6B' }}><AlertCircle size={12} />请填写地址</span>}

          <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>API Key（仅存本机）</label>
          <input type="password" value={value.apiKey} onChange={(e) => onPatch({ apiKey: e.target.value })}
            autoComplete="off"
            className="rounded-xl px-3 py-2 text-sm outline-none"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
        </>
      )}

      <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        模型 ID{localProxy ? '（可选，空则用 CLI 默认）' : ''}
      </label>
      <input value={value.externalModel} onChange={(e) => onPatch({ externalModel: e.target.value })}
        placeholder={placeholder.model || (protocol === 'xai-oauth' ? 'grok-build-0.1' : '')}
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
