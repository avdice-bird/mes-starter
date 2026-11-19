import { get, post } from './http';
import type { PageResult } from '@mes/shared';

export interface WarehouseRow {
  id: number;
  code: string;
  name: string;
}

export interface LotRow {
  id: number;
  lotNo: string;
  materialId: number;
  material: { code: string; name: string };
  qty: number;
  sourceType: 'PURCHASE' | 'PRODUCTION';
  producedAt: string;
}

export interface InventoryBalanceRow {
  id: number;
  warehouseId: number;
  warehouse: { code: string; name: string };
  materialId: number;
  material: { code: string; name: string };
  lotId: number;
  lot: { lotNo: string; producedAt: string };
  qty: number;
}

export interface InventoryTxRow {
  id: number;
  type: 'ISSUE' | 'RETURN' | 'RECEIPT' | 'ADJUST' | 'INIT';
  warehouse: { code: string; name: string };
  material: { code: string; name: string };
  lot: { lotNo: string };
  qty: number;
  workOrderId: number | null;
  operatorName: string;
  remark: string | null;
  createdAt: string;
}

export interface MaterialIssueRow {
  id: number;
  code: string;
  workOrderId: number;
  status: 'DRAFT' | 'ISSUED';
  items: {
    id: number;
    materialId: number;
    material: { code: string; name: string };
    requiredQty: number;
    issuedQty: number;
    lotId: number | null;
  }[];
}

export const listWarehouses = () => get<WarehouseRow[]>('/inventory/warehouses');

export const listBalances = (query: { warehouseId?: number; materialId?: number; keyword?: string; page?: number; pageSize?: number }) =>
  get<PageResult<InventoryBalanceRow>>('/inventory/balances', query);

export const listInventoryTxs = (query: {
  workOrderId?: number;
  type?: string;
  warehouseId?: number;
  page?: number;
  pageSize?: number;
}) => get<PageResult<InventoryTxRow>>('/inventory/transactions', query);

export const listLots = (query?: { page?: number; pageSize?: number }) =>
  get<PageResult<LotRow>>('/inventory/lots', query);

export const listMaterialIssues = (query: { workOrderId?: number; page?: number; pageSize?: number }) =>
  get<PageResult<MaterialIssueRow>>('/inventory/material-issues', query);

export const issueMaterialIssue = (id: number) =>
  post<MaterialIssueRow>(`/inventory/material-issues/${id}/issue`, {});
