import { get } from './http';

/** 报表（第 53 节）：进度/良率/OEE。日期均为工厂时区 yyyy-MM-dd。 */

export interface WorkOrderProgressRow {
  id: number;
  code: string;
  status: string;
  workCenterName: string | null;
  plannedQty: number;
  completedQty: number;
  progressPct: number;
  plannedStart: string | null;
  plannedEnd: string | null;
  dueDate: string | null;
  delayed: boolean;
}

export interface YieldRow {
  key: string;
  label: string;
  goodQty: number;
  defectQty: number;
  yieldRate: number | null;
}

export interface DefectTopRow {
  defectCode: string;
  defectName: string;
  qty: number;
}

export interface OeeRow {
  equipmentId: number;
  equipmentCode: string;
  equipmentName: string;
  plannedMinutes: number;
  downtimeMinutes: number;
  runningMinutes: number;
  availability: number | null;
  performance: number | null;
  yieldRate: number | null;
  oee: number | null;
  goodQty: number;
  totalQty: number;
}

export interface ReportRangeQuery {
  from?: string;
  to?: string;
  workCenterId?: number;
}

export const getWorkOrderProgress = (q: ReportRangeQuery & { status?: string }) =>
  get<WorkOrderProgressRow[]>('/reports/work-order-progress', q);

export const getYieldReport = (q: ReportRangeQuery & { groupBy?: string }) =>
  get<YieldRow[]>('/reports/yield', q);

export const getDefectTop = (q: { from?: string; to?: string; top?: number }) =>
  get<DefectTopRow[]>('/reports/yield/defect-top', q);

export const getOeeReport = (q: ReportRangeQuery & { equipmentId?: number }) =>
  get<OeeRow[]>('/reports/oee', q);

/** 设备下拉（报表页用；无 equipment:view 权限时返回空，调用方静默） */
export const listEquipmentsForReport = async (): Promise<{ id: number; name: string }[]> => {
  try {
    const { listEquipments } = await import('./routing');
    return (await listEquipments({ pageSize: 100 })).list.map((e) => ({ id: e.id, name: e.name }));
  } catch {
    return [];
  }
};

/** 导出：走 blob（http.ts 的 get 会拆 JSON，这里单独用原始实例） */
import axios from 'axios';
export const exportReport = async (path: string, query: Record<string, unknown>, filename: string) => {
  const token = localStorage.getItem('accessToken');
  const res = await axios.get(`/api${path}`, {
    params: { ...query, export: 'xlsx' },
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    responseType: 'blob',
  });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};
