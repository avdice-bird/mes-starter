import { allOperationsCompleted, computeFlowTransitions, OperationState, prevOperation } from './operation-flow';

/**
 * 第 36 节【测】流转判断纯函数单测：输入任务列表与本道完成数，输出应变更的状态。
 * 手算场景：4 道工序（seq 10/20/30/40），plannedQty 全 100。
 */
function op(over: Partial<OperationState> & { id: number; seq: number }): OperationState {
  return { status: 'PENDING', plannedQty: 100, completedQty: 0, defectQty: 0, skipped: false, isInspectionPoint: false, ...over };
}

describe('工序流转 computeFlowTransitions（第 36 节）', () => {
  const four = (): OperationState[] => [
    op({ id: 1, seq: 10, status: 'IN_PROGRESS' }),
    op({ id: 2, seq: 20 }),
    op({ id: 3, seq: 30 }),
    op({ id: 4, seq: 40 }),
  ];

  it('本道补满（completedQty=plannedQty）→ 本道 COMPLETED、下道 READY 且 plannedQty 下调', () => {
    const ops = four();
    ops[0].completedQty = 100;
    const changes = computeFlowTransitions(ops, 1);
    expect(changes).toContainEqual({ opId: 1, to: 'COMPLETED' });
    expect(changes).toContainEqual({ opId: 2, to: 'READY', plannedQty: 100 });
  });

  it('部分完工（不足计划数）→ 无状态变更', () => {
    const ops = four();
    ops[0].completedQty = 60;
    expect(computeFlowTransitions(ops, 1)).toEqual([]);
  });

  it('不良品不往下流：completed 80 + defect 20 → 下道 plannedQty = 80（良品）', () => {
    const ops = four();
    ops[0].completedQty = 80;
    ops[0].defectQty = 20;
    const changes = computeFlowTransitions(ops, 1);
    expect(changes).toContainEqual({ opId: 1, to: 'COMPLETED' });
    expect(changes).toContainEqual({ opId: 2, to: 'READY', plannedQty: 80 });
  });

  it('下道已 READY 且 plannedQty 更大 → 下调；已更小 → 不动', () => {
    const ops = four();
    ops[0].completedQty = 100;
    ops[1].status = 'READY';
    ops[1].plannedQty = 90; // 已被上一次流转定为 90，本次良品 100 → 不上调（min 取 90）
    const changes = computeFlowTransitions(ops, 1);
    expect(changes).toContainEqual({ opId: 1, to: 'COMPLETED' });
    expect(changes.find((c) => c.opId === 2)).toBeUndefined();
  });

  it('跳过的工序视为完成：skipped → 下道 READY', () => {
    const ops = four();
    ops[0].skipped = true;
    ops[0].status = 'IN_PROGRESS';
    const changes = computeFlowTransitions(ops, 1);
    expect(changes).toContainEqual({ opId: 1, to: 'COMPLETED' });
    expect(changes).toContainEqual({ opId: 2, to: 'READY', plannedQty: 0 });
  });

  it('本道已 COMPLETED（重复调用）→ 不再转本道；下道若已推进也不重复（重放安全）', () => {
    const ops = four();
    ops[0].status = 'COMPLETED';
    ops[0].completedQty = 100;
    // 场景 A：本道完成后下道尚未推进（理论上不该出现，重放能自愈）
    const changesA = computeFlowTransitions(ops, 1);
    expect(changesA.find((c) => c.opId === 1)).toBeUndefined(); // 本道不重复转
    // 场景 B：下道已 READY（正常路径，重放无变更）
    ops[1].status = 'READY';
    expect(computeFlowTransitions(ops, 1)).toEqual([]);
  });

  it('allOperationsCompleted：全部完成才 true；取消的不算', () => {
    const ops: OperationState[] = four().map((o) => ({ ...o, status: 'COMPLETED' as const }));
    expect(allOperationsCompleted(ops)).toBe(true);
    ops.push(op({ id: 9, seq: 50, status: 'CANCELLED' }));
    expect(allOperationsCompleted(ops)).toBe(true);
    ops[2].status = 'IN_PROGRESS';
    expect(allOperationsCompleted(ops)).toBe(false);
  });

  it('prevOperation：按 seq 找上道；首道无上道', () => {
    const ops = four();
    expect(prevOperation(ops, 30)?.id).toBe(2);
    expect(prevOperation(ops, 10)).toBeNull();
  });
});
