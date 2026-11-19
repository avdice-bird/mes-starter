import { get, post, put, patch, del } from './http';
import type { BomRow, BomDetail, BomTreeResult, PageResult } from '@mes/shared';

export const listBoms = (query: { page?: number; pageSize?: number; keyword?: string; status?: string }) =>
  get<PageResult<BomRow>>('/boms', query);

export const getBom = (id: number) => get<BomDetail>(`/boms/${id}`);

export const getBomTree = (id: number) => get<BomTreeResult>(`/boms/${id}/tree`);

export const createBom = (data: { materialId: number; version: string; effectiveFrom: string; effectiveTo?: string; remark?: string }) =>
  post<BomRow>('/boms', data);

export const updateBom = (id: number, data: { effectiveFrom?: string; effectiveTo?: string; remark?: string }) =>
  patch<BomRow>(`/boms/${id}`, data);

export const saveBomItems = (
  id: number,
  items: { childMaterialId: number; qty: number; scrapRate: number; position?: string; remark?: string }[],
) => put<BomDetail>(`/boms/${id}/items`, { items });

export const activateBom = (id: number) => post<BomRow>(`/boms/${id}/activate`);

export const deleteBom = (id: number) => del<void>(`/boms/${id}`);
