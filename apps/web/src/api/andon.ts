import { get, post } from './http';

/** 安灯与站内信（第 50 节） */

export interface AndonRow {
  id: number;
  code: string;
  type: string;
  workCenterId: number;
  workCenter?: { code: string; name: string };
  equipmentId: number | null;
  equipment?: { code: string; name: string } | null;
  workOrderId: number | null;
  workOrderOperationId: number | null;
  description: string;
  status: string;
  escalated: boolean;
  caller?: { username: string; name: string } | null;
  responder?: { username: string; name: string } | null;
  calledAt: string;
  respondedAt: string | null;
  closedAt: string | null;
  resolution: string | null;
  cancelReason: string | null;
}

export interface AndonOpen {
  id: number;
  code: string;
  type: string;
  workCenterId: number;
  escalated: boolean;
  calledAt: string;
  description: string;
}

export interface NotificationRow {
  id: number;
  userId: number;
  title: string;
  content: string;
  type: string;
  refType: string | null;
  refId: number | null;
  isRead: boolean;
  createdAt: string;
}

export const createAndonCall = (data: {
  type: string; workCenterId: number; equipmentId?: number;
  workOrderId?: number; workOrderOperationId?: number; description: string;
}) => post<{ id: number; code: string; merged: boolean }>('/andon-calls', data);

export const respondAndon = (id: number, remark?: string) => post(`/andon-calls/${id}/respond`, { remark });
export const closeAndon = (id: number, resolution: string) => post(`/andon-calls/${id}/close`, { resolution });
export const cancelAndon = (id: number, reason: string) => post(`/andon-calls/${id}/cancel`, { reason });
export const listAndonCalls = (query: { page?: number; pageSize?: number; status?: string; workCenterId?: number }) =>
  get<{ list: AndonRow[]; total: number; page: number; pageSize: number }>('/andon-calls', query);
export const listOpenAndon = (workCenterId?: number) =>
  get<AndonOpen[]>('/andon-calls/open', workCenterId ? { workCenterId } : undefined);

export const listNotifications = (query: { page?: number; pageSize?: number; read?: 'read' | 'unread' }) =>
  get<{ list: NotificationRow[]; total: number; page: number; pageSize: number }>('/notifications', query);
export const unreadCount = () => get<{ count: number }>('/notifications/unread-count');
export const markNotificationRead = (id: number) => post<{ id: number; unreadCount: number }>(`/notifications/${id}/read`, {});
