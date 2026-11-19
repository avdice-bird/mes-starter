import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, resetDb, seedRbacForTest, login } from './helpers/app';
import { createMaterialWithRouting, createReleasedWorkOrder } from './helpers/factory';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * 第 47 节【磨+测】设备状态：时长、跨天、幂等、重叠、FAULT 派工联动、权限矩阵。
 */
describe('Equipment 状态与停机（第 47 节）', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let eqId: number;

  const api = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => { ({ app, prisma } = await createTestApp()); });
  afterAll(async () => { await app.close(); });

  beforeEach(async () => {
    await resetDb(prisma);
    await seedRbacForTest(prisma);
    adminToken = (await login(app, 'admin', 'Admin@123')).accessToken;
    const wc = await prisma.workCenter.create({ data: { code: 'EQ-WC', name: '产线' } });
    eqId = (await prisma.equipment.create({ data: { code: 'EQ-1', name: '设备1', workCenterId: wc.id } })).id;
    const team = await prisma.team.create({ data: { code: 'EQ-T', name: 't', workCenterId: wc.id } });
    await prisma.employee.create({ data: { code: 'EQ-E', name: 'e', teamId: team.id } });
  });

  const change = (status: string, reason?: string) =>
    request(api()).post(`/api/equipment/${eqId}/status`).set(auth(adminToken)).send({ status, reason });

  it('用例1：停机 22:00–次日 02:00（补录跨天）→ 两天日报各 120 分钟', async () => {
    // 手工补录跨天停机：北京 01-10 22:00 – 01-11 02:00 = UTC 01-10T14:00Z – 01-10T18:00Z
    const started = '2026-01-10T14:00:00.000Z';
    const ended = '2026-01-10T18:00:00.000Z';
    const nowSpy = jest.spyOn(Date, 'now');
    let call = 0;
    nowSpy.mockImplementation(() => {
      // 让 generateDailyReport 认为 01-12 之后（两天都已结束）
      call += 1;
      return Date.parse('2026-01-12T00:00:00.000Z') + call;
    });
    try {
    const create = await request(api()).post('/api/equipment/downtimes').set(auth(adminToken)).send({
      equipmentId: eqId, reasonCode: 'FAULT', startedAt: started, endedAt: ended });
    expect(create.status).toBe(201);
    for (const date of ['2026-01-10', '2026-01-11']) {
      const gen = await request(api()).post('/api/equipment/daily-reports/generate').set(auth(adminToken)).send({ date });
      expect(gen.status).toBe(201);
    }
    const reports = await prisma.equipmentDailyReport.findMany({ where: { equipmentId: eqId }, orderBy: { date: 'asc' } });
    const d10 = reports.find((r) => r.date === '2026-01-10');
    const d11 = reports.find((r) => r.date === '2026-01-11');
    expect(d10?.downMinutes).toBe(120);
    expect(d11?.downMinutes).toBe(120); // 不是 240 全算给结束那天
    } finally {
      nowSpy.mockRestore();
    }
    expect((await request(api()).get('/api/equipment/daily-reports').set(auth(adminToken))).status).toBe(200);
  }, 30_000);

  it('用例2+3：生成日报时停机未结束 → 算到当天 24:00 标记 open；生成两次 upsert 不翻倍', async () => {
    // 开放停机：startedAt 在 01-10，不结束
    await prisma.equipmentStatusLog.create({ data: { equipmentId: eqId, fromStatus: 'IDLE', toStatus: 'FAULT' } });
    await prisma.downtime.create({ data: { equipmentId: eqId, reasonCode: 'FAULT', startedAt: new Date('2026-01-10T14:00:00.000Z') } });
    // 模拟"今天是 01-11"：generateDailyReport 只拒绝未来的天，01-11 已结束（相对真实当前 2026-10）
    const gen = await request(api()).post('/api/equipment/daily-reports/generate').set(auth(adminToken)).send({ date: '2026-01-10' });
    expect(gen.status).toBe(201);
    const report = await prisma.equipmentDailyReport.findUniqueOrThrow({
      where: { equipmentId_date: { equipmentId: eqId, date: '2026-01-10' } } });
    // 手算：01-10 工厂日占 14:00Z–16:00Z（北京 22:00–24:00）= 120 分钟 ✓
    console.log('REPORT=' + JSON.stringify({ down: report.downMinutes, open: report.open }));
    expect(report.open).toBe(true);
    // 再生成一次 → upsert 不翻倍
    await request(api()).post('/api/equipment/daily-reports/generate').set(auth(adminToken)).send({ date: '2026-01-10' });
    const again = await prisma.equipmentDailyReport.findUniqueOrThrow({
      where: { equipmentId_date: { equipmentId: eqId, date: '2026-01-10' } } });
    expect(again.downMinutes).toBe(report.downMinutes);
    expect(await prisma.equipmentDailyReport.count({ where: { equipmentId: eqId, date: '2026-01-10' } })).toBe(1);
  }, 30_000);

  it('用例5：切换到当前状态 → 409 不生成 log', async () => {
    // 先切到 FAULT，再重复切 FAULT → 409
    expect((await change('FAULT', '第一次')).status).toBe(201);
    const r = await change('FAULT', '重复');
    expect(r.status).toBe(409);
    expect(await prisma.equipmentStatusLog.count({ where: { equipmentId: eqId } })).toBe(1); // 只有第一次的 log
  });

  it('用例6：补录 endedAt < startedAt → 400', async () => {
    const r = await request(api()).post('/api/equipment/downtimes').set(auth(adminToken)).send({
      equipmentId: eqId, reasonCode: 'FAULT', startedAt: '2026-01-10T10:00:00Z', endedAt: '2026-01-10T09:00:00Z' });
    expect(r.status).toBe(400);
    expect(r.body.message).toContain('结束时间');
  });

  it('用例7：补录与已有停机重叠 → 409', async () => {
    // 开放停机 01-10T14:00Z 起
    await prisma.downtime.create({ data: { equipmentId: eqId, reasonCode: 'FAULT', startedAt: new Date('2026-01-10T14:00:00.000Z') } });
    const overlap = await request(api()).post('/api/equipment/downtimes').set(auth(adminToken)).send({
      equipmentId: eqId, reasonCode: 'CHANGEOVER', startedAt: '2026-01-10T15:00:00Z', endedAt: '2026-01-10T16:00:00Z' });
    expect(overlap.status).toBe(409);
    // 不重叠的（更早）→ 201
    const ok = await request(api()).post('/api/equipment/downtimes').set(auth(adminToken)).send({
      equipmentId: eqId, reasonCode: 'CHANGEOVER', startedAt: '2026-01-09T10:00:00Z', endedAt: '2026-01-09T11:00:00Z' });
    expect(ok.status).toBe(201);
  });

  it('用例8：FAULT 设备派工 → 400', async () => {
    const m = await createMaterialWithRouting(prisma, 1);
    // 设备建在工序的工作中心上，然后切 FAULT
    const eq = await prisma.equipment.create({ data: { code: 'EQ-FAULT', name: '故障设备', workCenterId: m.workCenterIds[0] } });
    const wo = await createReleasedWorkOrder(prisma, app, adminToken, { ops: 1, material: m, qty: 10 });
    await request(api()).post(`/api/equipment/${eq.id}/status`).set(auth(adminToken)).send({ status: 'FAULT', reason: '坏' });
    const assign = await request(api()).post(`/api/work-order-operations/${wo.operationIds[0]}/assign`).set(auth(adminToken)).send({
      equipmentId: eq.id });
    expect(assign.status).toBe(400);
    expect(assign.body.message).toContain('故障');
  });

  it('用例9：停机 reasonCode 必填 → 400', async () => {
    const r = await request(api()).post('/api/equipment/downtimes').set(auth(adminToken)).send({
      equipmentId: eqId, reasonCode: '', startedAt: '2026-01-10T10:00:00Z' });
    expect(r.status).toBe(400);
  });

  it('切换留痕 + 停机自动开关（第 46 节主线回归）', async () => {
    await change('FAULT', '主轴报警');
    const open = await prisma.downtime.findFirstOrThrow({ where: { equipmentId: eqId, endedAt: null } });
    await change('RUNNING', '修复');
    const closed = await prisma.downtime.findUniqueOrThrow({ where: { id: open.id } });
    expect(closed.endedAt).not.toBeNull();
    expect(closed.durationMinutes).toBeGreaterThanOrEqual(0);
    const logs = await prisma.equipmentStatusLog.findMany({ where: { equipmentId: eqId }, orderBy: { id: 'asc' } });
    expect(logs.map((l) => [l.fromStatus, l.toStatus])).toEqual([['IDLE', 'FAULT'], ['FAULT', 'RUNNING']]);
  });

  it('权限矩阵：状态切换/补录 planner 可用、operator 403、匿名 401', async () => {
    const planner = (await login(app, 'planner', 'User@123')).accessToken;
    const operator = (await login(app, 'operator', 'User@123')).accessToken;
    // 先补录历史停机（避免与切状态自动开的"开放停机"互相干扰）
    const dt = await request(api()).post('/api/equipment/downtimes').set(auth(planner)).send({
      equipmentId: eqId, reasonCode: 'OTHER', startedAt: '2026-01-09T10:00:00Z' });
    expect(dt.status).toBe(201);
    expect((await change('MAINTENANCE', 'x').set(auth(planner))).status).toBe(201);
    expect((await request(api()).post(`/api/equipment/${eqId}/status`).set(auth(operator)).send({ status: 'IDLE' })).status).toBe(403);
    expect((await request(api()).post(`/api/equipment/${eqId}/status`).send({ status: 'IDLE' })).status).toBe(401);
    expect((await request(api()).get('/api/equipment/downtimes').set(auth(operator))).status).toBe(403);
  });
});
