import { get, type RequestConfig } from './http';
import type { PageResult, ShiftRow, EmployeeRow, TeamRow } from '@mes/shared';

export const listEmployees = (query: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: string;
  teamId?: number;
}) => get<PageResult<EmployeeRow>>('/employees', query);

export const listTeams = (query?: { keyword?: string }) => get<PageResult<TeamRow>>('/teams', query);

export const listShifts = () => get<PageResult<ShiftRow>>('/shifts', { pageSize: 50 });

export const getCurrentShift = (at?: string, config?: RequestConfig) =>
  get<{ shift: ShiftRow | null; at: string }>(
    `/shifts/current${at ? `?at=${encodeURIComponent(at)}` : ''}`,
    undefined,
    config,
  );
