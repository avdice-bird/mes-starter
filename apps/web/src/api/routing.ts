import { get, post, patch, del, put } from './http';
import type { WorkCenterRow, EquipmentRow, RoutingRow, RoutingOperationRow, PageResult } from '@mes/shared';

// ---- 工作中心 ----
export const listWorkCenters = (query: { page?: number; pageSize?: number; keyword?: string }) =>
  get<PageResult<WorkCenterRow>>('/work-centers', query);
export const createWorkCenter = (data: { code: string; name: string; type?: string; dailyCapacity?: number }) =>
  post<WorkCenterRow>('/work-centers', data);
export const updateWorkCenter = (id: number, data: { name?: string; type?: string; dailyCapacity?: number; status?: number }) =>
  patch<WorkCenterRow>(`/work-centers/${id}`, data);
export const deleteWorkCenter = (id: number) => del<void>(`/work-centers/${id}`);

// ---- 设备 ----
export const listEquipments = (query: { page?: number; pageSize?: number; keyword?: string; workCenterId?: number }) =>
  get<PageResult<EquipmentRow>>('/equipments', query);
export const createEquipment = (data: { code: string; name: string; workCenterId: number; model?: string }) =>
  post<EquipmentRow>('/equipments', data);
export const updateEquipment = (id: number, data: { name?: string; workCenterId?: number; model?: string; status?: string }) =>
  patch<EquipmentRow>(`/equipments/${id}`, data);
export const deleteEquipment = (id: number) => del<void>(`/equipments/${id}`);

// ---- 工艺路线 ----
export const listRoutings = (query: { page?: number; pageSize?: number; keyword?: string; status?: string }) =>
  get<PageResult<RoutingRow>>('/routings', query);
export const getRouting = (id: number) => get<RoutingRow & { operations: RoutingOperationRow[] }>(`/routings/${id}`);
export const createRouting = (data: { materialId: number; version: string; remark?: string }) =>
  post<RoutingRow>('/routings', data);
export const saveOperations = (id: number, operations: { seq: number; code: string; name: string; workCenterId: number; standardMinutes: number; isInspectionPoint?: boolean; allowSkip?: boolean }[]) =>
  put(`/routings/${id}/operations`, { operations });
export const reorderOperations = (id: number, orderedIds: number[]) => put(`/routings/${id}/reorder`, { orderedIds });
export const activateRouting = (id: number) => post<RoutingRow>(`/routings/${id}/activate`);
export const copyRouting = (id: number, version: string) => post<RoutingRow>(`/routings/${id}/copy`, { version });
export const deleteRouting = (id: number) => del<void>(`/routings/${id}`);
