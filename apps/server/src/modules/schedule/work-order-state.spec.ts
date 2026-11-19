import { WORK_ORDER_ACTIONS, WORK_ORDER_TRANSITIONS, allowedActions, nextStatus } from './work-order.state';
import { ErrorCode } from '../../common/exceptions/business.exception';

/**
 * 第 32 节【测】状态机转换表全覆盖：表驱动遍历 7 状态 × 7 动作 = 49 格。
 * 本测试与转换表常量放在一起（改表必改测试）：合法格子断言目标状态，✗ 格子断言 1006。
 * 期望值来源：docs/state-machine/work-order.md 的表格（手写规格，非 AI 生成）。
 */
describe('工单状态机转换表（49 格全覆盖）', () => {
  const STATUSES = Object.keys(WORK_ORDER_TRANSITIONS);

  /** 规格里人工核对的合法转换：状态 → { 动作 → 目标 }（与 work-order.md 的表一致） */
  const LEGAL: Record<string, Record<string, string>> = {
    CREATED: { release: 'RELEASED', cancel: 'CANCELLED' },
    RELEASED: { start: 'IN_PROGRESS', cancel: 'CANCELLED' },
    IN_PROGRESS: { pause: 'PAUSED', complete: 'COMPLETED', cancel: 'CANCELLED' },
    PAUSED: { resume: 'IN_PROGRESS', cancel: 'CANCELLED' },
    COMPLETED: { close: 'CLOSED' },
    CLOSED: {},
    CANCELLED: {},
  };

  it('常量表的合法格与规格表完全一致（防两头漂移）', () => {
    for (const status of STATUSES) {
      for (const action of WORK_ORDER_ACTIONS) {
        const expected = LEGAL[status][action] ?? null;
        expect(WORK_ORDER_TRANSITIONS[status][action]).toBe(expected);
      }
    }
  });

  it('每个状态的动作数：合法格 12 个，终态 0 个', () => {
    expect(allowedActions('CREATED')).toEqual(['release', 'cancel']);
    expect(allowedActions('RELEASED')).toEqual(['start', 'cancel']);
    expect(allowedActions('IN_PROGRESS')).toEqual(['pause', 'complete', 'cancel']);
    expect(allowedActions('PAUSED')).toEqual(['resume', 'cancel']);
    expect(allowedActions('COMPLETED')).toEqual(['close']);
    expect(allowedActions('CLOSED')).toEqual([]);
    expect(allowedActions('CANCELLED')).toEqual([]);
  });

  /** 49 格：合法 → 目标状态；非法 → 1006（消息含状态与允许动作） */
  for (const status of STATUSES) {
    for (const action of WORK_ORDER_ACTIONS) {
      const legal = LEGAL[status][action];
      it(`${status} + ${action} → ${legal ?? '1006'}`, () => {
        if (legal) {
          expect(nextStatus(status, action as never)).toBe(legal);
        } else {
          try {
            nextStatus(status, action as never);
            throw new Error(`应当抛 1006：${status} + ${action}`);
          } catch (e: any) {
            expect(e.code ?? e.response?.code).toBe(ErrorCode.STATE_NOT_ALLOWED);
            expect(e.response?.message ?? e.message).toContain(status);
          }
        }
      });
    }
  }

  it('未知状态 → allowedActions 为空、nextStatus 抛 1006（防御坏数据）', () => {
    expect(allowedActions('WHATEVER')).toEqual([]);
    expect(() => nextStatus('WHATEVER', 'start' as never)).toThrow();
  });
});
