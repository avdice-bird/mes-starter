import { get } from './http';
import type { AuditLogRow, PageResult } from '@mes/shared';

export interface QueryAudit {
  page?: number;
  pageSize?: number;
  userId?: number;
  module?: string;
  result?: string;
  from?: string;
  to?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export const listAuditLogs = (query: QueryAudit) => get<PageResult<AuditLogRow>>('/audit-logs', query);

export const getAuditLog = (id: number) => get<AuditLogRow>(`/audit-logs/${id}`);
