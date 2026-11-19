import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock http 层：fetchDictOptions 走 get()
const getMock = vi.fn();
vi.mock('@/api/http', () => ({
  get: (...args: unknown[]) => getMock(...args),
  http: { interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } },
  post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(),
}));

import { useDict, invalidateDict, fetchDictOptions } from '@/composables/useDict';

describe('useDict 缓存（第 11 节清单项）', () => {
  beforeEach(() => {
    getMock.mockReset();
    invalidateDict(); // 清全部缓存
  });

  it('同一编码多次 useDict 只请求一次（缓存命中）', async () => {
    getMock.mockResolvedValue([{ label: '进行中', value: 'IN_PROGRESS' }]);
    const a = useDict('work_order_status');
    const b = useDict('work_order_status');
    await Promise.all([a.options.value ? Promise.resolve() : Promise.resolve()]);
    await vi.waitFor(() => expect(a.options.value.length).toBe(1));
    expect(b.options.value).toEqual(a.options.value);
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it('invalidateDict(code) 后再取会重新请求', async () => {
    getMock.mockResolvedValueOnce([{ label: '旧值', value: 'OLD' }]);
    useDict('work_order_status');
    await vi.waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    invalidateDict('work_order_status');
    getMock.mockResolvedValueOnce([{ label: '新值', value: 'NEW' }]);
    const again = useDict('work_order_status');
    await vi.waitFor(() => expect(again.options.value[0]?.value).toBe('NEW'));
    expect(getMock).toHaveBeenCalledTimes(2);
  });

  it('invalidateDict() 无参清全部缓存', () => {
    getMock.mockResolvedValue([]);
    useDict('a'); useDict('b');
    invalidateDict();
    useDict('a');
    expect(getMock).toHaveBeenCalledTimes(3);
  });

  it('fetchDictOptions 走 /dicts/code/:code/options 且 silent', () => {
    getMock.mockResolvedValue([]);
    fetchDictOptions('x');
    expect(getMock).toHaveBeenCalledWith('/dicts/code/x/options', undefined, { silent: true });
  });
});
