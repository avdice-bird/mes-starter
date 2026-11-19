import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, resetDb, seedRbacForTest, login } from './helpers/app';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * 第 26-28 节【测】生产订单拆分与排产集成测试。
 * 用例编号对应任务卡 27 节；算法分支的细节已由 scheduler.service.spec.ts 覆盖，
 * 这里验证 HTTP 层 + Prisma 事务 + 权限 + 状态联动。
 */
describe('Schedule/ProductionOrder 集成（第 26-28 节）', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let materialId: number;
  let wcA: number; // 100/天
  let wcB: number; // 50/天
  let wcZero: number; // 产能 0

  const api = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function createOrder(code: string, qty: number, dueDate: string, priority = 3) {
    const res = await request(api()).post('/api/production-orders').set(auth(adminToken))
      .send({ code, materialId, qty, dueDate, priority });
    expect(res.status).toBe(201);
    return res.body.data as { id: number; code: string; status: string };
  }
  async function splitOrder(id: number, splits: { qty: number; workCenterId?: number }[]) {
    return request(api()).post(`/api/production-orders/${id}/split`).set(auth(adminToken)).send({ splits });
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => { await app.close(); });

  beforeEach(async () => {
    await resetDb(prisma);
    await seedRbacForTest(prisma);
    // 登录限流 20 次/分钟（单 IP）：beforeEach 只登 admin，其余角色在权限用例里登录
    adminToken = (await login(app, 'admin', 'Admin@123')).accessToken;

    const cat = await prisma.materialCategory.create({ data: { code: 'SCH_CAT', name: 'x' } });
    const unit = await prisma.unit.create({ data: { code: 'SCH_U', name: 'x' } });
    const mat = await prisma.material.create({ data: { code: 'SCH-FG', name: '排产成品', type: 'FINISHED', categoryId: cat.id, unitId: unit.id } });
    materialId = mat.id;
    wcA = (await prisma.workCenter.create({ data: { code: 'SCH-A', name: 'A线 100', dailyCapacity: 100 } })).id;
    wcB = (await prisma.workCenter.create({ data: { code: 'SCH-B', name: 'B线 50', dailyCapacity: 50 } })).id;
    wcZero = (await prisma.workCenter.create({ data: { code: 'SCH-Z', name: '零产能', dailyCapacity: 0 } })).id;
  });

  // ---- 拆分（用例 1-3） ----

  it('自动编码：不传 code 或传空白 → 生成 PO-YYYY-NNN 且连续不重复', async () => {
    const year = new Date(Date.now() + 8 * 3600_000).getUTCFullYear(); // 工厂时区 +8
    const post = (code?: string) =>
      request(api()).post('/api/production-orders').set(auth(adminToken)).send({
        ...(code !== undefined ? { code } : {}), materialId, qty: 10, dueDate: '2027-01-01',
      });
    const a = await post();
    const b = await post('   ');
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.data.code).toBe(`PO-${year}-001`);
    expect(b.body.data.code).toBe(`PO-${year}-002`);
    // 手动编码仍然保留，且唯一性照旧 409
    expect((await post(`PO-${year}-001`)).status).toBe(409);
  });

  it('用例1：拆分数量之和 ≠ 订单数量 → 400，提示差额', async () => {
    const o = await createOrder('PO-E2E-1', 500, '2026-12-31');
    const res = await splitOrder(o.id, [{ qty: 200 }, { qty: 100 }]);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('差额');
    expect(res.body.message).toContain('200'); // 500 - 300
    expect(await prisma.workOrder.count({ where: { productionOrderId: o.id } })).toBe(0);
  });

  it('用例2：拆分某项 qty=0 / 负数 → 400（DTO @Min(1)）', async () => {
    const o = await createOrder('PO-E2E-2', 100, '2026-12-31');
    const r0 = await splitOrder(o.id, [{ qty: 0 }, { qty: 100 }]);
    expect(r0.status).toBe(400);
    const rn = await splitOrder(o.id, [{ qty: -50 }, { qty: 150 }]);
    expect(rn.status).toBe(400);
  });

  it('用例3：已拆分（PLANNED）的订单再次拆分 → 409', async () => {
    const o = await createOrder('PO-E2E-3', 100, '2026-12-31');
    expect((await splitOrder(o.id, [{ qty: 100 }])).status).toBe(201);
    const res = await splitOrder(o.id, [{ qty: 100 }]);
    expect(res.status).toBe(409);
  });

  it('用例4：已有工单的订单改数量 → 409；改交期/优先级放行', async () => {
    const o = await createOrder('PO-E2E-4', 100, '2026-12-31');
    await splitOrder(o.id, [{ qty: 100 }]);
    const bad = await request(api()).patch(`/api/production-orders/${o.id}`).set(auth(adminToken)).send({ qty: 999 });
    expect(bad.status).toBe(409);
    const ok = await request(api()).patch(`/api/production-orders/${o.id}`).set(auth(adminToken)).send({ dueDate: '2027-06-30', priority: 1 });
    expect(ok.status).toBe(200);
  });

  it('拆分守恒（正向）：3 张工单数量之和 = 订单 qty，订单转 PLANNED', async () => {
    const o = await createOrder('PO-E2E-K', 500, '2026-12-31');
    const res = await splitOrder(o.id, [{ qty: 200 }, { qty: 200, workCenterId: wcA }, { qty: 100 }]);
    expect(res.status).toBe(201);
    const wos = await prisma.workOrder.findMany({ where: { productionOrderId: o.id } });
    expect(wos).toHaveLength(3);
    expect(wos.reduce((s, w) => s + w.qty, 0)).toBe(500);
    expect(wos.find((w) => w.qty === 200 && w.workCenterId === wcA)).toBeTruthy();
    expect((await prisma.productionOrder.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('PLANNED');
  });

  // ---- 排产（用例 5-10） ----

  /** 建单并拆分：qty 全拆一张、指定产线 */
  async function oneWoOrder(code: string, qty: number, dueDate: string, priority: number, workCenterId?: number) {
    const o = await createOrder(code, qty, dueDate, priority);
    const res = await splitOrder(o.id, [{ qty, workCenterId }]);
    expect(res.status).toBe(201);
    const wo = await prisma.workOrder.findFirstOrThrow({ where: { productionOrderId: o.id } });
    return wo;
  }

  it('用例5+7：同产线顺延 + 跨多天：A 线 100/天，200 件占 2 天，下一张从 day2 起', async () => {
    const wo1 = await oneWoOrder('PO-E2E-S1', 200, '2027-01-01', 1, wcA);
    const wo2 = await oneWoOrder('PO-E2E-S2', 100, '2027-01-01', 2, wcA);
    const res = await request(api()).post('/api/schedule/run').set(auth(adminToken)).send({ from: '2026-10-12', workCenterIds: [wcA] });
    expect(res.status).toBe(201);
    const after = await prisma.workOrder.findMany({ where: { id: { in: [wo1.id, wo2.id] } }, orderBy: { id: 'asc' } });
    // 手算：wo1 10-12 ~ 10-13；wo2 10-14 ~ 10-14
    const s1 = after.find((w) => w.id === wo1.id)!;
    const s2 = after.find((w) => w.id === wo2.id)!;
    expect(s1.plannedStart!.toISOString().slice(0, 10)).toBe('2026-10-12');
    expect(s1.plannedEnd!.toISOString().slice(0, 10)).toBe('2026-10-13');
    expect(s2.plannedStart!.toISOString().slice(0, 10)).toBe('2026-10-14');
  });

  it('用例6：指定产能 0 的产线 → 跳过并在结果中提示', async () => {
    await oneWoOrder('PO-E2E-Z', 100, '2027-01-01', 3, wcZero);
    const res = await request(api()).post('/api/schedule/run').set(auth(adminToken)).send({ from: '2026-10-12' });
    expect(res.status).toBe(201);
    expect(res.body.data.scheduled).toBe(0);
    expect(res.body.data.skipped).toHaveLength(1);
    expect(res.body.data.skipped[0].reason).toContain('产线');
  });

  it('用例8：plannedEnd > dueDate → isDelayed=true，结果汇总 delayed 数', async () => {
    // 300 件 A 线 3 天（10-12 ~ 10-14），交期 10-13 → 延误
    await oneWoOrder('PO-E2E-D', 300, '2026-10-13', 1, wcA);
    const res = await request(api()).post('/api/schedule/run').set(auth(adminToken)).send({ from: '2026-10-12', workCenterIds: [wcA] });
    expect(res.body.data.delayed).toBe(1);
    const wo = await prisma.workOrder.findFirstOrThrow({ where: { productionOrder: { code: 'PO-E2E-D' } } });
    expect(wo.isDelayed).toBe(true);
  });

  it('用例9：重排不动已下达工单；其产能被扣除（RELEASED 占 day0，CREATED 从 day1 起）', async () => {
    const wo1 = await oneWoOrder('PO-E2E-R1', 100, '2027-01-01', 1, wcA);
    // 模拟第 30 节之前的状态：手工把工单置为 RELEASED 并已有计划
    await prisma.workOrder.update({
      where: { id: wo1.id },
      data: { status: 'RELEASED', plannedStart: new Date('2026-10-12T00:00:00.000Z'), plannedEnd: new Date('2026-10-12T00:00:00.000Z') },
    });
    const wo2 = await oneWoOrder('PO-E2E-R2', 100, '2027-01-01', 2, wcA);
    const res = await request(api()).post('/api/schedule/run').set(auth(adminToken)).send({ from: '2026-10-12', workCenterIds: [wcA] });
    expect(res.status).toBe(201);
    const r1 = await prisma.workOrder.findUniqueOrThrow({ where: { id: wo1.id } });
    expect(r1.plannedStart!.toISOString().slice(0, 10)).toBe('2026-10-12'); // 没被重排
    const r2 = await prisma.workOrder.findUniqueOrThrow({ where: { id: wo2.id } });
    expect(r2.plannedStart!.toISOString().slice(0, 10)).toBe('2026-10-13'); // day0 被 RELEASED 占用
  });

  it('用例10：未指定产线的工单 → 排到最早空闲产线；指定产线的不动', async () => {
    const free = await oneWoOrder('PO-E2E-F1', 100, '2027-01-01', 1); // 未指定
    await oneWoOrder('PO-E2E-F2', 100, '2027-01-01', 2, wcB); // 指定 B
    const res = await request(api()).post('/api/schedule/run').set(auth(adminToken)).send({ from: '2026-10-12', workCenterIds: [wcA, wcB] });
    expect(res.status).toBe(201);
    const f1 = await prisma.workOrder.findUniqueOrThrow({ where: { id: free.id } });
    expect(f1.workCenterId).toBe(wcA); // A、B 都空闲：开工并列 day0，A 完工更早
  });

  it('用例12：优先级相同、交期相同 → 按创建时间稳定排序（同毫秒 id 兜底，两次运行结果一致）', async () => {
    const o = await createOrder('PO-E2E-T', 300, '2027-01-01', 2);
    // 三张工单同一 createdAt（同毫秒）：seq=查询序（id asc）
    await splitOrder(o.id, [{ qty: 100 }, { qty: 100 }, { qty: 100 }]);
    const run = () => request(api()).post('/api/schedule/run').set(auth(adminToken))
      .send({ from: '2026-10-12', workCenterIds: [wcA] });
    await run();
    const first = await prisma.workOrder.findMany({ where: { productionOrderId: o.id }, orderBy: { id: 'asc' } });
    await run();
    const second = await prisma.workOrder.findMany({ where: { productionOrderId: o.id }, orderBy: { id: 'asc' } });
    expect(first.map((w) => w.plannedStart!.toISOString())).toEqual(second.map((w) => w.plannedStart!.toISOString()));
    // 三张 100 件在 A 线（100/天）顺序排：day0 / day1 / day2
    expect(first[0].plannedStart!.toISOString().slice(0, 10)).toBe('2026-10-12');
    expect(first[1].plannedStart!.toISOString().slice(0, 10)).toBe('2026-10-13');
    expect(first[2].plannedStart!.toISOString().slice(0, 10)).toBe('2026-10-14');
  });

  // ---- 取消（用例 11） ----

  it('用例11：取消订单 → CREATED 工单级联取消；有 RELEASED 工单时拒绝', async () => {
    const o1 = await createOrder('PO-E2E-C1', 200, '2027-01-01');
    await splitOrder(o1.id, [{ qty: 100 }, { qty: 100 }]);
    const res = await request(api()).post(`/api/production-orders/${o1.id}/cancel`).set(auth(adminToken));
    expect(res.status).toBe(200);
    const wos = await prisma.workOrder.findMany({ where: { productionOrderId: o1.id } });
    expect(wos.every((w) => w.status === 'CANCELLED')).toBe(true);
    expect((await prisma.productionOrder.findUniqueOrThrow({ where: { id: o1.id } })).status).toBe('CANCELLED');
    // 已取消订单不能再拆
    expect((await splitOrder(o1.id, [{ qty: 200 }])).status).toBe(409);

    const o2 = await createOrder('PO-E2E-C2', 100, '2027-01-01');
    const w = await splitOrder(o2.id, [{ qty: 100 }]);
    const woId = (w.body.data.workOrders as { id: number }[])[0].id;
    await prisma.workOrder.update({ where: { id: woId }, data: { status: 'RELEASED' } });
    const res2 = await request(api()).post(`/api/production-orders/${o2.id}/cancel`).set(auth(adminToken));
    expect(res2.status).toBe(409);
    expect(res2.body.message).toContain('下达');
  });

  it('删除有工单的订单 → 409；删除无工单订单 → 200', async () => {
    const o1 = await createOrder('PO-E2E-DEL1', 100, '2027-01-01');
    await splitOrder(o1.id, [{ qty: 100 }]);
    expect((await request(api()).delete(`/api/production-orders/${o1.id}`).set(auth(adminToken))).status).toBe(409);
    const o2 = await createOrder('PO-E2E-DEL2', 100, '2027-01-01');
    expect((await request(api()).delete(`/api/production-orders/${o2.id}`).set(auth(adminToken))).status).toBe(200);
  });

  it('排产视图 GET /schedule：按产线分组返回窗口内已排工单', async () => {
    await oneWoOrder('PO-E2E-V', 100, '2027-01-01', 1, wcA);
    await request(api()).post('/api/schedule/run').set(auth(adminToken)).send({ from: '2026-10-12', workCenterIds: [wcA] });
    const res = await request(api()).get('/api/schedule').set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.groups).toHaveLength(1);
    expect(res.body.data.groups[0].workCenterId).toBe(wcA);
  });

  // ---- 权限 ----

  it('权限：planner 可拆分与排产；operator 403；匿名 401', async () => {
    const plannerToken = (await login(app, 'planner', 'User@123')).accessToken;
    const operatorToken = (await login(app, 'operator', 'User@123')).accessToken;
    const maintainerToken = (await login(app, 'maintainer', 'User@123')).accessToken;
    const o = await createOrder('PO-E2E-P', 100, '2027-01-01');
    expect((await request(api()).post(`/api/production-orders/${o.id}/split`).set(auth(plannerToken)).send({ splits: [{ qty: 100 }] })).status).toBe(201);
    expect((await request(api()).post('/api/schedule/run').set(auth(plannerToken)).send({ from: '2026-10-12' })).status).toBe(201);
    expect((await request(api()).post('/api/schedule/run').set(auth(operatorToken)).send({ from: '2026-10-12' })).status).toBe(403);
    expect((await request(api()).post('/api/schedule/run').send({ from: '2026-10-12' })).status).toBe(401);
    expect((await request(api()).get('/api/work-orders').set(auth(maintainerToken))).status).toBe(403);
  });
});
