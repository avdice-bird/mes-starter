import { get, post, patch, del } from './http';
import type { CategoryNode } from '@mes/shared';

export const categoryTree = () => get<CategoryNode[]>('/material-categories');

export const createCategory = (data: { parentId?: number | null; code: string; name: string }) =>
  post<CategoryNode>('/material-categories', data);

export const updateCategory = (id: number, data: { parentId?: number | null; name?: string }) =>
  patch<CategoryNode>(`/material-categories/${id}`, data);

export const deleteCategory = (id: number) => del<void>(`/material-categories/${id}`);
