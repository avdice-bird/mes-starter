import { get, post, patch, put, del } from './http';
import type { PageQuery, PageResult, UserRow } from '@mes/shared';

export interface QueryUser extends PageQuery { keyword?: string }

export interface CreateUserData { username: string; password: string; name: string }
export interface UpdateUserData { name?: string; password?: string; status?: number }

export const listUsers = (query?: QueryUser) => get<PageResult<UserRow>>('/users', query);
export const getUser = (id: number) => get<UserRow>(`/users/${id}`);
export const createUser = (data: CreateUserData) => post<UserRow>('/users', data);
export const updateUser = (id: number, data: UpdateUserData) => patch<UserRow>(`/users/${id}`, data);
export const deleteUser = (id: number) => del<void>(`/users/${id}`);
export const assignUserRoles = (id: number, roleIds: number[]) => put<UserRow>(`/users/${id}/roles`, { roleIds });
