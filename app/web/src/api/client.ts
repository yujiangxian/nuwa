import axios from 'axios';

export const apiClient = axios.create({
  baseURL: '', // 由 Vite proxy 处理 /api -> localhost:8080
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器：可在此加入 auth token
apiClient.interceptors.request.use(
  (config) => config,
  (error) => Promise.reject(error)
);

// 响应拦截器：统一错误处理
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', error.message);
    return Promise.reject(error);
  }
);
