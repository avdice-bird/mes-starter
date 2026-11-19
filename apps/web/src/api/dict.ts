import { get, post, put, patch, del } from './http';
import type { DictRow, DictDetail, DictItemRow, DictOption, PageResult } from '@mes/shared';

/** 按字典编码取启用项（登录即可，不要求 dict:view） */
export const getDictOptions = (code: string) =>
  get<DictOption[]>(`/dicts/code/${encodeURIComponent(code)}/options`);

export const listDicts = (query: { page?: number; pageSize?: number; keyword?: string }) =>
  get<PageResult<DictRow>>('/dicts', query);

export const getDict = (id: number) => get<DictDetail>(`/dicts/${id}`);

export const createDict = (data: { code: string; name: string; remark?: string }) => post<DictRow>('/dicts', data);

export const updateDict = (id: number, data: { name?: string; remark?: string }) =>
  patch<DictRow>(`/dicts/${id}`, data);

export const deleteDict = (id: number) => del<void>(`/dicts/${id}`);

export const listDictItems = (dictId: number) => get<DictItemRow[]>(`/dicts/${dictId}/items`);

export const createDictItem = (dictId: number, data: { label: string; value: string; sort?: number; status?: number }) =>
  post<DictItemRow>(`/dicts/${dictId}/items`, data);

export const updateDictItem = (itemId: number, data: { label?: string; value?: string; sort?: number; status?: number }) =>
  put<DictItemRow>(`/dicts/items/${itemId}`, data);

export const deleteDictItem = (itemId: number) => del<void>(`/dicts/items/${itemId}`);
