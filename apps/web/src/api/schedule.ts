import { get, post, patch, put, del, type RequestConfig } from './http';
import type {
  ProductionOrderRow, ProductionOrderDetail, WorkOrderRow, PageResult,
  ScheduleRunInput, ScheduleRunResult, ScheduleView, SplitItem,
} from '@mes/shared';

// ---- 生产订单 ----
export const listProductionOrders = (query: { page?: number; pageSize?: number; keyword?: string; status?: string }) =>
  get<PageResult<ProductionOrderRow>>('/production-orders', query);
export const getProductionOrder = (id: number) => get<ProductionOrderDetail>(`/production-orders/${id}`);
export const createProductionOrder = (data: {
  code?: string; materialId: number; qty: number; dueDate: string;
  priority?: number; source?: string; remark?: string;
}) => post<ProductionOrderRow>('/production-orders', data);
export const updateProductionOrder = (id: number, data: { qty?: number; dueDate?: string; priority?: number; remark?: string }) =>
  patch<ProductionOrderRow>(`/production-orders/${id}`, data);
export const splitProductionOrder = (id: number, splits: SplitItem[]) =>
  post<ProductionOrderDetail>(`/production-orders/${id}/split`, { splits });
export const cancelProductionOrder = (id: number) => post<ProductionOrderDetail>(`/production-orders/${id}/cancel`, {});
export const deleteProductionOrder = (id: number) => del<void>(`/production-orders/${id}`);

// ---- 工单（只读 + 状态机动作） ----
export const listWorkOrders = (query: {
  page?: number; pageSize?: number; keyword?: string; status?: string; workCenterId?: number; delayed?: string;
}) => get<PageResult<WorkOrderRow>>('/work-orders', query);
export const getWorkOrder = (id: number) => get<WorkOrderRow>(`/work-orders/${id}`);

/** 工单状态日志 */
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

/** 工单详情（含状态日志 + 后端算的 allowedActions，前端按钮显隐数据源） */
export interface WorkOrderDetail extends WorkOrderRow {
  logs: WorkOrderStatusLogRow[];
  allowedActions: string[];
}

export const getWorkOrderDetail = (id: number) => get<WorkOrderDetail>(`/work-orders/${id}/detail`);

/** 工单二维码 PNG（内容 wo:<code>）。接口要 Bearer 头，<img src> 带不了 token，必须以 blob 方式取 */
export const getWorkOrderQrcode = (id: number, size = 200) =>
  get<Blob>(`/work-orders/${id}/qrcode`, { size }, { responseType: 'blob' });

/** 状态机动作：POST /work-orders/:id/<action>，body 只放 reason */
export const transitionWorkOrder = (id: number, action: string, reason?: string) =>
  post<WorkOrderRow>(`/work-orders/${id}/${action}`, reason ? { reason } : {});

// ---- 排产 ----
export const runSchedule = (data: ScheduleRunInput) => post<ScheduleRunResult>('/schedule/run', data);
export const getScheduleView = (query?: { from?: string; to?: string }) => get<ScheduleView>('/schedule', query);
export const adjustWorkOrderPlan = (id: number, data: { plannedStart: string; plannedEnd: string; workCenterId: number }) =>
  patch<WorkOrderRow>(`/work-orders/${id}/plan`, data);

// ---- 工序任务（派工，第 34 节） ----
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
export const assignOperation = (id: number, data: { teamId?: number; employeeId?: number; equipmentId?: number }) =>
  post<WorkOrderOperationRow>(`/work-order-operations/${id}/assign`, data);
export const startOperation = (id: number) => post<WorkOrderOperationRow>(`/work-order-operations/${id}/start`, {});
export const completeOperationQty = (id: number, qty: number, defectQty = 0) =>
  post<WorkOrderOperationRow>(`/work-order-operations/${id}/complete-qty`, { qty, defectQty });

// ---- 报工（第 37 节） ----
export type { WorkOrderRow } from '@mes/shared';
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

export const getWorkOrderByCode = (code: string) => get<WorkOrderByCode>(`/work-orders/by-code/${encodeURIComponent(code)}`);
export const listWorkReports = (workOrderId: number) => get<WorkReportRow[]>(`/work-reports/work-order/${workOrderId}`);
export const createWorkReport = (data: {
  workOrderOperationId: number; employeeId: number; goodQty: number; defectQty: number;
  workMinutes?: number; idempotencyKey: string; reportedAt?: string; remark?: string;
}) => post<WorkReportRow>('/work-reports', data);
export const reverseWorkReport = (id: number, reason: string) =>
  post<WorkReportRow>(`/work-reports/${id}/reverse`, { reason });

// ---- 库存（第 41 节） ----
export interface WarehouseRow { id: number; code: string; name: string }
export interface LotRow { id: number; lotNo: string; materialId: number; material: { code: string; name: string }; qty: number; sourceType: 'PURCHASE' | 'PRODUCTION'; producedAt: string }
export interface InventoryBalanceRow {
  id: number;
  warehouseId: number; warehouse: { code: string; name: string };
  materialId: number; material: { code: string; name: string };
  lotId: number; lot: { lotNo: string; producedAt: string };
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
  id: number; code: string; workOrderId: number; status: 'DRAFT' | 'ISSUED';
  items: { id: number; materialId: number; material: { code: string; name: string }; requiredQty: number; issuedQty: number; lotId: number | null }[];
}
export const listWarehouses = (config?: RequestConfig) =>
  get<WarehouseRow[]>('/inventory/warehouses', undefined, config);
