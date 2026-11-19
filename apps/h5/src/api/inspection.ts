import { get, post } from './http';
import type { PageResult } from '@mes/shared';

export interface DefectCodeRow {
  id: number;
  code: string;
  name: string;
  category: string;
  severity: 'CRITICAL' | 'MAJOR' | 'MINOR';
  status: number;
}

export interface InspectionDefectRow {
  id: number;
  defectCodeId: number;
  defectCode: DefectCodeRow;
  qty: number;
  remark: string | null;
}

export interface InspectionRow {
  id: number;
  code: string;
  type: 'IQC' | 'IPQC' | 'FQC';
  refType: 'LOT' | 'OPERATION' | 'WORK_ORDER';
  refId: number;
  sampleQty: number;
  passQty: number;
  failQty: number;
  result: 'PENDING' | 'PASS' | 'FAIL' | 'CONCESSION';
  disposition: 'REWORK' | 'SCRAP' | 'CONCESSION' | null;
  dispositionReason: string | null;
  remark: string | null;
  defects: InspectionDefectRow[];
}

export const listInspections = (query?: {
  type?: string;
  result?: string;
  page?: number;
  pageSize?: number;
}) => get<PageResult<InspectionRow>>('/inspections', query);

export const createInspection = (data: {
  type: string;
  refType: string;
  refId: number;
  sampleQty: number;
  remark?: string;
}) => post<InspectionRow>('/inspections', data);

export const submitInspection = (
  id: number,
  data: {
    passQty: number;
    failQty: number;
    defects: { defectCodeId: number; qty: number; remark?: string }[];
    remark?: string;
  },
) => post<InspectionRow>(`/inspections/${id}/submit`, data);

export const dispositionInspection = (id: number, data: { disposition: string; reason: string }) =>
  post<InspectionRow>(`/inspections/${id}/disposition`, data);

export const listDefectCodes = (query?: { status?: number; pageSize?: number }) =>
  get<PageResult<DefectCodeRow>>('/defect-codes', query);
