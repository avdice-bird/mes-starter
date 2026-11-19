import axios, { type AxiosRequestConfig } from 'axios';
import type { ApiResponse } from '@mes/shared';
import { useUserStore } from '@/stores/user';
import { showDialog, showToast } from '@/utils/toast';

/**
 * 移动端统一 axios 实例（与 apps/web 同契约）：
 * - 自动拆包 { code, message, data }
 * - code ≠ 0 / 网络错误用 Vant Toast 统一提示（config.silent 可关闭）
 * - 401 → refresh 换新 token 后重发，并发只刷新一次；失败清状态回登录页
 */
export const http = axios.create({ baseURL: '/api', timeout: 15000 });

http.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing: Promise<{ accessToken: string; refreshToken: string }> | null = null;

async function doRefresh(refreshToken: string) {
  const { data } = await axios.post<ApiResponse>('/auth/refresh', { refreshToken }, { baseURL: '/api' });
  if (data.code !== 0) throw data;
  return data.data as { accessToken: string; refreshToken: string };
}

let redirecting = false;

async function forceLogin() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  useUserStore().$reset();
  const { default: router } = await import('@/router');
  const current = router.currentRoute.value;
  if (redirecting) return;
  redirecting = true;
  showToast('登录已过期，请重新登录');
  await router.push({
    path: '/login',
    query: current.path === '/login' ? current.query : { redirect: current.fullPath },
  });
  redirecting = false;
}

async function handle401(err: any) {
  const config = err.config as (AxiosRequestConfig & { _retried?: boolean; silent?: boolean }) | undefined;
  const url = config?.url ?? '';
  // 登录/刷新/登出接口自身的 401 不重试（登录失败、refresh 无效、登出时 token 已失效）
  if (url.includes('/auth/login') || url.includes('/auth/refresh') || url.includes('/auth/logout')) {
    const body = err.response?.data as ApiResponse | undefined;
    if (!config?.silent && !url.includes('/auth/logout')) showToast(body?.message || '登录已过期');
    throw body ?? err;
  }
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken || config?._retried) {
    await forceLogin();
    throw { code: 1002, message: '登录已过期' };
  }
  try {
    refreshing ??= doRefresh(refreshToken).finally(() => {
      refreshing = null;
    });
    const tokens = await refreshing;
    useUserStore().setTokens(tokens.accessToken, tokens.refreshToken);
    config!.headers = { ...config!.headers, Authorization: `Bearer ${tokens.accessToken}` };
    config!._retried = true;
    return await http.request(config!);
  } catch {
    await forceLogin();
    throw { code: 1002, message: '登录已过期' };
  }
}

http.interceptors.response.use(
  (res) => {
    const body = res.data as ApiResponse;
    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code === 0) return body.data as any;
      if (!(res.config as any).silent) showToast(body.message || '请求失败');
      return Promise.reject(body);
    }
    return res.data;
  },
  (err) => {
    if (err.response?.status === 401) return handle401(err);
    const body: ApiResponse | undefined = err.response?.data;
    const msg = body?.message || (err.code === 'ECONNABORTED' ? '请求超时，请重试' : '网络异常，请检查网络');
    if (!(err.config as any)?.silent) showToast(msg);
    return Promise.reject(body ?? err);
  },
);

/** 业务确认框（危险操作前二次确认） */
export function confirmAction(message: string, title = '请确认'): Promise<boolean> {
  return showDialog({ title, message, showCancelButton: true })
    .then(() => true)
    .catch(() => false);
}

export interface RequestConfig extends AxiosRequestConfig {
  silent?: boolean;
}
export const get = <T>(url: string, params?: any, config?: RequestConfig) =>
  http.get<any, T>(url, { params, ...config });
export const post = <T>(url: string, data?: any, config?: RequestConfig) =>
  http.post<any, T>(url, data, config);
export const patch = <T>(url: string, data?: any, config?: RequestConfig) =>
  http.patch<any, T>(url, data, config);
export const put = <T>(url: string, data?: any, config?: RequestConfig) =>
  http.put<any, T>(url, data, config);
export const del = <T>(url: string, config?: RequestConfig) => http.delete<any, T>(url, config);
