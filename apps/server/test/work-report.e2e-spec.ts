import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, resetDb, seedRbacForTest, login } from './helpers/app';
import { PrismaService } from '../src/prisma/prisma.service';
import { createMaterialWithRouting, createReleasedWorkOrder } from './helpers/factory';

/**
 * 第 38-39 节【测】报工并发、幂等、数量边界、撤销。
 * SQLite 写串行化：并发实际是排队，断言口径"成功数 × 数量 = 累计"且无重复流水。
 */
describe('WorkReport 并发/幂等/数量（第 38-39 节）', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let employeeId: number;

  const api = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const op = (id: number) => prisma.workOrderOperation.findUniqueOrThrow({ where: { id } });

  let keySeq = 0;
  const nextKey = () => `wr-${Date.now()}-${keySeq += 1}-${Math.random().toString(36).slice(2, 8)}`;

  /** 报工快捷调用 */
  const report = (opId: number, goodQty: number, defectQty = 0, extra: Record<string, unknown> = {}) =>
    request(api()).post('/api/work-reports').set(auth(adminToken))
      .send({ workOrderOperationId: opId, employeeId, goodQty, defectQty, idempotencyKey: nextKey(), ...extra });

  /** 已下达+首道已开工的工单；报工员工挂在首个工作中心（factory 建完后） */
  async function setup(ops = 2, qty = 100) {
    const material = await createMaterialWithRouting(prisma, ops);
    const team = await prisma.team.create({ data: { code: nextKey().slice(0, 10), name: '报工班', workCenterId: material.workCenterIds[0] } });
    employeeId = (await prisma.employee.create({ data: { code: nextKey().slice(0, 10), name: '报工工', teamId: team.id } })).id;
    const wo = await createReleasedWorkOrder(prisma, app, adminToken, { qty, ops, material });
    await request(api()).post(`/api/work-order-operations/${wo.operationIds[0]}/start`).set(auth(adminToken)).send({});
    return wo;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => { await app.close(); });

  beforeEach(async () => {
    await resetDb(prisma);
    await seedRbacForTest(prisma);
    adminToken = (await login(app, 'admin', 'Admin@123')).accessToken;
    // 班次种子（报工班次快照用）：早班 08:00-16:00（工厂时区）
    await prisma.shift.create({ data: { code: 'WR-S1', name: '常白班', startTime: '00:00', endTime: '23:59' } });
  });

  it('正常报工：流水 1 条、任务累计正确、班次快照正确', async () => {
    const wo = await setup(2);
    const r = await report(wo.operationIds[0], 30, 2, { workMinutes: 30 });
    expect(r.status).toBe(201);
    const reports = await prisma.workReport.findMany({ where: { workOrderId: wo.workOrderId } });
    expect(reports).toHaveLength(1);
    expect(reports[0].shiftId).not.toBeNull(); // 班次种子（seed-master）有 3 班次
    expect(await op(wo.operationIds[0])).toMatchObject({ completedQty: 30, defectQty: 2 });
  });

  it('幂等：同 key 两次提交 → 同一条记录 id，流水 1 条，累计不重复', async () => {
    const wo = await setup(2);
    const key = nextKey();
    const body = { workOrderOperationId: wo.operationIds[0], employeeId, goodQty: 30, defectQty: 0, idempotencyKey: key };
    const r1 = await request(api()).post('/api/work-reports').set(auth(adminToken)).send(body);
    const r2 = await request(api()).post('/api/work-reports').set(auth(adminToken)).send(body);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r2.body.data.id).toBe(r1.body.data.id); // 返回同一条
    expect(await prisma.workReport.count({ where: { workOrderId: wo.workOrderId } })).toBe(1);
    expect((await op(wo.operationIds[0])).completedQty).toBe(30);
  });

  it('并发 10 次各 10 件（不同 key）→ 成功数 ×10 = 累计，无重复流水', async () => {
    const wo = await setup(2);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => report(wo.operationIds[0], 10)),
    );
    const ok = results.filter((r) => r.status === 'fulfilled' && (r.value as { status: number }).status === 201);
    const fail = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok.length + fail.length).toBe(10);
    // 100 = 10×10，未超量，全部应成功
    expect(ok.length).toBe(10);
    const reports = await prisma.workReport.findMany({ where: { workOrderId: wo.workOrderId, goodQty: { gt: 0 } } });
    expect(reports).toHaveLength(10);
    expect((await op(wo.operationIds[0])).completedQty).toBe(100);
    void fail;
  });

  it('超量 → 2002（容差 0%）', async () => {
    const wo = await setup(2);
    await report(wo.operationIds[0], 60);
    const over = await report(wo.operationIds[0], 41);
    expect(over.status).toBe(422);
    expect(over.body.code).toBe(2002);
  });

  it('0/0、负数、超大批量 → 400', async () => {
    const wo = await setup(2);
    const zero = await report(wo.operationIds[0], 0, 0);
    expect(zero.status).toBe(400);
    const neg = await report(wo.operationIds[0], -5);
    expect(neg.status).toBe(400);
    const huge = await report(wo.operationIds[0], 2 ** 31);
    expect(huge.status).toBe(400);
  });

  it('小数数量 → 400（数量单位为件，Int）', async () => {
    const wo = await setup(2);
    const r = await request(api()).post('/api/work-reports').set(auth(adminToken))
      .send({ workOrderOperationId: wo.operationIds[0], employeeId, goodQty: 10.5, defectQty: 0, idempotencyKey: nextKey() });
    expect(r.status).toBe(400);
  });

  it('PENDING 任务报工 → 2004；工单 PAUSED → 409', async () => {
    const wo = await setup(2);
    const second = wo.operationIds[1];
    const pending = await report(second, 10);
    expect(pending.status).toBe(422);
    expect(pending.body.code).toBe(2004);
    // PAUSED
    await request(api()).post(`/api/work-orders/${wo.workOrderId}/pause`).set(auth(adminToken)).send({});
    const paused = await report(wo.operationIds[0], 10);
    expect(paused.status).toBe(409);
  });

  it('reportedAt 在未来 → 400；早于下达 → 400', async () => {
    const wo = await setup(2);
    const future = await report(wo.operationIds[0], 10, 0, { reportedAt: new Date(Date.now() + 3600_000).toISOString() });
    expect(future.status).toBe(400);
    const past = await report(wo.operationIds[0], 10, 0, { reportedAt: '2020-01-01T00:00:00Z' });
    expect(past.status).toBe(400);
  });

  it('员工不在派工班组 → 400；任务未派班组 → 不校验', async () => {
    const wo = await setup(2);
    const [first] = wo.operationIds;
    // 未派工 → 不校验
    expect((await report(first, 10)).status).toBe(201);
    // 派工到另一个班组（其他员工），报工用 employeeId → 400
    const otherTeam = await prisma.team.create({ data: { code: 'WR-T2', name: '乙班', workCenterId: wo.routing.workCenterIds[0] } });
    await prisma.workOrderOperation.update({ where: { id: first }, data: { teamId: otherTeam.id } });
    const mismatch = await report(first, 10);
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.message).toContain('班组');
  });

  it('撤销：负数流水、数量回退、状态回退、下道 READY 回 PENDING', async () => {
    const wo = await setup(2);
    const [first, second] = wo.operationIds;
    const r = await report(first, 100);
    expect(r.status).toBe(201);
    expect((await op(first)).status).toBe('COMPLETED');
    expect((await op(second)).status).toBe('READY');
    // 撤销
    const rev = await request(api()).post(`/api/work-reports/${r.body.data.id}/reverse`).set(auth(adminToken)).send({ reason: '录错' });
    expect(rev.status).toBe(201);
    const after = await prisma.workReport.findMany({ where: { workOrderId: wo.workOrderId } });
    expect(after).toHaveLength(2); // 原流水 + 负数流水
    expect(after.find((x) => x.goodQty === -100)).toBeTruthy();
    expect((await op(first)).completedQty).toBe(0);
    expect((await op(first)).status).toBe('IN_PROGRESS');
    expect((await op(second)).status).toBe('PENDING');
  });

  it('撤销已撤销的 → 拒绝；下道已开工 → 拒绝撤销', async () => {
    const wo = await setup(2);
    const [first, second] = wo.operationIds;
    const r = await report(first, 100);
    await request(api()).post(`/api/work-reports/${r.body.data.id}/reverse`).set(auth(adminToken)).send({ reason: 'x' });
    const again = await request(api()).post(`/api/work-reports/${r.body.data.id}/reverse`).set(auth(adminToken)).send({ reason: 'y' });
    expect(again.status).toBe(409);
    // 下道已开工场景
    const r2 = await report(first, 100);
    await request(api()).post(`/api/work-order-operations/${second}/start`).set(auth(adminToken)).send({});
    const revAfterStart = await request(api()).post(`/api/work-reports/${r2.body.data.id}/reverse`).set(auth(adminToken)).send({ reason: 'z' });
    expect(revAfterStart.status).toBe(409);
  });

  it('末道报满 → 工单 completedQty 正确、可 complete', async () => {
    const wo = await setup(2);
    const [first, second] = wo.operationIds;
    await report(first, 100);
    await request(api()).post(`/api/work-order-operations/${second}/start`).set(auth(adminToken)).send({});
    await report(second, 100);
    const detail = await request(api()).get(`/api/work-orders/${wo.workOrderId}/detail`).set(auth(adminToken));
    expect(detail.body.data.allowedActions).toContain('complete');
    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: wo.workOrderId } })).completedQty).toBe(100);
  });

  it('报工超过上道良品数（第 35 节不变量）→ 2002', async () => {
    const wo = await setup(2);
    const [first, second] = wo.operationIds;
    await report(first, 100, 0); // 首道 100 良（需要 defect 0）→ 下道 plannedQty=100
    // 重新造一个上道只有 50 良的场景：首道 60 良 40 不良
    const material = await createMaterialWithRouting(prisma, 2);
    const wo2 = await createReleasedWorkOrder(prisma, app, adminToken, { qty: 100, ops: 2, material });
    await request(api()).post(`/api/work-order-operations/${wo2.operationIds[0]}/start`).set(auth(adminToken)).send({});
    await report(wo2.operationIds[0], 60, 40);
    await request(api()).post(`/api/work-order-operations/${wo2.operationIds[1]}/start`).set(auth(adminToken)).send({});
    // 下道 plannedQty=60，报 70 良 → 超量 2002
    const over = await report(wo2.operationIds[1], 70);
    expect(over.status).toBe(422);
    expect(over.body.code).toBe(2002);
    void second;
  });

  it('篡改 employeeId 为不存在的人 → 404；离职员工 → 400', async () => {
    const wo = await setup(2);
    const ghost = await report(wo.operationIds[0], 10, 0, { employeeId: 99999 });
    expect(ghost.status).toBe(404);
    await prisma.employee.update({ where: { id: employeeId }, data: { status: 'LEFT' } });
    const left = await report(wo.operationIds[0], 10);
    expect(left.status).toBe(400);
    expect(left.body.message).toContain('离职');
  });

  it('二维码：GET /work-orders/:id/qrcode 返回 PNG；by-code 定位工单与可报任务', async () => {
    const wo = await setup(2);
    const qr = await request(api()).get(`/api/work-orders/${wo.workOrderId}/qrcode`).set(auth(adminToken));
    expect(qr.status).toBe(200);
    expect(qr.headers['content-type']).toContain('image/png');
    const code = (await prisma.workOrder.findUniqueOrThrow({ where: { id: wo.workOrderId } })).code;
    const byCode = await request(api()).get(`/api/work-orders/by-code/${code}`).set(auth(adminToken));
    expect(byCode.status).toBe(200);
    expect(byCode.body.data.workOrder.id).toBe(wo.workOrderId);
    expect(byCode.body.data.operations).toHaveLength(1); // 首道 IN_PROGRESS
  });
});
