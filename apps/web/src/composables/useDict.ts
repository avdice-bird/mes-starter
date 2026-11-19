import { ref } from 'vue';
import { get } from '@/api/http';
import type { DictOption } from '@mes/shared';

/**
 * useDict('work_order_status')：按字典编码取下拉选项，供各页面取下拉。
 * - 模块级缓存：同一编码只请求一次；
 * - invalidateDict(code?) 手动失效：字典项维护后调用（第 11 节清单项）。
 */
const cache = new Map<string, Promise<DictOption[]>>();

/** 后端公开的"启用字典项"接口：/api/dicts/code/:code/options */
export function fetchDictOptions(code: string): Promise<DictOption[]> {
  return get<DictOption[]>(`/dicts/code/${code}/options`, undefined, { silent: true });
}

export function useDict(code: string) {
  if (!cache.has(code)) {
    cache.set(code, fetchDictOptions(code));
  }
  const options = ref<DictOption[]>([]);
  cache.get(code)!.then((v) => (options.value = v)).catch(() => cache.delete(code));
  return { options };
}

/** 字典项被维护后使缓存失效（不传 code 清全部） */
export function invalidateDict(code?: string) {
  if (code) cache.delete(code);
  else cache.clear();
}
