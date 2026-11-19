import { describe, it, expect, vi } from 'vitest';
vi.mock('element-plus', () => ({ ElMessage: { error: vi.fn() } }));
import { http } from '@/api/http';

describe('http 响应拦截器', () => {
  const fulfilled = (http.interceptors.response as any).handlers[0].fulfilled;

  it('code=0 时应只返回 data', () => {
    expect(fulfilled({ data: { code: 0, message: 'ok', data: { a: 1 } }, config: {} })).toEqual({ a: 1 });
  });

  it('code≠0 时应 reject 并携带 message', async () => {
    await expect(fulfilled({ data: { code: 1003, message: '无权限', data: null }, config: {} })).rejects.toMatchObject({ code: 1003 });
  });
});
