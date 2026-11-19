import { get, post, patch, del } from './http';
import type { MenuRow } from '@mes/shared';

export interface MenuData {
  parentId?: number | null;
  path: string;
  name: string;
  icon?: string | null;
  component?: string | null;
  permissionCode?: string | null;
  sort?: number;
}

export const listMenus = () => get<MenuRow[]>('/menus');
export const createMenu = (data: MenuData) => post<MenuRow>('/menus', data);
export const updateMenu = (id: number, data: MenuData) => patch<MenuRow>(`/menus/${id}`, data);
export const deleteMenu = (id: number) => del<void>(`/menus/${id}`);
