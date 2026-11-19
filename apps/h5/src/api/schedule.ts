import { get, post, type RequestConfig } from './http';
import type {
  ProductionOrderRow,
  WorkOrderRow,
  PageResult,
  ScheduleView,
} from '@mes/shared';

// ---- 工单查询与状态机 ----
export type { WorkOrderRow } from '@mes/shared';

export const listWorkOrders = (
  query: {
    page?: number;
    pageSize?: number;
    keyword?: string;
    status?: string;
    workCenterId?: number;
    delayed?: string;
  },
  config?: RequestConfig,
) => get<PageResult<WorkOrderRow>>('/work-orders', query, config);

export const getWorkOrder = (id: number) => get<WorkOrderRow>(`/work-orders/${id}`);

export interface WorkOrderStatusLogRow {
  id: number;
  workOrderId: number;
  fromStatus: string;
  toStatus: string;
  action: string;
  operatorId: number | null;
  operatorName: string;
  reason: string | null;
  createdAt: string;
}

export interface WorkOrderDetail extends WorkOrderRow {
  logs: WorkOrderStatusLogRow[];
  allowedActions: string[];
}

export const getWorkOrderDetail = (id: number) => get<WorkOrderDetail>(`/work-orders/${id}/detail`);

export const transitionWorkOrder = (id: number, action: string, reason?: string) =>
  post<WorkOrderRow>(`/work-orders/${id}/${action}`, reason ? { reason } : {});

// ---- 生产订单（移动端只读） ----
export const listProductionOrders = (query: { page?: number; pageSize?: number; keyword?: string; status?: string }) =>
  get<PageResult<ProductionOrderRow>>('/production-orders', query);

// ---- 排产视图（移动端只读） ----
export const getScheduleView = (query?: { from?: string; to?: string }) =>
  get<ScheduleView>('/schedule', query);

// ---- 工序任务 ----
export interface WorkOrderOperationRow {
  id: number;
  workOrderId: number;
  seq: number;
  operationCode: string;
  operationName: string;
  workCenterId: number;
  workCenter: { code: string; name: string };
  standardMinutes: number;
  isInspectionPoint: boolean;
  plannedQty: number;
  completedQty: number;
  defectQty: number;
  status: 'PENDING' | 'READY' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  teamId: number | null;
  team: { code: string; name: string } | null;
  employeeId: number | null;
  employee: { code: string; name: string } | null;
  equipmentId: number | null;
  equipment: { code: string; name: string } | null;
  skipped: boolean;
  startedAt: string | null;
  completedAt: string | null;
}

export const listWorkOrderOperations = (workOrderId: number) =>
  get<WorkOrderOperationRow[]>(`/work-order-operations/work-order/${workOrderId}`);

export const startOperation = (id: number) =>
  post<WorkOrderOperationRow>(`/work-order-operations/${id}/start`, {});

export const assignOperation = (id: number, data: { teamId?: number; employeeId?: number; equipmentId?: number }) =>
  post<WorkOrderOperationRow>(`/work-order-operations/${id}/assign`, data);

// ---- 报工 ----
export interface WorkReportRow {
  id: number;
  workOrderOperationId: number;
  workOrderId: number;
  employeeId: number;
  employee: { code: string; name: string };
  teamId: number | null;
  team: { name: string } | null;
  shiftId: number | null;
  shift: { name: string } | null;
  goodQty: number;
  defectQty: number;
  workMinutes: number;
  reportedAt: string;
  idempotencyKey: string;
  reversedById: number | null;
  remark: string | null;
  operation?: { seq: number; operationName: string };
}

/** 扫码定位：工单 + 可报任务（READY/IN_PROGRESS） */
export interface WorkOrderByCode {
  workOrder: WorkOrderRow;
  operations: WorkOrderOperationRow[];
}

export const getWorkOrderByCode = (code: string) =>
  get<WorkOrderByCode>(`/work-orders/by-code/${encodeURIComponent(code)}`);

export const listWorkReports = (workOrderId: number) =>
  get<WorkReportRow[]>(`/work-reports/work-order/${workOrderId}`);

export const createWorkReport = (data: {
  workOrderOperationId: number;
  employeeId: number;
  goodQty: number;
  defectQty: number;
  workMinutes?: number;
  idempotencyKey: string;
  reportedAt?: string;
  remark?: string;
}) => post<WorkReportRow>('/work-reports', data);

export const reverseWorkReport = (id: number, reason: string) =>
  post<WorkReportRow>(`/work-reports/${id}/reverse`, { reason });
