import { get } from './http';

/** 标签与附件（第 55 节） */

export interface LabelData {
  type: string;
  qr: string;
  code: string;
  name: string;
  spec: string | null;
  qtyLabel: string;
  qty: string | number;
  date: string;
}

export interface AttachmentRow {
  id: number;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  createdAt: string;
}

export const getLabel = (kind: 'material' | 'work-order' | 'lot', id: number | string) =>
  get<LabelData>(`/labels/${kind === 'lot' ? 'lot' : kind}/${id}`);

export const getLabelBatch = (kind: 'material' | 'work-order' | 'lot', ids: (number | string)[]) =>
  get<LabelData[]>(`/labels/batch?kind=${kind}&ids=${ids.join(',')}`);

export const listAttachments = (refType: string, refId: number | string) =>
  get<AttachmentRow[]>('/attachments', { refType, refId });

/** 上传 multipart（http.ts 是 JSON 拆包，这里直用 axios） */
import axios from 'axios';
export const uploadAttachment = async (file: File, refType: string, refId: number | string) => {
  const form = new FormData();
  form.append('file', file);
  const token = localStorage.getItem('accessToken');
  const res = await axios.post('/api/attachments', form, {
    params: { refType, refId },
    headers: { 'Content-Type': 'multipart/form-data', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  return res.data.data as { id: number; fileName: string; size: number };
};

export const attachmentDownloadUrl = (id: number) => `/api/attachments/${id}/download`;

// ---- 打印页候选列表（轻量取数，权限不足返回空由调用方静默） ----
export const listLotsForLabels = async (): Promise<{ value: string; label: string }[]> => {
  try {
    const { listLots } = await import('./schedule');
    const r = await listLots({ pageSize: 100 });
    return r.list.map((l) => ({ value: l.lotNo, label: `${l.lotNo}（${l.material.name}）` }));
  } catch { return []; }
};
export const listWorkOrdersForLabels = async (): Promise<{ value: number; label: string }[]> => {
  try {
    const { listWorkOrders } = await import('./schedule');
    const r = await listWorkOrders({ pageSize: 100 });
    return r.list.map((w) => ({ value: w.id, label: `${w.code}（计划 ${w.qty}）` }));
  } catch { return []; }
};
export const listMaterialsForLabels = async (): Promise<{ value: number; label: string }[]> => {
  try {
    const { listMaterials } = await import('./material');
    const r = await listMaterials({ pageSize: 100 });
    return r.list.map((m) => ({ value: m.id, label: `${m.code} ${m.name}` }));
  } catch { return []; }
};
