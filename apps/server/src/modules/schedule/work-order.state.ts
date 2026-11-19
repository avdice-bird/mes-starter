import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';

/**
 * 工单状态机转换表（唯一正本：docs/state-machine/work-order.md 的表）。
 * Service 只查表，不写 if (status === ...)；改表 = 改这里 + 对照测试（同目录 spec）。
 */
export const WORK_ORDER_TRANSITIONS: Readonly<Record<string, Readonly<Record<string, string | null>>>> = {
  CREATED: {
    release: 'RELEASED', start: null, pause: null, resume: null,
    complete: null, close: null, cancel: 'CANCELLED',
  },
  RELEASED: {
    release: null, start: 'IN_PROGRESS', pause: null, resume: null,
    complete: null, close: null, cancel: 'CANCELLED',
  },
  IN_PROGRESS: {
    release: null, start: null, pause: 'PAUSED', resume: null,
    complete: 'COMPLETED', close: null, cancel: 'CANCELLED',
  },
  PAUSED: {
    release: null, start: null, pause: null, resume: 'IN_PROGRESS',
    complete: null, close: null, cancel: 'CANCELLED',
  },
  COMPLETED: {
    release: null, start: null, pause: null, resume: null,
    complete: null, close: 'CLOSED', cancel: null,
  },
  CLOSED: {
    release: null, start: null, pause: null, resume: null,
    complete: null, close: null, cancel: null,
  },
  CANCELLED: {
    release: null, start: null, pause: null, resume: null,
    complete: null, close: null, cancel: null,
  },
};

export const WORK_ORDER_ACTIONS = ['release', 'start', 'pause', 'resume', 'complete', 'close', 'cancel'] as const;
export type WorkOrderAction = (typeof WORK_ORDER_ACTIONS)[number];

/** 当前状态允许的动作（接口返回给前端按状态显隐按钮，前端不复制转换表） */
export function allowedActions(status: string): WorkOrderAction[] {
  const row = WORK_ORDER_TRANSITIONS[status];
  if (!row) return [];
  return WORK_ORDER_ACTIONS.filter((a) => row[a] !== null);
}

/** 查表：非法转换抛 1006，消息含当前状态与允许动作 */
export function nextStatus(status: string, action: WorkOrderAction): string {
  const target = WORK_ORDER_TRANSITIONS[status]?.[action];
  if (!target) {
    const allowed = allowedActions(status);
    throw new BusinessException(
      ErrorCode.STATE_NOT_ALLOWED,
      `工单当前状态为 ${status}，不允许 ${action}（允许的动作：${allowed.length ? allowed.join(' / ') : '无'}）`,
    );
  }
  return target;
}