export const listBalances = (query: { warehouseId?: number; materialId?: number; page?: number; pageSize?: number }) => get<PageResult<InventoryBalanceRow>>('/inventory/balances', query);
export const listInventoryTxs = (query: { workOrderId?: number; type?: string; page?: number; pageSize?: number }) => get<PageResult<InventoryTxRow>>('/inventory/transactions', query);
export const listLots = (query?: { page?: number; pageSize?: number }) => get<PageResult<LotRow>>('/inventory/lots', query);
export const getInventoryAudit = () => get<{ balanced: boolean; checked: number; mismatches: unknown[] }>('/inventory/audit');
export const generateMaterialIssue = (workOrderId: number) => post<MaterialIssueRow>(`/inventory/material-issues/generate/${workOrderId}`, {});
export const issueMaterialIssue = (id: number) => post<MaterialIssueRow>(`/inventory/material-issues/${id}/issue`, {});
export const createReceipt = (workOrderId: number, data: { qty: number; warehouseId: number }) => post<LotRow>(`/inventory/receipts/${workOrderId}`, data);

// ---- 批次追溯（第 43 节） ----
export interface TraceNode {
  lotNo: string;
  materialCode: string;
  materialName: string;
  qty: number;
  viaWorkOrder: string | null;
  children: TraceNode[];
}
export const traceBack = (lotNo: string) => get<{ root: TraceNode }>(`/lots/${encodeURIComponent(lotNo)}/trace-back`);
export const traceForward = (lotNo: string) => get<{ root: TraceNode }>(`/lots/${encodeURIComponent(lotNo)}/trace-forward`);

// ---- 质检（第 44 节） ----
export interface DefectCodeRow { id: number; code: string; name: string; category: string; severity: 'CRITICAL' | 'MAJOR' | 'MINOR'; status: number }
export interface InspectionDefectRow { id: number; defectCodeId: number; defectCode: DefectCodeRow; qty: number; remark: string | null }
export interface InspectionRow {
  id: number; code: string; type: 'IQC' | 'IPQC' | 'FQC'; refType: 'LOT' | 'OPERATION' | 'WORK_ORDER'; refId: number;
  sampleQty: number; passQty: number; failQty: number;
  result: 'PENDING' | 'PASS' | 'FAIL' | 'CONCESSION';
  disposition: 'REWORK' | 'SCRAP' | 'CONCESSION' | null; dispositionReason: string | null;
  remark: string | null; defects: InspectionDefectRow[];
}
export const listDefectCodes = (query?: { status?: number; pageSize?: number }) => get<PageResult<DefectCodeRow>>('/defect-codes', query);
export const createDefectCode = (data: { code: string; name: string; category: string; severity: string }) => post<DefectCodeRow>('/defect-codes', data);
export const listInspections = (query?: { type?: string; result?: string; page?: number; pageSize?: number }) => get<PageResult<InspectionRow>>('/inspections', query);
export const createInspection = (data: { type: string; refType: string; refId: number; sampleQty: number; remark?: string }) => post<InspectionRow>('/inspections', data);
export const submitInspection = (id: number, data: { passQty: number; failQty: number; defects: { defectCodeId: number; qty: number; remark?: string }[]; remark?: string }) => post<InspectionRow>(`/inspections/${id}/submit`, data);
export const dispositionInspection = (id: number, data: { disposition: string; reason: string }) => post<InspectionRow>(`/inspections/${id}/disposition`, data);
export const updateDefectCode = (id: number, data: { name?: string; category?: string; severity?: string; status?: number }) =>
  put<DefectCodeRow>(`/defect-codes/${id}`, data);

// ---- 设备状态与停机（第 46 节） ----
export interface EquipmentStatusLogRow { id: number; fromStatus: string; toStatus: string; operatorName: string; reason: string | null; changedAt: string }
export interface DowntimeRow { id: number; equipmentId: number; equipment: { code: string; name: string }; reasonCode: string; startedAt: string; endedAt: string | null; durationMinutes: number | null; remark: string | null }
export interface EquipmentDailyReportRow { id: number; equipmentId: number; equipment: { code: string; name: string }; date: string; runningMinutes: number; downMinutes: number; downtimeCount: number; open: boolean }
export const changeEquipmentStatus = (id: number, data: { status: string; reason?: string }) => post<{ id: number; status: string }>(`/equipment/${id}/status`, data);
export const getEquipmentStatusLogs = (id: number) => get<EquipmentStatusLogRow[]>(`/equipment/${id}/status-logs`);
export const listDowntimes = (query?: { equipmentId?: number; page?: number; pageSize?: number }) => get<PageResult<DowntimeRow>>('/equipment/downtimes', query);
export const createDowntime = (data: { equipmentId: number; reasonCode: string; startedAt: string; endedAt?: string; remark?: string }) => post<DowntimeRow>('/equipment/downtimes', data);
export const listEquipmentReports = (query?: { equipmentId?: number; date?: string; page?: number; pageSize?: number }) => get<PageResult<EquipmentDailyReportRow>>('/equipment/daily-reports', query);
export const generateEquipmentReport = (date: string) => post<{ date: string; generated: number }>('/equipment/daily-reports/generate', { date });

// ---- 看板（第 48 节） ----
export interface BoardSummary {
  todayGoodQty: number;
  todayDefectQty: number;
  yieldRate: number | null;
  wipOrders: number;
  equipmentStatus: Record<string, number>;
  recentReports: { id: number; employeeName: string; operationName: string; goodQty: number; defectQty: number; reportedAt: string }[];
}
export const getBoardSummary = (workCenterId?: number) => get<BoardSummary>('/board/summary', { workCenterId });
