// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

import axios from 'axios';
import { joinApiUrl, normalizeApiBaseUrl } from '@/lib/apiBase';

const isDev = typeof window !== 'undefined' && window.location?.hostname === 'localhost';

/** Optional API key from Vite env — must match backend `NUWA_API_KEY` when set. */
export const nuwaApiKey =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_NUWA_API_KEY) || '';

/** Headers to attach on raw `fetch` calls that bypass axios. */
export function apiAuthHeaders(): Record<string, string> {
  return nuwaApiKey ? { 'X-Api-Key': nuwaApiKey } : {};
}

function genRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function resolveTimeoutMs(): number {
  const raw = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_API_TIMEOUT_MS : undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 30_000;
}

/** Current API origin from settings (`''` = same-origin / Vite proxy). */
let apiBaseUrl = '';

/** Apply settings.backendUrl to axios + apiUrl() helpers. */
export function setApiBaseUrl(url: string): void {
  apiBaseUrl = normalizeApiBaseUrl(url);
  apiClient.defaults.baseURL = apiBaseUrl;
}

export function getApiBaseUrl(): string {
  return apiBaseUrl;
}

/**
 * Build a URL for `/api/...` paths used by EventSource, audio elements, and raw fetch.
 * Empty base keeps relative paths (dev proxy / same-origin deploy).
 */
export function apiUrl(path: string): string {
  return joinApiUrl(apiBaseUrl, path);
}

export const apiClient = axios.create({
  baseURL: '',
  timeout: resolveTimeoutMs(),
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: attach correlation ID + optional API key + start timer
apiClient.interceptors.request.use(
  (config) => {
    (config as any).__startTime = Date.now();
    config.headers.set('X-Request-Id', genRequestId());
    if (nuwaApiKey) {
      config.headers.set('X-Api-Key', nuwaApiKey);
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// Response interceptor: dev logging + retry on 5xx
apiClient.interceptors.response.use(
  (response) => {
    if (isDev) {
      const duration = Date.now() - ((response.config as any).__startTime || 0);
      console.debug(
        `[API] ${response.config.method?.toUpperCase()} ${response.config.url} — ${response.status} (${duration}ms)`,
      );
    }
    return response;
  },
  async (error) => {
    const config = error.config;
    if (isDev && config) {
      const duration = Date.now() - ((config as any).__startTime || 0);
      console.debug(
        `[API] ${config.method?.toUpperCase()} ${config.url} — ${error.response?.status || 'ERR'} (${duration}ms)`,
      );
    }

    // Retry once on 5xx with exponential backoff, only for idempotent methods
    const retryCount = (config as any).__retryCount || 0;
    if (retryCount < 1 && error.response?.status >= 500 && ['get', 'head', 'options'].includes(config.method?.toLowerCase())) {
      (config as any).__retryCount = retryCount + 1;
      await new Promise((r) => setTimeout(r, 1000));
      return apiClient.request(config);
    }

    console.error('API Error:', error.message, error.response?.status, error.config?.url);
    return Promise.reject(error);
  },
);
