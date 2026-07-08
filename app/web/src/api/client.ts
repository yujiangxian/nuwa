import axios from 'axios';

const isDev = typeof window !== 'undefined' && window.location?.hostname === 'localhost';

function genRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const apiClient = axios.create({
  baseURL: '',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: attach correlation ID + start timer
apiClient.interceptors.request.use(
  (config) => {
    (config as any).__startTime = Date.now();
    config.headers.set('X-Request-Id', genRequestId());
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
