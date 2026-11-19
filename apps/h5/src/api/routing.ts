import { get } from './http';
import type { PageResult, WorkCenterRow, EquipmentRow, RoutingRow, RoutingOperationRow } from '@mes/shared';

export const listWorkCenters = (query: { page?: number; pageSize?: number; keyword?: string }) =>
  get<PageResult<WorkCenterRow>>('/work-centers', query);

export const listEquipments = (query: { page?: number; pageSize?: number; keyword?: string; workCenterId?: number }) =>
  get<PageResult<EquipmentRow>>('/equipments', query);

export const getRouting = (id: number) =>
  get<RoutingRow & { operations: RoutingOperationRow[] }>(`/routings/${id}`);
