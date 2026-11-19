import { get } from './http';
import type { DictOption } from '@mes/shared';

/** 按字典编码取启用项（登录即可，不要求 dict:view） */
export const getDictOptions = (code: string) =>
  get<DictOption[]>(`/dicts/code/${encodeURIComponent(code)}/options`);
