import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';

/**
 * 安灯状态机转换表（第 50 节；唯一正本：docs/state-machine/andon.md）。
 * 同工单：Service 只查表不写 if；改表 = 改这里 + 对照测试（同目录 spec，第 52 节）。
 * cancel 仅呼叫人可用（Service 额外校验身份），respond 需责任角色，close 需 resolution。
 */
export const ANDON_TRANSITIONS: Readonly<Record<string, Readonly<Record<string, string | null>>>> = {
  OPEN: {
    respond: 'RESPONDED',
    close: null,
    cancel: 'CANCELLED',
  },
  RESPONDED: {
    respond: null,
    close: 'CLOSED',
    cancel: null,
  },
  CLOSED: {
    respond: null,
    close: null,
    cancel: null,
  },
  CANCELLED: {
    respond: null,
    close: null,
    cancel: null,
  },
};

export const ANDON_ACTIONS = ['respond', 'close', 'cancel'] as const;
export type AndonAction = (typeof ANDON_ACTIONS)[number];

/** 当前状态允许的动作（前端按此显隐按钮） */
export function allowedAndonActions(status: string): AndonAction[] {
  const row = ANDON_TRANSITIONS[status];
  if (!row) return [];
  return ANDON_ACTIONS.filter((a) => row[a] !== null);
}

/** 查表：非法转换抛 1006，消息含当前状态与允许动作 */
export function nextAndonStatus(status: string, action: AndonAction): string {
  const target = ANDON_TRANSITIONS[status]?.[action];
  if (!target) {
    const allowed = allowedAndonActions(status);
    throw new BusinessException(
      ErrorCode.STATE_NOT_ALLOWED,
      `安灯当前状态为 ${status}，不允许 ${action}（允许的动作：${allowed.length ? allowed.join(' / ') : '无'}）`,
    );
  }
  return target;
}
