import axios, { type AxiosRequestConfig } from 'axios';
import { ElMessage } from 'element-plus';
import type { ApiResponse } from '@mes/shared';
import { useUserStore } from '@/stores/user';

/**
 * 统一 axios 实例：
 * - 自动拆包 { code, message, data }，业务代码只拿 data
 * - code ≠ 0 或网络错误时统一提示（可用 config.silent 关闭）
 * - 请求带 Bearer token；401 → 用 refresh 换新 token 后重发（并发请求只刷新一次）；
 *   refresh 失败 → 清状态跳登录页，登录后回到原页面
 */
export const http = axios.create({ baseURL: '/api', timeout: 15000 });

http.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/** 进行中的刷新请求（单飞）：并发 401 只触发一次 refresh */
let refreshing: Promise<{ accessToken: string; refreshToken: string }> | null = null;

async function doRefresh(refreshToken: string) {
  // 用原始 axios，避免走本实例的 401 拦截造成递归
  const { data } = await axios.post<ApiResponse>('/auth/refresh', { refreshToken }, { baseURL: '/api' });
  if (data.code !== 0) throw data;
  return data.data as { accessToken: string; refreshToken: string };
}

/** 清空登录态并跳登录页，记住回跳地址 */
async function forceLogin() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  const userStore = useUserStore();
  userStore.$reset();
  const { default: router } = await import('@/router');
  const current = router.currentRoute.value;
  ElMessage.error('登录已过期，请重新登录');
  await router.push({ path: '/login', query: current.path === '/login' ? current.query : { redirect: current.fullPath } });
}

async function handle401(err: any) {
  const config = err.config as (AxiosRequestConfig & { _retried?: boolean; silent?: boolean }) | undefined;
  const url = config?.url ?? '';
  // 登录/刷新/登出接口自身的 401 不重试（登录失败、refresh 无效、登出时 token 已失效）
  if (url.includes('/auth/login') || url.includes('/auth/refresh') || url.includes('/auth/logout')) {
    const body = err.response?.data as ApiResponse | undefined;
    if (!config?.silent && !url.includes('/auth/logout')) ElMessage.error(body?.message || '登录已过期');
    throw body ?? err;
  }
  const userStore = useUserStore();
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken || config?._retried) {
    await forceLogin();
    throw { code: 1001, message: '登录已过期' };
  }
  try {
    refreshing ??= doRefresh(refreshToken).finally(() => { refreshing = null; });
    const tokens = await refreshing;
    userStore.setTokens(tokens.accessToken, tokens.refreshToken);
    // 重发原请求
    config!.headers = { ...config!.headers, Authorization: `Bearer ${tokens.accessToken}` };
    config!._retried = true;
    return await http.request(config!);
  } catch {
    await forceLogin();
    throw { code: 1001, message: '登录已过期' };
  }
}

http.interceptors.response.use(
  (res) => {
    const body = res.data as ApiResponse;
    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code === 0) return body.data as any;
      if (!(res.config as any).silent) ElMessage.error(body.message || '请求失败');
      return Promise.reject(body);
    }
    return res.data; // 文件下载等非统一结构
  },
  (err) => {
    if (err.response?.status === 401) return handle401(err);
    const body: ApiResponse | undefined = err.response?.data;
    const msg = body?.message || (err.code === 'ECONNABORTED' ? '请求超时' : '网络错误');
    if (!(err.config as any)?.silent) ElMessage.error(msg);
    return Promise.reject(body ?? err);
  },
);

export interface RequestConfig extends AxiosRequestConfig { silent?: boolean }
export const get = <T>(url: string, params?: any, config?: RequestConfig) => http.get<any, T>(url, { params, ...config });
export const post = <T>(url: string, data?: any, config?: RequestConfig) => http.post<any, T>(url, data, config);
export const put = <T>(url: string, data?: any, config?: RequestConfig) => http.put<any, T>(url, data, config);
export const patch = <T>(url: string, data?: any, config?: RequestConfig) => http.patch<any, T>(url, data, config);
export const del = <T>(url: string, config?: RequestConfig) => http.delete<any, T>(url, config);
