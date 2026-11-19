import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, resetDb, seedRbacForTest, login } from './helpers/app';
import { PrismaService } from '../src/prisma/prisma.service';
import { seedDicts } from '../prisma/seed-master';

/**
 * 第 30-32 节【测】工单状态机集成测试。
 * 转换表的 49 格已由 work-order-state.spec.ts 表驱动覆盖；这里验证 HTTP 层 +
 * 事务（状态与 log 同生共死）+ 乐观锁并发 + 前置条件 + 权限矩阵。
 */
describe('WorkOrder 状态机（第 30-32 节）', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let materialId: number; let routingMaterialId: number;
  let wcId: number;

  const api = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  /** 建单 + 拆一张工单，返回工单 id */
  async function makeWorkOrder(code: string, withRouting: boolean): Promise<number> {
    const matId = withRouting ? routingMaterialId : materialId;
    const o = await request(api()).post('/api/production-orders').set(auth(adminToken))
      .send({ code, materialId: matId, qty: 100, dueDate: '2027-01-01' });
    expect(o.status).toBe(201);
    const s = await request(api()).post(`/api/production-orders/${o.body.data.id}/split`).set(auth(adminToken))
      .send({ splits: [{ qty: 100, workCenterId: wcId }] });
    expect(s.status).toBe(201);
    const wo = await prisma.workOrder.findFirstOrThrow({ where: { productionOrderId: o.body.data.id } });
    return wo.id;
  }

  /** 快捷动作调用 */
  const act = (id: number, action: string, token = adminToken, body?: Record<string, unknown>) =>
    request(api()).post(`/api/work-orders/${id}/${action}`).set(auth(token)).send(body ?? {});

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => { await app.close(); });

  beforeEach(async () => {
    await resetDb(prisma);
    await seedRbacForTest(prisma);
    await seedDicts(prisma); // 业务字典（work_order_status）不在 RBAC 种子里，测试自灌
    adminToken = (await login(app, 'admin', 'Admin@123')).accessToken;

    const cat = await prisma.materialCategory.create({ data: { code: 'WS_CAT', name: 'x' } });
    const unit = await prisma.unit.create({ data: { code: 'WS_U', name: 'x' } });
    wcId = (await prisma.workCenter.create({ data: { code: 'WS-WC', name: '产线', dailyCapacity: 100 } })).id;
    // 报工员工（fillAllOperations 用）：任务未派工班组时报工不做班组一致性校验
    const wsTeam = await prisma.team.create({ data: { code: 'WS-T', name: '报工班', workCenterId: wcId } });
    await prisma.employee.create({ data: { code: 'WS-EMP', name: '报工工', teamId: wsTeam.id } });
    const matNoRoute = await prisma.material.create({ data: { code: 'WS-NR', name: '无路线', type: 'FINISHED', categoryId: cat.id, unitId: unit.id } });
    materialId = matNoRoute.id;
    const matRoute = await prisma.material.create({ data: { code: 'WS-RT', name: '有路线', type: 'FINISHED', categoryId: cat.id, unitId: unit.id } });
    routingMaterialId = matRoute.id;
    // 第 34 节后下达需按路线生成任务：路线必须有工序（旧夹具空工序会 2004，即用例 35-2 的双保险）
    await prisma.routing.create({
      data: {
        materialId: matRoute.id, version: 'v1', status: 'ACTIVE',
        operations: { create: [{ seq: 10, code: 'WS-OP1', name: '唯一工序', workCenterId: wcId, standardMinutes: 5 }] },
      },
    });
  });

  /** 第 34 节后 complete 需要全部工序完工：把工单下所有任务开工+填满（复用临时完工接口） */
  async function fillAllOperations(id: number) {
    const ops = await prisma.workOrderOperation.findMany({ where: { workOrderId: id }, orderBy: { seq: 'asc' } });
    let seq = 0;
    for (const op of ops) {
      seq += 1;
      await request(api()).post(`/api/work-order-operations/${op.id}/start`).set(auth(adminToken));
      // 通过报工接口填满（临时完工接口已在第 37 节删除）；employeeId=1 可不存在于派工班组？——任务未派工班组，无一致性校验
      const empId = (await prisma.employee.findFirstOrThrow({ where: { code: 'WS-EMP' } })).id;
      await request(api()).post('/api/work-reports').set(auth(adminToken)).send({
        workOrderOperationId: op.id, employeeId: empId, goodQty: op.plannedQty, defectQty: 0,
        idempotencyKey: `ws-${op.id}-${seq}-${Date.now()}`,
      });
    }
  }

  it('完整生命周期 7 步（含 cancel 单独一张）：每步状态正确、log 逐条正确', async () => {
    const id = await makeWorkOrder('PO-WS-L', true);
    const steps: [string, string][] = [
      ['release', 'RELEASED'], ['start', 'IN_PROGRESS'], ['pause', 'PAUSED'],
      ['resume', 'IN_PROGRESS'], ['complete', 'COMPLETED'], ['close', 'CLOSED'],
    ];
    for (const [action, want] of steps) {
      if (action === 'complete') await fillAllOperations(id); // 第 34 节前置：全部工序完工
      const r = await act(id, action, adminToken, action === 'complete' ? { reason: '尾数报废 2 件' } : undefined);
      expect(r.status).toBe(201);
      expect(r.body.data.status).toBe(want);
    }
    const logs = await prisma.workOrderStatusLog.findMany({ where: { workOrderId: id }, orderBy: { id: 'asc' } });
    expect(logs.map((l) => [l.action, l.fromStatus, l.toStatus])).toEqual([
      ['release', 'CREATED', 'RELEASED'],
      ['start', 'RELEASED', 'IN_PROGRESS'],
      ['pause', 'IN_PROGRESS', 'PAUSED'],
      ['resume', 'PAUSED', 'IN_PROGRESS'],
      ['complete', 'IN_PROGRESS', 'COMPLETED'],
      ['close', 'COMPLETED', 'CLOSED'],
    ]);
    expect(logs.every((l) => (l.operatorId ?? 0) > 0 && l.operatorName === 'admin')).toBe(true);

    // release 确定了路线
    const wo = await prisma.workOrder.findUniqueOrThrow({ where: { id } });
    expect(wo.routingId).not.toBeNull();

    // 另一张：CREATED → cancel（带理由）
    const id2 = await makeWorkOrder('PO-WS-L2', true);
    const r2 = await act(id2, 'cancel', adminToken, { reason: '订单变更' });
    expect(r2.status).toBe(201);
    expect(r2.body.data.status).toBe('CANCELLED');
    const lastLog = await prisma.workOrderStatusLog.findFirstOrThrow({ where: { workOrderId: id2 }, orderBy: { id: 'desc' } });
    expect(lastLog.reason).toBe('订单变更');
  });

  it('并发 start 10 次：1 成功，9 个冲突（1006/1007），log 1 条', async () => {
    const id = await makeWorkOrder('PO-WS-C', true);
    await act(id, 'release');
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => act(id, 'start')));
    const ok = results.filter((r) => r.status === 'fulfilled' && (r.value as { status: number }).status === 201);
    const codes = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => Number((r.reason as { code?: number }).code))
      .concat(
        results.filter((r) => r.status === 'fulfilled' && (r.value as { status: number }).status !== 201)
          .map((r) => Number(((r as PromiseFulfilledResult<{ body: { code: number } }>).value).body.code)),
      );
    expect(ok).toHaveLength(1);
    expect(codes.every((c) => c === 1006 || c === 1007)).toBe(true);
    expect(await prisma.workOrderStatusLog.count({ where: { workOrderId: id, action: 'start' } })).toBe(1);
    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id } })).status).toBe('IN_PROGRESS');
  });

  it('cancel 无 reason → 400；CREATED 直接 start → 1006 消息含允许动作', async () => {
    const id = await makeWorkOrder('PO-WS-V', true);
    const noReason = await act(id, 'cancel', adminToken, {});
    expect(noReason.status).toBe(400);
    expect(noReason.body.message).toContain('原因');

    const bad = await act(id, 'start');
    expect(bad.status).toBe(409);
    expect(bad.body.code).toBe(1006);
    expect(bad.body.message).toContain('CREATED');
    expect(bad.body.message).toContain('release');
    expect(await prisma.workOrderStatusLog.count({ where: { workOrderId: id } })).toBe(0); // 失败不写 log
  });

  it('release 无 ACTIVE 路线 → 422（code 2004），消息明确', async () => {
    const id = await makeWorkOrder('PO-WS-NR', false);
    const r = await act(id, 'release');
    expect(r.status).toBe(422);
    expect(r.body.code).toBe(2004);
    expect(r.body.message).toContain('路线');
    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id } })).status).toBe('CREATED');
  });

  it('complete：工序未完工 → 2004；工单未填满 completedQty 且无 reason → 400 原因；部分完工带 reason 成功', async () => {
    const id = await makeWorkOrder('PO-WS-CP', true);
    await act(id, 'release');
    await act(id, 'start');
    // 工序未完工：assertAllOperationsDone 422（第 34 节前置）
    const notDone = await act(id, 'complete', adminToken, { reason: 'x' });
    expect(notDone.status).toBe(422);
    expect(notDone.body.code).toBe(2004);
    // 填满工序任务；末道 90 良 10 不良 → 本道 COMPLETED（done=100），工单 completedQty=90（部分完工）
    let repSeq = 0;
    const ops = await prisma.workOrderOperation.findMany({ where: { workOrderId: id }, orderBy: { seq: 'asc' } });
    for (const [i, op] of ops.entries()) {
      await request(api()).post(`/api/work-order-operations/${op.id}/start`).set(auth(adminToken));
      const last = i === ops.length - 1;
      repSeq += 1;
      await request(api()).post('/api/work-reports').set(auth(adminToken)).send({
        workOrderOperationId: op.id,
        employeeId: (await prisma.employee.findFirstOrThrow({ where: { code: 'WS-EMP' } })).id,
        goodQty: last ? 90 : op.plannedQty,
        defectQty: last ? 10 : 0,
        idempotencyKey: `cp-${op.id}-${repSeq}-${Date.now()}`,
      });
    }
    // 工单 completedQty 90 < 100 且无 reason → 400 原因
    const noReason = await act(id, 'complete', adminToken, {});
    expect(noReason.status).toBe(400);
    expect(noReason.body.message).toContain('原因');
    // 部分完工带 reason → 成功
    const ok = await act(id, 'complete', adminToken, { reason: '尾数报废 10 件' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.status).toBe('COMPLETED');
  });

  it('关闭后：动作接口 1006、PATCH plan 409', async () => {
    const id = await makeWorkOrder('PO-WS-CL', true);
    await act(id, 'release');
    await act(id, 'start');
    await fillAllOperations(id);
    const done = await act(id, 'complete', adminToken, { reason: 'x' });
    expect(done.status).toBe(201);
    await act(id, 'close');
    expect((await act(id, 'start')).body.code).toBe(1006);
    expect((await act(id, 'cancel', adminToken, { reason: 'x' })).body.code).toBe(1006);
    const plan = await request(api()).patch(`/api/work-orders/${id}/plan`).set(auth(adminToken))
      .send({ plannedStart: '2026-10-20', plannedEnd: '2026-10-21', workCenterId: wcId });
    expect(plan.status).toBe(409);
    expect(plan.body.code).toBe(1006);
  });

  it('allowedActions 在每个状态下的值（detail 接口）', async () => {
    const id = await makeWorkOrder('PO-WS-AA', true);
    const d1 = await request(api()).get(`/api/work-orders/${id}/detail`).set(auth(adminToken));
    expect(d1.body.data.allowedActions).toEqual(['release', 'cancel']);
    await act(id, 'release');
    const d2 = await request(api()).get(`/api/work-orders/${id}/detail`).set(auth(adminToken));
    expect(d2.body.data.allowedActions).toEqual(['start', 'cancel']);
    expect(d2.body.data.logs).toHaveLength(1);
  });

  it('工单列表按状态筛选（字典 work_order_status 已种子化）', async () => {
    const id = await makeWorkOrder('PO-WS-F', true);
    await act(id, 'release');
    const res = await request(api()).get('/api/work-orders?status=RELEASED').set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.list.some((w: { id: number }) => w.id === id)).toBe(true);
    const dict = await prisma.dictItem.findMany({ where: { dict: { code: 'work_order_status' } } });
    expect(dict).toHaveLength(7);
  });

  it('权限：7 个动作接口 planner 可用、operator 403、匿名 401', async () => {
    const planner = (await login(app, 'planner', 'User@123')).accessToken;
    const operator = (await login(app, 'operator', 'User@123')).accessToken;
    const id = await makeWorkOrder('PO-WS-P', true);
    // 依次真实执行合法动作（planner），每个动作验证 operator 403 / 匿名 401；
    // 同时对每个接口验证"当前状态下的非法动作"返回 1006（有权限，被状态机拒绝）。
    const path: [string, Record<string, unknown>?][] = [
      ['release'], ['start'], ['pause'], ['resume'], ['complete', { reason: 'x' }], ['close'],
    ];
    for (const [a, body] of path) {
      const first = await act(id, a as string, operator, body ?? {});
      expect(first.status).toBe(403);
      expect((await act(id, a as string, '', body ?? {})).status).toBe(401);
      if (a === 'complete') await fillAllOperations(id); // 第 34 节前置
      const ok = await act(id, a as string, planner, body ?? {});
      expect(ok.status).toBe(201);
    }
    // cancel：CLOSED 已终态，先造一张 CANCELLED 前状态
    const id2 = await makeWorkOrder('PO-WS-P2', true);
    expect((await act(id2, 'cancel', operator, { reason: 'x' })).status).toBe(403);
    expect((await act(id2, 'cancel', '', { reason: 'x' })).status).toBe(401);
    expect((await act(id2, 'cancel', planner, { reason: 'x' })).status).toBe(201);
    // 7 个接口的"非法状态"拦截（终态工单上全部 1006，证明 403 与状态无关）
    for (const a of ['release', 'start', 'pause', 'resume', 'complete', 'close', 'cancel'] as const) {
      const body = a === 'cancel' || a === 'complete' ? { reason: 'x' } : {};
      const r = await act(id, a, planner, body);
      expect(r.status).toBe(409);
      expect(r.body.code).toBe(1006);
    }
  });
});
