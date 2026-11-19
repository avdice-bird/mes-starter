import { get, post, patch, del } from './http';
import type { PageResult, UnitRow, UnitOption } from '@mes/shared';

export const listUnits = (query: { page?: number; pageSize?: number; keyword?: string }) =>
  get<PageResult<UnitRow>>('/units', query);

export const unitOptions = () => get<UnitOption[]>('/units/options');

export const createUnit = (data: { code: string; name: string; status?: number }) => post<UnitRow>('/units', data);

export const updateUnit = (id: number, data: { name?: string; status?: number }) => patch<UnitRow>(`/units/${id}`, data);

export const deleteUnit = (id: number) => del<void>(`/units/${id}`);
