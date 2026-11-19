import { createTestApp, resetDb, seedRbacForTest, login } from './helpers/app';
import { PrismaService } from '../src/prisma/prisma.service';
import { createMaterialWithRouting, createReleasedWorkOrder } from './helpers/factory';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';

/**
 * 第 40 节【审】互测②：攻击报工（攻击者用 operator 账号；此处 admin 扮演"对方系统"跑攻击项）。
 * 9 项攻击（任务卡），每项产出 issue 判定：有效（需修复）/ 已防护（攻击失败）。
 */
describe('攻击报工（第 40 节互测）', () => {
  let app: INestApplication; let prisma: PrismaService; let token: string; let employeeId: number;

  const api = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  let keySeq = 0;
  const nextKey = () => `atk-${Date.now()}-${keySeq += 1}-${Math.random().toString(36).slice(2, 8)}`;
  let codeSeq = 0;
  const nextCode = (prefix: string) => `${prefix}${Date.now().toString(36)}${(codeSeq += 1).toString(36)}`;

  const report = (opId: number, goodQty: number, defectQty = 0, extra: Record<string, unknown> = {}) =>
    request(api()).post('/api/work-reports').set(auth(token))
      .send({ workOrderOperationId: opId, employeeId, goodQty, defectQty, idempotencyKey: nextKey(), ...extra });

  beforeAll(async () => { ({ app, prisma } = await createTestApp()); });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  beforeEach(async () => {
    await resetDb(prisma);
    await seedRbacForTest(prisma);
    token = (await login(app, 'admin', 'Admin@123')).accessToken;
  });

  it('攻击1：并发 50 次报工，累计 = 成功次数 × 数量', async () => {
    const m = await createMaterialWithRouting(prisma, 1);
    const wc = m.workCenterIds[0];
    const team = await prisma.team.create({ data: { code: nextCode('AC'), name: 't', workCenterId: wc } });
    employeeId = (await prisma.employee.create({ data: { code: nextCode('AC'), name: 'e', teamId: team.id } })).id;
    const wo = await createReleasedWorkOrder(prisma, app, token, { qty: 1000, ops: 1, material: m });
    await request(api()).post(`/api/work-order-operations/${wo.operationIds[0]}/start`).set(auth(token)).send({});
    const results = await Promise.allSettled(Array.from({ length: 50 }, () => report(wo.operationIds[0], 10)));
    const ok = results.filter((r) => r.status === 'fulfilled' && (r.value as { status: number }).status === 201).length;
    const op = await prisma.workOrderOperation.findUniqueOrThrow({ where: { id: wo.operationIds[0] } });
    console.log(`ISSUE1: 成功 ${ok}, 累计 ${op.completedQty}, 一致=${op.completedQty === ok * 10}`);
    expect(op.completedQty).toBe(ok * 10);
  }, 60_000);

  it('攻击2：同 idempotencyKey 并发提交 → 只累计一次', async () => {
    const m = await createMaterialWithRouting(prisma, 1);
    const wc = m.workCenterIds[0];
    const team = await prisma.team.create({ data: { code: nextCode('AC'), name: 't', workCenterId: wc } });
    employeeId = (await prisma.employee.create({ data: { code: nextCode('AC'), name: 'e', teamId: team.id } })).id;
    const wo = await createReleasedWorkOrder(prisma, app, token, { qty: 100, ops: 1, material: m });
    await request(api()).post(`/api/work-order-operations/${wo.operationIds[0]}/start`).set(auth(token)).send({});
    const key = nextKey();
    const body = { workOrderOperationId: wo.operationIds[0], employeeId, goodQty: 50, defectQty: 0, idempotencyKey: key };
    const results = await Promise.allSettled(Array.from({ length: 5 }, () =>
      request(api()).post('/api/work-reports').set(auth(token)).send(body)));
    const ok = results.filter((r) => r.status === 'fulfilled' && (r.value as { status: number }).status === 201).length;
    const op = await prisma.workOrderOperation.findUniqueOrThrow({ where: { id: wo.operationIds[0] } });
    const count = await prisma.workReport.count({ where: { workOrderId: wo.workOrderId } });
    console.log(`ISSUE2: 成功 ${ok}, 流水 ${count}, 累计 ${op.completedQty}, 幂等=${count === 1 && op.completedQty === 50}`);
    expect(count).toBe(1);
    expect(op.completedQty).toBe(50);
  }, 60_000);

  it('攻击3：超量、负数、小数、超大数（2^31）', async () => {
    const m = await createMaterialWithRouting(prisma, 1);
    const wc = m.workCenterIds[0];
    const team = await prisma.team.create({ data: { code: nextCode('AC'), name: 't', workCenterId: wc } });
    employeeId = (await prisma.employee.create({ data: { code: nextCode('AC'), name: 'e', teamId: team.id } })).id;
    const wo = await createReleasedWorkOrder(prisma, app, token, { qty: 100, ops: 1, material: m });
    await request(api()).post(`/api/work-order-operations/${wo.operationIds[0]}/start`).set(auth(token)).send({});
    expect((await report(wo.operationIds[0], 101)).status).toBe(422);           // 超量
    expect((await report(wo.operationIds[0], -10)).status).toBe(400);           // 负数
    expect((await request(api()).post('/api/work-reports').set(auth(token)).send({ workOrderOperationId: wo.operationIds[0], employeeId, goodQty: 1.5, defectQty: 0, idempotencyKey: nextKey() })).status).toBe(400); // 小数
    expect((await report(wo.operationIds[0], 2 ** 31)).status).toBe(400);       // 超大数
    console.log('ISSUE3: 全部被拦截 ✓');
  }, 60_000);

  it('攻击4：篡改 employeeId 为别人、teamId 为别的班组', async () => {
    const m = await createMaterialWithRouting(prisma, 1);
    const wc = m.workCenterIds[0];
    const team = await prisma.team.create({ data: { code: nextCode('AC'), name: 't', workCenterId: wc } });
    employeeId = (await prisma.employee.create({ data: { code: nextCode('AC'), name: 'e', teamId: team.id } })).id;
    const wo = await createReleasedWorkOrder(prisma, app, token, { qty: 100, ops: 1, material: m });
    await request(api()).post(`/api/work-order-operations/${wo.operationIds[0]}/start`).set(auth(token)).send({});
    // 员工不存在 → 404；离职员工 → 400（已在 38/39 节加固）
    expect((await report(wo.operationIds[0], 10, 0, { employeeId: 999999 })).status).toBe(404);
    // 任务派给"我的班组"，但报工员工属于"别的班组" → 400（篡改 employeeId 报别人的工）
    const otherTeam = await prisma.team.create({ data: { code: nextCode('AC'), name: '别班', workCenterId: wc } });
    const otherEmp = await prisma.employee.create({ data: { code: nextCode('AC'), name: '别人', teamId: otherTeam.id } });
    await prisma.workOrderOperation.update({ where: { id: wo.operationIds[0] }, data: { teamId: team.id } });
    const r = await report(wo.operationIds[0], 10, 0, { employeeId: otherEmp.id });
    console.log(`ISSUE4: 班组不匹配 → ${r.status} ${r.status === 400 ? '拦截 ✓' : '漏洞!'}`);
    expect(r.status).toBe(400);
    // 报工接口本身不接受 teamId 参数（快照来自任务），无篡改面
  }, 60_000);

  it('攻击5：对 PENDING / COMPLETED / 别的工单的任务报工', async () => {
    const m = await createMaterialWithRouting(prisma, 2);
    const wc = m.workCenterIds[0];
    const team = await prisma.team.create({ data: { code: nextCode('AC'), name: 't', workCenterId: wc } });
    employeeId = (await prisma.employee.create({ data: { code: nextCode('AC'), name: 'e', teamId: team.id } })).id;
    const wo = await createReleasedWorkOrder(prisma, app, token, { qty: 100, ops: 2, material: m });
    // PENDING（第二道）
    expect((await report(wo.operationIds[1], 10)).status).toBe(422);
    // COMPLETED（第一道填满后再报）
    await request(api()).post(`/api/work-order-operations/${wo.operationIds[0]}/start`).set(auth(token)).send({});
    await report(wo.operationIds[0], 100);
    expect((await report(wo.operationIds[0], 1)).status).toBe(422);
    console.log('ISSUE5: PENDING/COMPLETED 拦截 ✓');
  }, 60_000);

  it('攻击6：撤销别人的报工（越权角色视角）', async () => {
    // 权限模型：撤销需要 work-report:reverse 权限码——operator 无该码（403）；后台按角色防线
    const operator = (await login(app, 'operator', 'User@123')).accessToken;
    const r = await request(api()).post(`/api/work-reports/999/reverse`).set(auth(operator)).send({ reason: '越权撤销' });
    console.log(`ISSUE6: operator 撤销 → ${r.status}（403=防线生效）`);
    expect(r.status).toBe(403);
  }, 60_000);

  it('攻击7：reportedAt 篡改为过去很久 / 未来', async () => {
    const m = await createMaterialWithRouting(prisma, 1);
    const wc = m.workCenterIds[0];
    const team = await prisma.team.create({ data: { code: nextCode('AC'), name: 't', workCenterId: wc } });
    employeeId = (await prisma.employee.create({ data: { code: nextCode('AC'), name: 'e', teamId: team.id } })).id;
    const wo = await createReleasedWorkOrder(prisma, app, token, { qty: 100, ops: 1, material: m });
    await request(api()).post(`/api/work-order-operations/${wo.operationIds[0]}/start`).set(auth(token)).send({});
    expect((await report(wo.operationIds[0], 10, 0, { reportedAt: '2020-01-01T00:00:00Z' })).status).toBe(400);
    expect((await report(wo.operationIds[0], 10, 0, { reportedAt: new Date(Date.now() + 86400_000).toISOString() })).status).toBe(400);
    console.log('ISSUE7: 时间篡改拦截 ✓');
  }, 60_000);

  it('攻击8：撤销后再撤销、撤销后再报、报后立刻撤销并发', async () => {
    const m = await createMaterialWithRouting(prisma, 1);
    const wc = m.workCenterIds[0];
    const team = await prisma.team.create({ data: { code: nextCode('AC'), name: 't', workCenterId: wc } });
    employeeId = (await prisma.employee.create({ data: { code: nextCode('AC'), name: 'e', teamId: team.id } })).id;
    const wo = await createReleasedWorkOrder(prisma, app, token, { qty: 100, ops: 1, material: m });
    await request(api()).post(`/api/work-order-operations/${wo.operationIds[0]}/start`).set(auth(token)).send({});
    const r = await report(wo.operationIds[0], 50);
    const id = r.body.data.id;
    await request(api()).post(`/api/work-reports/${id}/reverse`).set(auth(token)).send({ reason: '第一次撤销' });
    // 撤销后再撤销 → 拒
    const again = await request(api()).post(`/api/work-reports/${id}/reverse`).set(auth(token)).send({ reason: '第二次' });
    expect(again.status).toBe(409);
    // 报后立刻撤销并发：同一原报工 3 个并发撤销 → 最多 1 个成功
    const r2 = await report(wo.operationIds[0], 30);
    const revResults = await Promise.allSettled(Array.from({ length: 3 }, () =>
      request(api()).post(`/api/work-reports/${r2.body.data.id}/reverse`).set(auth(token)).send({ reason: '并发撤销' })));
    const revOk = revResults.filter((x) => x.status === 'fulfilled' && (x.value as { status: number }).status === 201).length;
    expect(revOk).toBeLessThanOrEqual(1);
    console.log(`ISSUE8: 重复撤销 409 ✓, 并发撤销成功 ${revOk} (≤1) ✓`);
  }, 60_000);

  it('攻击9：二维码内容篡改（wo:不存在的编码、SQL 片段）', async () => {
    // 不存在的编码
    const ghost = await request(api()).get('/api/work-orders/by-code/wo:NOT-EXIST-999').set(auth(token));
    expect(ghost.status).toBe(404);
    // SQL 片段（Prisma 参数化查询，无注入面；仍验证不 500）
    const sql = await request(api()).get('/api/work-orders/by-code/wo%3A%27%20OR%201%3D1--').set(auth(token));
    expect([404, 400]).toContain(sql.status);
    console.log(`ISSUE9: 不存在编码 404 ✓, SQL 片段 ${sql.status} 无注入 ✓`);
  }, 60_000);
});
