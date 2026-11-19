/** 移动端通用格式化与状态字典 */

export type TagType = 'primary' | 'success' | 'danger' | 'warning' | 'default';

export function formatDateTime(value?: string | null, withYear = false): string {
  if (!value) return '—';
  const s = value.replace('T', ' ').replace(/\.\d+Z?$/, '');
  return withYear ? s.slice(0, 16) : s.slice(5, 16);
}

export function formatDate(value?: string | null): string {
  if (!value) return '—';
  return value.replace('T', ' ').slice(0, 10);
}

export function timeAgo(value?: string | null): string {
  if (!value) return '—';
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return formatDateTime(value);
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day} 天前`;
  return formatDateTime(value);
}

export function pct(part: number, total: number): number {
  if (!total) return 0;
  return Math.min(100, Math.round((part / total) * 100));
}

export function fmtQty(n?: number | null): string {
  return (n ?? 0).toLocaleString('zh-CN');
}

// ---- 角色 ----
export const ROLE_TEXT: Record<string, string> = {
  admin: '管理员',
  planner: '计划员',
  operator: '操作工',
  qc: '质检员',
  maintainer: '设备维护员',
};

export function rolesText(roles: string[]): string {
  return roles.map((r) => ROLE_TEXT[r] ?? r).join(' · ') || '生产现场';
}

// ---- 工单状态 ----
export const WORK_ORDER_STATUS: Record<string, { text: string; type: TagType }> = {
  CREATED: { text: '已创建', type: 'default' },
  RELEASED: { text: '已下达', type: 'primary' },
  IN_PROGRESS: { text: '进行中', type: 'primary' },
  PAUSED: { text: '已暂停', type: 'warning' },
  COMPLETED: { text: '已完成', type: 'success' },
  CLOSED: { text: '已关闭', type: 'default' },
  CANCELLED: { text: '已取消', type: 'default' },
};

export const WORK_ORDER_ACTIONS: Record<
  string,
  { text: string; type: 'primary' | 'success' | 'danger' | 'warning' | 'default'; permission: string; needReason: boolean; confirm: string }
> = {
  release: { text: '下达', type: 'primary', permission: 'work-order:release', needReason: false, confirm: '确认下达该工单？下达前需有生效工艺路线。' },
  start: { text: '开工', type: 'primary', permission: 'work-order:start', needReason: false, confirm: '确认开始生产该工单？' },
  pause: { text: '暂停', type: 'warning', permission: 'work-order:pause', needReason: true, confirm: '确认暂停该工单？请填写暂停原因。' },
  resume: { text: '继续', type: 'primary', permission: 'work-order:start', needReason: false, confirm: '确认恢复生产？' },
  complete: { text: '完工', type: 'success', permission: 'work-order:complete', needReason: true, confirm: '确认完工？未达计划数量时必须填写原因。' },
  close: { text: '关闭', type: 'default', permission: 'work-order:close', needReason: false, confirm: '关闭后工单进入终态，确认关闭？' },
  cancel: { text: '取消', type: 'danger', permission: 'work-order:cancel', needReason: true, confirm: '取消必须填写原因，确认取消该工单？' },
};

// ---- 工序任务状态 ----
export const OP_STATUS: Record<string, { text: string; type: TagType }> = {
  PENDING: { text: '未就绪', type: 'default' },
  READY: { text: '待开工', type: 'warning' },
  IN_PROGRESS: { text: '进行中', type: 'primary' },
  COMPLETED: { text: '已完成', type: 'success' },
  CANCELLED: { text: '已取消', type: 'default' },
};

// ---- 安灯 ----
export const ANDON_TYPE: Record<string, { text: string; type: TagType }> = {
  MATERIAL: { text: '缺料', type: 'warning' },
  EQUIPMENT: { text: '设备异常', type: 'danger' },
  QUALITY: { text: '质量问题', type: 'primary' },
  OTHER: { text: '其他', type: 'default' },
};

export const ANDON_STATUS: Record<string, { text: string; type: TagType }> = {
  OPEN: { text: '待响应', type: 'danger' },
  RESPONDED: { text: '已响应', type: 'warning' },
  CLOSED: { text: '已关闭', type: 'success' },
  CANCELLED: { text: '已取消', type: 'default' },
};

// ---- 质检 ----
export const INSPECTION_TYPE: Record<string, string> = { IQC: '来料检', IPQC: '过程检', FQC: '终检' };

export const INSPECTION_RESULT: Record<string, { text: string; type: TagType }> = {
  PENDING: { text: '待判', type: 'warning' },
  PASS: { text: '合格', type: 'success' },
  FAIL: { text: '不合格', type: 'danger' },
  CONCESSION: { text: '让步接收', type: 'primary' },
};

// ---- 库存流水 ----
export const TX_TYPE: Record<string, { text: string; type: TagType }> = {
  ISSUE: { text: '领料', type: 'warning' },
  RETURN: { text: '退料', type: 'primary' },
  RECEIPT: { text: '入库', type: 'success' },
  ADJUST: { text: '调整', type: 'default' },
  INIT: { text: '期初', type: 'default' },
};
