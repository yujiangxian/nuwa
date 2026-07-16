// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * 外部 Agent 密钥存取 — 仅 localStorage，绝不进 IndexedDB / Nuwa 后端。
 */

const SECRET_PREFIX = 'nuwa_agent_secret:';

export function externalSecretKey(agentId: string): string {
  return `${SECRET_PREFIX}${agentId}`;
}

export function loadExternalApiKey(agentId: string): string {
  try {
    return localStorage.getItem(externalSecretKey(agentId)) ?? '';
  } catch {
    return '';
  }
}

export function saveExternalApiKey(agentId: string, apiKey: string): void {
  try {
    const key = externalSecretKey(agentId);
    if (!apiKey.trim()) localStorage.removeItem(key);
    else localStorage.setItem(key, apiKey.trim());
  } catch {
    /* ignore quota / private mode */
  }
}

export function deleteExternalApiKey(agentId: string): void {
  try {
    localStorage.removeItem(externalSecretKey(agentId));
  } catch {
    /* ignore */
  }
}
