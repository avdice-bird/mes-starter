import { get, post, patch, put, del } from './http';
import type { RoleRow } from '@mes/shared';

export interface CreateRoleData { code: string; name: string; remark?: string }
export interface UpdateRoleData { name?: string; remark?: string }

export const listRoles = () => get<RoleRow[]>('/roles');
export const getRole = (id: number) => get<RoleRow>(`/roles/${id}`);
export const createRole = (data: CreateRoleData) => post<RoleRow>('/roles', data);
export const updateRole = (id: number, data: UpdateRoleData) => patch<RoleRow>(`/roles/${id}`, data);
export const deleteRole = (id: number) => del<void>(`/roles/${id}`);
export const assignRolePermissions = (id: number, permissionIds: number[]) =>
  put<RoleRow>(`/roles/${id}/permissions`, { permissionIds });
