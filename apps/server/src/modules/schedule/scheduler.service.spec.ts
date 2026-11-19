import { addDays, diffDays, firstFreeRun, schedule, SchedulableWorkOrder, SchedulableWorkCenter } from './scheduler.algorithm';

/**
 * 第 28 节【测】排产算法单测（任务卡要求全覆盖，期望值先手算再断言）。
 * 输入小到能手画：2 条产线 A=100/天、B=50/天，from=2026-10-12（周一）。
 * 期望值复算记录（AI 生成后人手复核，ceil 是重点）：
 *   250/100 = 2.5 → ceil = 3 天；200/100 = 2 天；50/50 = 1 天；300/100 = 3 天。
 */
describe('排产算法 schedule()（内存数据，无 Prisma）', () => {
  const FROM = new Date('2026-10-12T00:00:00.000Z'); // 基准日
  const day = (n: number) => addDays(FROM, n);
  const date = (s: string) => new Date(`${s}T00:00:00.000Z`);

  const wcA: SchedulableWorkCenter = { id: 1, dailyCapacity: 100, status: 1 };
  const wcB: SchedulableWorkCenter = { id: 2, dailyCapacity: 50, status: 1 };

  /** 工厂函数：默认不指定产线、优先级 3、交期 2027 年（不延误）、createdAt 递增 */
  let nextId = 1;
  function wo(over: Partial<SchedulableWorkOrder> = {}): SchedulableWorkOrder {
    const id = over.id ?? nextId++;
    return {
      id,
      qty: 100,
      workCenterId: null,
      dueDate: date('2027-01-01'),
      priority: 3,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, id)), // 每张差 1ms
      ...over,
    };
  }

  it('用例1：qty=250、产能 100 → 占 3 天，plannedEnd = from+2（手算 250/100=2.5→ceil 3）', () => {
    const r = schedule([wo({ qty: 250, workCenterId: 1 })], [wcA], {}, FROM);
    expect(r.skipped).toHaveLength(0);
    expect(r.items[0].plannedStart).toEqual(day(0));
    expect(r.items[0].plannedEnd).toEqual(day(2)); // 10-12 ~ 10-14
  });

  it('用例2：两个工单同产线（指定 A）→ 第二张从第一张结束次日开始', () => {
    const r = schedule(
      [wo({ qty: 200, workCenterId: 1, priority: 1 }), wo({ qty: 100, workCenterId: 1 })],
      [wcA], {}, FROM,
    );
    // 200/100 = 2 天：第一张 10-12~10-13；第二张 10-14 起（用例2 期望）
    expect(r.items[0].plannedStart).toEqual(day(0));
    expect(r.items[0].plannedEnd).toEqual(day(1));
    expect(r.items[1].plannedStart).toEqual(day(2));
    expect(r.items[1].plannedEnd).toEqual(day(2));
  });

  it('用例3：优先级高的后创建 → 排在前面（单产线顺序可见）', () => {
    const late = wo({ id: 101, qty: 100, workCenterId: 1, priority: 1, createdAt: date('2026-06-01') });
    const early = wo({ id: 102, qty: 100, workCenterId: 1, priority: 3, createdAt: date('2026-01-01') });
    const r = schedule([early, late], [wcA], {}, FROM);
    // 排序与入参顺序无关：优先级 1 的先排（10-12），priority 3 的第二（10-13）
    expect(r.items[0].workOrderId).toBe(101);
    expect(r.items[1].workOrderId).toBe(102);
    expect(r.items[0].plannedStart).toEqual(day(0));
    expect(r.items[1].plannedStart).toEqual(day(1));
  });

  it('用例4：优先级相同、交期早的排在前面', () => {
    const loose = wo({ id: 201, workCenterId: 1, dueDate: date('2026-12-01') });
    const tight = wo({ id: 202, workCenterId: 1, dueDate: date('2026-11-01') });
    const r = schedule([loose, tight], [wcA], {}, FROM);
    expect(r.items[0].workOrderId).toBe(202);
    expect(r.items[1].workOrderId).toBe(201);
  });

  it('用例4b：优先级相同、交期相同 → 按创建时间稳定排序；同毫秒按 id 兜底（可复现）', () => {
    const a = wo({ id: 301, workCenterId: 1, createdAt: date('2026-01-02') });
    const b = wo({ id: 302, workCenterId: 1, createdAt: date('2026-01-01') });
    const c = wo({ id: 303, workCenterId: 1, createdAt: date('2026-01-01') });
    const r1 = schedule([a, b, c], [wcA], {}, FROM);
    const r2 = schedule([c, b, a], [wcA], {}, FROM); // 入参乱序
    expect(r1.items.map((i) => i.workOrderId)).toEqual([302, 303, 301]);
    expect(r2.items.map((i) => i.workOrderId)).toEqual([302, 303, 301]); // 复现
  });

  it('用例5：plannedEnd 晚于 dueDate → isDelayed=true（250 件 3 天 > 2 天后交期）', () => {
    const r = schedule(
      [wo({ qty: 250, workCenterId: 1, dueDate: date('2026-10-13') })], [wcA], {}, FROM,
    );
    expect(r.items[0].isDelayed).toBe(true);
    // 对照：交期正好是完工日 → 不延误（plannedEnd <= dueDate）
    const ok = schedule(
      [wo({ qty: 250, workCenterId: 1, dueDate: date('2026-10-14') })], [wcA], {}, FROM,
    );
    expect(ok.items[0].isDelayed).toBe(false);
  });

  it('用例6：产能 0 的产线不分配（跳过并给原因）；停用产线同样跳过', () => {
    const zero: SchedulableWorkCenter = { id: 3, dailyCapacity: 0, status: 1 };
    const off: SchedulableWorkCenter = { id: 4, dailyCapacity: 100, status: 0 };
    const r = schedule(
      [wo({ workCenterId: 3 }), wo({ workCenterId: 4 })], [zero, off], {}, FROM,
    );
    expect(r.items).toHaveLength(0);
    expect(r.skipped).toHaveLength(2);
    expect(r.skipped[0].reason).toContain('产线');
  });

  it('用例7：未指定产线 → 分配到最早空闲的产线（A 100 与 B 50 都空闲选 A：开工同为 day0，完工更早）', () => {
    const r = schedule([wo({ qty: 50 })], [wcA, wcB], {}, FROM);
    expect(r.items[0].workCenterId).toBe(1);
    // A 被 300 件占满 3 天后，下一张未指定的从 B 开始（B day0 空闲）
    const r2 = schedule(
      [wo({ qty: 300, priority: 1 }), wo({ qty: 50 })], [wcA, wcB], {}, FROM,
    );
    expect(r2.items[1].workCenterId).toBe(2);
  });

  it('用例8：已开工工单不在输出中，且其占用的产能被扣除（existingLoad 占满 day0 → 新工单从 day1 起）', () => {
    // existingLoad 口径：{ wcId: { 'yyyy-mm-dd': qty } }，占用量 >0 的日视为满
    const r = schedule(
      [wo({ qty: 100, workCenterId: 1 })], [wcA], { 1: { '2026-10-12': 100 } }, FROM,
    );
    expect(r.items[0].plannedStart).toEqual(day(1)); // 10-13
    expect(r.items[0].plannedEnd).toEqual(day(1));
  });

  it('用例9：输入为空 → 返回空，不报错', () => {
    const r = schedule([], [wcA, wcB], {}, FROM);
    expect(r.items).toEqual([]);
    expect(r.skipped).toEqual([]);
  });

  it('边界：qty 超出排产窗口 → 跳过（reason 提示产能不足）', () => {
    // 默认 365 天窗口：10000/100 = 100 天，排得下（对照，确认不是恒跳过）
    const fits = schedule([wo({ qty: 10_000, workCenterId: 1 })], [wcA], {}, FROM);
    expect(fits.items).toHaveLength(1);
    // 窗口 30 天：排不下 → 跳过
    const r = schedule([wo({ qty: 10_000, workCenterId: 1 })], [wcA], {}, FROM, 30);
    expect(r.items).toHaveLength(0);
    expect(r.skipped[0].reason).toContain('产能');
  });

  it('边界：addDays/diffDays 跨月与 UTC 口径', () => {
    expect(diffDays(date('2026-10-12'), date('2026-10-31'))).toBe(19);
    expect(diffDays(date('2026-10-12'), date('2026-11-01'))).toBe(20); // 跨月
    expect(addDays(date('2026-10-31'), 1)).toEqual(date('2026-11-01'));
  });

  it('边界：firstFreeRun 跳过中间被占的日（洞）', () => {
    const load = new Map<number, number>([[0, 100], [1, 0], [2, 100], [3, 0], [4, 0]]);
    expect(firstFreeRun(load, 1, 0)).toBe(1); // day0 满 → day1
    expect(firstFreeRun(load, 2, 0)).toBe(3); // 连续 2 天最早在 day3-4
    expect(firstFreeRun(new Map(), 2, 0)).toBe(0);
  });
});
