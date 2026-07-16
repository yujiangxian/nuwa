// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * 本机 coding Agent 哨兵 endpoint 的 query 读写：
 * `nuwa://claude-code?cwd=F:/proj&permissionMode=acceptEdits`
 */

/** 与 `claude --permission-mode` 合法取值对齐。 */
export type CodingPermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'plan'
  | 'dontAsk'
  | 'auto'
  | 'bypassPermissions';

const PERMISSION_MODES: CodingPermissionMode[] = [
  'default',
  'acceptEdits',
  'plan',
  'dontAsk',
  'auto',
  'bypassPermissions',
];

function toUrl(endpoint: string): URL | null {
  if (!endpoint?.startsWith('nuwa://')) return null;
  try {
    // nuwa://claude-code?... → http://claude-code?...（host = 协议名）
    return new URL(endpoint.replace(/^nuwa:\/\//, 'http://'));
  } catch {
    return null;
  }
}

function fromUrl(u: URL): string {
  const host = u.hostname || 'claude-code';
  const q = u.searchParams.toString();
  return q ? `nuwa://${host}?${q}` : `nuwa://${host}`;
}

/** 从哨兵 endpoint 解析 cwd。 */
export function parseCwdFromEndpoint(endpoint: string | undefined): string | undefined {
  const u = endpoint ? toUrl(endpoint) : null;
  if (!u) return undefined;
  const cwd = u.searchParams.get('cwd');
  return cwd?.trim() || undefined;
}

/** 从哨兵 endpoint 解析 permissionMode。 */
export function parsePermissionModeFromEndpoint(
  endpoint: string | undefined,
): CodingPermissionMode | undefined {
  const u = endpoint ? toUrl(endpoint) : null;
  if (!u) return undefined;
  const m = u.searchParams.get('permissionMode')?.trim();
  // 兼容旧值 ask → plan
  if (m === 'ask') return 'plan';
  if (m && (PERMISSION_MODES as string[]).includes(m)) {
    return m as CodingPermissionMode;
  }
  return undefined;
}

/**
 * 在哨兵 base 上合并 cwd / permissionMode。
 * 空字符串会删除对应 query。
 */
export function buildCodingEndpoint(
  base: string,
  patch: { cwd?: string; permissionMode?: string | null },
): string {
  const fallbackHost = base.includes('cursor') ? 'cursor-sdk' : 'claude-code';
  const u = toUrl(base.startsWith('nuwa://') ? base : `nuwa://${fallbackHost}`)
    ?? new URL(`http://${fallbackHost}`);

  if ('cwd' in patch) {
    const cwd = patch.cwd?.trim();
    if (cwd) u.searchParams.set('cwd', cwd);
    else u.searchParams.delete('cwd');
  }
  if ('permissionMode' in patch) {
    const mode = patch.permissionMode?.trim();
    if (mode) u.searchParams.set('permissionMode', mode);
    else u.searchParams.delete('permissionMode');
  }
  return fromUrl(u);
}

export function isCodingProtocol(protocol: string | undefined): boolean {
  return protocol === 'claude-code' || protocol === 'cursor-sdk';
}
