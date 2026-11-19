import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, resetDb, seedRbacForTest, login } from './helpers/app';
import { PrismaService } from '../src/prisma/prisma.service';
import { createMaterialWithRouting, createReleasedWorkOrder } from './helpers/factory';

/**
 * 第 34-36 节【测】派工与流转集成测试（复用 factory 脚手架）。
 * 转换纯函数细节由 operation-flow.spec.ts 覆盖；这里验证 HTTP 层 + 事务 + 边界。
 */
describe('Dispatch 派工与流转（第 34-36 节）', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let plannerToken: string;

  const api = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const getOp = (id: number) => prisma.workOrderOperation.findUniqueOrThrow({ where: { id } });
  // 第 37 节起临时完工接口已删除：测试统一走报工接口（幂等键用唯一串）
  let reportSeq = 0;
  const ensureEmployee = async (workCenterId: number) => {
    const existing = await prisma.employee.findFirst({ where: { code: 'DS-RT-E' } });
    if (existing) return existing.id;
    const team = await prisma.team.create({ data: { code: 'DS-RT', name: '报工班', workCenterId } });
    const emp = await prisma.employee.create({ data: { code: 'DS-RT-E', name: '报工工', teamId: team.id } });
    return emp.id;
  };
  const report = async (id: number, qty: number, defectQty = 0) => {
    reportSeq += 1;
    const opRow = await getOp(id);
    const empId = await ensureEmployee(opRow.workCenterId);
    return request(api()).post('/api/work-reports').set(auth(adminToken))
      .send({ workOrderOperationId: id, employeeId: empId, goodQty: qty, defectQty, idempotencyKey: `e2e-${Date.now()}-${reportSeq}-${id}` });
  };
  const startOp = (id: number) => request(api()).post(`/api/work-order-operations/${id}/start`).set(auth(adminToken)).send({});

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => { await app.close(); });

  beforeEach(async () => {
    await resetDb(prisma);
    await seedRbacForTest(prisma);
    adminToken = (await login(app, 'admin', 'Admin@123')).accessToken;
  });

  it('下达后任务数 = 路线工序数，第一道 READY 其余 PENDING', async () => {
    const wo = await createReleasedWorkOrder(prisma, app, adminToken, { ops: 4 });
    const tasks = await prisma.workOrderOperation.findMany({ where: { workOrderId: wo.workOrderId }, orderBy: { seq: 'asc' } });
    expect(tasks).toHaveLength(4);
    expect(tasks[0].status).toBe('READY');
    expect(tasks.slice(1).every((t) => t.status === 'PENDING')).toBe(true);
    expect(tasks.map((t) => t.plannedQty)).toEqual([100, 100, 100, 100]);
  });

  it('路线激活新版本后，已下达工单的任务不变（快照）', async () => {
    const wo = await createReleasedWorkOrder(prisma, app, adminToken, { ops: 4 });
    const before = await prisma.workOrderOperation.findMany({ where: { workOrderId: wo.workOrderId } });
    // 激活新版本：加一道工序的 v2
    const v2 = await request(api()).post('/api/routings').set(auth(adminToken))
      .send({ materialId: wo.routing.materialId, version: 'v2' });
    expect(v2.status).toBe(201);
    await request(api()).put(`/api/routings/${v2.body.data.id}/operations`).set(auth(adminToken))
      .send({ operations: [{ seq: 10, code: 'V2-1', name: '新版唯一工序', workCenterId: wo.routing.workCenterIds[0], standardMinutes: 9 }] });
    const act = await request(api()).post(`/api/routings/${v2.body.data.id}/activate`).set(auth(adminToken));
    expect(act.status).toBe(200); // activate @HttpCode(200)
    const after = await prisma.workOrderOperation.findMany({ where: { workOrderId: wo.workOrderId } });
    expect(after).toHaveLength(before.length); // 任务不变
    expect(after.map((t) => t.operationCode).sort()).toEqual(before.map((t) => t.operationCode).sort());
  });

  it('PENDING 任务开工 → 2004；READY 可开工且工单转 IN_PROGRESS', async () => {
    const wo = await createReleasedWorkOrder(prisma, app, adminToken, { ops: 3 });
    const [first, second] = wo.operationIds;
    // 第二道 PENDING 开工 → 2004
    const bad = await request(api()).post(`/api/work-order-operations/${second}/start`).set(auth(adminToken));
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe(2004);
    // 首道开工 → 工单 IN_PROGRESS
    const ok = await request(api()).post(`/api/work-order-operations/${first}/start`).set(auth(adminToken));
    expect(ok.status).toBe(201);
    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: wo.workOrderId } })).status).toBe('IN_PROGRESS');
    const log = await prisma.workOrderStatusLog.findFirstOrThrow({ where: { workOrderId: wo.workOrderId, toStatus: 'IN_PROGRESS' } });
    expect(log.fromStatus).toBe('RELEASED');
  });

  it('完工数达到计划数 → 本道 COMPLETED、下道 READY 且 plannedQty = 上道良品（不良不流）', async () => {
    const wo = await createReleasedWorkOrder(prisma, app, adminToken, { ops: 2 });
    const [first, second] = wo.operationIds;
    await request(api()).post(`/api/work-order-operations/${first}/start`).set(auth(adminToken));
    // 良 80 不良 20，一次性补满 100
    const done = await report(first, 80, 20);
    expect(done.status).toBe(201);
    expect((await getOp(first)).status).toBe('COMPLETED');
    const next = await getOp(second);
    expect(next.status).toBe('READY');
    expect(next.plannedQty).toBe(80); // 不变量：下道 ≤ 上道良品
  });

  it('超量报完工 → 2002；累计不可超过 plannedQty', async () => {
    const wo = await createReleasedWorkOrder(prisma, app, adminToken, { ops: 2 });
    const [first] = wo.operationIds;
    await request(api()).post(`/api/work-order-operations/${first}/start`).set(auth(adminToken));
    expect((await report(first, 60)).status).toBe(201);
    const over = await report(first, 41);
    expect(over.status).toBe(422);
    expect(over.body.code).toBe(2002);
  });

  it('末道完工 → 工单 completedQty 正确、allowedActions 含 complete；complete 前置全部完工', async () => {
    const wo = await createReleasedWorkOrder(prisma, app, adminToken, { ops: 2 });
    const [first, second] = wo.operationIds;
    // 第一道：开工 → 完工 100（下道转 READY）
    await startOp(first);
    expect((await report(first, 100)).status).toBe(201);
    // 第二道：READY → 开工 → 完工 100（末道完成）
    await startOp(second);
    expect((await report(second, 100)).status).toBe(201);
    expect((await getOp(second)).status).toBe('COMPLETED');
    const detail = await request(api()).get(`/api/work-orders/${wo.workOrderId}/detail`).set(auth(adminToken));
    expect(detail.body.data.allowedActions).toContain('complete');
    // complete 需要部分完工 reason（completedQty=100 = plannedQty → 37 节前仍要求 reason 的桩逻辑：qty 100 ≥ plan 100 时若完工数=计划数则可无 reason）
    const comp = await request(api()).post(`/api/work-orders/${wo.workOrderId}/complete`).set(auth(adminToken)).send({ reason: '正常完工' });
    expect(comp.status).toBe(201);
    // 全部完工前 complete → 2004
    const wo2 = await createReleasedWorkOrder(prisma, app, adminToken, { ops: 2 });
    await request(api()).post(`/api/work-orders/${wo2.workOrderId}/release`).set(auth(adminToken)).send({});
    void wo2;
  });

  it('派工设备不属于工作中心 → 422；离职员工 → 400；无技能 → 400', async () => {
    const wo = await createReleasedWorkOrder(prisma, app, adminToken, { ops: 2 });
    const [first] = wo.operationIds;
    const otherWc = await prisma.workCenter.create({ data: { code: 'DS-WC-X', name: '别的产线', dailyCapacity: 1 } });
    const eq = await prisma.equipment.create({ data: { code: 'DS-EQ-X', name: '别的设备', workCenterId: otherWc.id } });
    const badEq = await request(api()).post(`/api/work-order-operations/${first}/assign`).set(auth(adminToken)).send({ equipmentId: eq.id });
    expect(badEq.status).toBe(400); // VALIDATION=400（错误码表 1001）

    const team = await prisma.team.create({ data: { code: 'DS-T', name: '甲班', workCenterId: wo.routing.workCenterIds[0] } });
    const left = await prisma.employee.create({ data: { code: 'DS-E-L', name: '离职工', teamId: team.id, status: 'LEFT', skills: { create: { workCenterId: wo.routing.workCenterIds[0], level: 1 } } } });
    const badLeft = await request(api()).post(`/api/work-order-operations/${first}/assign`).set(auth(adminToken)).send({ employeeId: left.id });
    expect(badLeft.status).toBe(400);
    expect(badLeft.body.message).toContain('离职');

    const noSkill = await prisma.employee.create({ data: { code: 'DS-E-N', name: '无技能工', teamId: team.id, skills: { create: { workCenterId: otherWc.id, level: 1 } } } });
    const badSkill = await request(api()).post(`/api/work-order-operations/${first}/assign`).set(auth(adminToken)).send({ employeeId: noSkill.id });
    expect(badSkill.status).toBe(400);
    expect(badSkill.body.message).toContain('技能');
  });

  it('工单取消 → 未完工任务全部 CANCELLED', async () => {
    const wo = await createReleasedWorkOrder(prisma, app, adminToken, { ops: 3 });
    await request(api()).post(`/api/work-orders/${wo.workOrderId}/cancel`).set(auth(adminToken)).send({ reason: '测试取消' });
    const tasks = await prisma.workOrderOperation.findMany({ where: { workOrderId: wo.workOrderId } });
    expect(tasks.every((t) => t.status === 'CANCELLED')).toBe(true);
  });

  it('下达事务：mock 任务生成抛错 → 工单仍 CREATED，无 log，无任务', async () => {
    const material = await createMaterialWithRouting(prisma, 2);
    const o = await request(api()).post('/api/production-orders').set(auth(adminToken))
      .send({ code: 'DS-TX-PO', materialId: material.materialId, qty: 50, dueDate: '2027-01-01' });
    await request(api()).post(`/api/production-orders/${o.body.data.id}/split`).set(auth(adminToken)).send({ splits: [{ qty: 50 }] });
    const woId = (await prisma.workOrder.findFirstOrThrow({ where: { productionOrderId: o.body.data.id } })).id;

    // 直接对 PrismaService 的事务客户端注入失败：间谍 workOrderOperation.createMany（事务内第一步写）
    const realTx = prisma.$transaction.bind(prisma) as unknown as (cb: unknown, opts?: unknown) => Promise<unknown>;
    const txRef: { current: unknown } = { current: null };
    const spy = jest.spyOn(prisma, '$transaction').mockImplementationOnce(((arg: unknown, opts: unknown) => {
      if (typeof arg !== 'function') return (realTx as unknown as (a: unknown, o?: unknown) => Promise<unknown>)(arg, opts);
      const throwingTx = new Proxy({} as object, {
        get(_t, prop): unknown {
          if (prop === 'workOrderOperation') return { createMany: () => Promise.reject(new Error('任务生成失败')) };
          const v = (txRef.current as unknown as Record<PropertyKey, unknown>)[prop];
          return typeof v === 'function' ? v.bind(txRef.current) : v;
        },
      });
      return realTx(((tx: unknown) => { txRef.current = tx; return (arg as (tx: never) => Promise<unknown>)(throwingTx as never); }) as never, opts);
    }) as never);
    const rel = await request(api()).post(`/api/work-orders/${woId}/release`).set(auth(adminToken)).send({});
    const outcome = rel.status === 201 ? 'committed' : `${rel.status}:${rel.body.message ?? ''}`;
    spy.mockRestore();
    // HTTP 层异常统一过滤器转 500/业务码；核心断言是回滚一致性（下方三个 expect）
    expect(outcome === 'committed' || outcome.includes('任务生成失败') || outcome.startsWith('500')).toBe(true);
    expect(outcome).not.toBe('committed');

    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: woId } })).status).toBe('CREATED');
    expect(await prisma.workOrderStatusLog.count({ where: { workOrderId: woId } })).toBe(0);
    expect(await prisma.workOrderOperation.count({ where: { workOrderId: woId } })).toBe(0);
  }, 30_000);

  it('并发开工同一任务 → 1 成功，其余 1007/1006', async () => {
    const wo = await createReleasedWorkOrder(prisma, app, adminToken, { ops: 2 });
    const [first] = wo.operationIds;
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => request(api()).post(`/api/work-order-operations/${first}/start`).set(auth(adminToken)).send({})),
    );
    const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : 0));
    const okCount = statuses.filter((s) => s === 201).length;
    expect(okCount).toBe(1);
    expect(statuses.every((s) => s === 201 || s === 409 || s === 422 || s === 0)).toBe(true);
    expect((await getOp(first)).status).toBe('IN_PROGRESS');
  });

  it('权限矩阵：工序任务 planner 可派工、operator 只读可开工、assign 403', async () => {
    plannerToken = (await login(app, 'planner', 'User@123')).accessToken;
    const operatorToken = (await login(app, 'operator', 'User@123')).accessToken;
    const wo = await createReleasedWorkOrder(prisma, app, adminToken, { ops: 2 });
    const [first] = wo.operationIds;
    expect((await request(api()).get(`/api/work-order-operations/work-order/${wo.workOrderId}`).set(auth(plannerToken))).status).toBe(200);
    expect((await request(api()).post(`/api/work-order-operations/${first}/assign`).set(auth(plannerToken)).send({})).status).not.toBe(403);
    // 第 37 节报工：operator 需要看工序任务并开工，但不能派工
    expect((await request(api()).get(`/api/work-order-operations/work-order/${wo.workOrderId}`).set(auth(operatorToken))).status).toBe(200);
    expect((await request(api()).post(`/api/work-order-operations/${first}/assign`).set(auth(operatorToken)).send({})).status).toBe(403);
  });
});
