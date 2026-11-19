import { ANDON_TRANSITIONS, ANDON_ACTIONS, allowedAndonActions, nextAndonStatus } from './andon.state';
import { ErrorCode } from '../../common/exceptions/business.exception';

/**
 * 第 52 节【测】安灯状态机转换表全覆盖：4 状态 × 3 动作 = 12 格。
 * 期望值来源：docs/acceptance/andon.md 的状态机表（手写规格，非 AI 生成）。
 */
describe('安灯状态机转换表（12 格全覆盖）', () => {
  const STATUSES = Object.keys(ANDON_TRANSITIONS);

  const LEGAL: Record<string, Record<string, string | null>> = {
    OPEN: { respond: 'RESPONDED', close: null, cancel: 'CANCELLED' },
    RESPONDED: { respond: null, close: 'CLOSED', cancel: null },
    CLOSED: { respond: null, close: null, cancel: null },
    CANCELLED: { respond: null, close: null, cancel: null },
  };

  it('常量表的合法格与规格表完全一致（防两头漂移）', () => {
    for (const status of STATUSES) {
      for (const action of ANDON_ACTIONS) {
        expect(ANDON_TRANSITIONS[status][action]).toBe(LEGAL[status][action] ?? null);
      }
    }
  });

  it('每个状态允许的动作：OPEN 2 个、RESPONDED 1 个、终态 0 个', () => {
    expect(allowedAndonActions('OPEN')).toEqual(['respond', 'cancel']);
    expect(allowedAndonActions('RESPONDED')).toEqual(['close']);
    expect(allowedAndonActions('CLOSED')).toEqual([]);
    expect(allowedAndonActions('CANCELLED')).toEqual([]);
  });

  for (const status of STATUSES) {
    for (const action of ANDON_ACTIONS) {
      const legal = LEGAL[status][action];
      it(`${status} + ${action} → ${legal ?? '1006'}`, () => {
        if (legal) {
          expect(nextAndonStatus(status, action as never)).toBe(legal);
        } else {
          try {
            nextAndonStatus(status, action as never);
            throw new Error(`应当抛 1006：${status} + ${action}`);
          } catch (e: any) {
            expect(e.code ?? e.response?.code).toBe(ErrorCode.STATE_NOT_ALLOWED);
            expect(e.response?.message ?? e.message).toContain(status);
          }
        }
      });
    }
  }
});
