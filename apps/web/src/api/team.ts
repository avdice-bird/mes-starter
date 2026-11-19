import { get, post, patch, del, put, type RequestConfig } from './http';
import type { ShiftRow, TeamRow, EmployeeRow, EmployeeTransferRow, PageResult } from '@mes/shared';

// ---- 班次 ----
export const listShifts = () => get<PageResult<ShiftRow>>('/shifts', { pageSize: 50 });
export const getCurrentShift = (at?: string) => get<{ shift: ShiftRow | null; at: string }>('shifts/current'.startsWith('/') ? '/shifts/current' : `/shifts/current${at ? `?at=${encodeURIComponent(at)}` : ''}`);
export const createShift = (data: { code: string; name: string; startTime: string; endTime: string }) => post<ShiftRow>('/shifts', data);
export const updateShift = (id: number, data: { name?: string; startTime?: string; endTime?: string }) => patch<ShiftRow>(`/shifts/${id}`, data);
export const deleteShift = (id: number) => del<void>(`/shifts/${id}`);

// ---- 班组 ----
export const listTeams = (query?: { keyword?: string }, config?: RequestConfig) =>
  get<PageResult<TeamRow>>('/teams', query, config);
export const createTeam = (data: { code: string; name: string; workCenterId: number; leaderId?: number }) => post<TeamRow>('/teams', data);
export const updateTeam = (id: number, data: { name?: string; workCenterId?: number; leaderId?: number }) => patch<TeamRow>(`/teams/${id}`, data);
export const deleteTeam = (id: number) => del<void>(`/teams/${id}`);

// ---- 员工 ----
export const listEmployees = (query: { page?: number; pageSize?: number; keyword?: string; status?: string; teamId?: number }) =>
  get<PageResult<EmployeeRow>>('/employees', query);
export const getEmployee = (id: number) => get<EmployeeRow>(`/employees/${id}`);
export const createEmployee = (data: { code: string; name: string; teamId: number; userId?: number }) => post<EmployeeRow>('/employees', data);
export const updateEmployee = (id: number, data: { name?: string; teamId?: number; userId?: number }) => patch<EmployeeRow>(`/employees/${id}`, data);
export const transferEmployee = (id: number, toTeamId: number) => post<EmployeeRow>(`/employees/${id}/transfer`, { toTeamId });
export const getTransfers = (id: number) => get<EmployeeTransferRow[]>(`/employees/${id}/transfers`);
export const leaveEmployee = (id: number) => post<EmployeeRow>(`/employees/${id}/leave`);
export const rehireEmployee = (id: number) => post<EmployeeRow>(`/employees/${id}/rehire`);
export const setSkills = (id: number, skills: { opCode?: string; workCenterId?: number; level: number }[]) =>
  put<EmployeeRow>(`/employees/${id}/skills`, { skills });
export const deleteEmployee = (id: number) => del<void>(`/employees/${id}`);
