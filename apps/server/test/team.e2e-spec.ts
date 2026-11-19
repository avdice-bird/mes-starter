import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, resetDb, seedRbacForTest, login } from './helpers/app';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * 第 24 节【磨】班组人员边界用例（12 条，编号对应任务卡）。
 * 班次时间按工厂时区（Asia/Shanghai，偏移 +8）判断。
 */
describe('Shift/Team/Employee 边界（第 24 节）', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let wcId: number;

  const createShift = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/api/shifts').set('Authorization', `Bearer ${adminToken}`).send(body);

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => { await app.close(); });

  let teamA: number; let teamB: number;

  beforeEach(async () => {
    await resetDb(prisma);
    await seedRbacForTest(prisma);
    adminToken = (await login(app, 'admin', 'Admin@123')).accessToken;
    const cat = await prisma.materialCategory.create({ data: { code: 'TM_CAT', name: 'x' } });
    const unit = await prisma.unit.create({ data: { code: 'TM_U', name: 'x' } });
    wcId = (await prisma.workCenter.create({ data: { code: 'TM_WC', name: '工作中心' } })).id;
    const m = await prisma.material.create({ data: { code: 'TM_M', name: 'x', type: 'FINISHED', categoryId: cat.id, unitId: unit.id } });
    // 班组需要工作中心存在即可；m 物料供后续用
    void m;
    teamA = (await prisma.team.create({ data: { code: 'TEAM-A', name: '甲班', workCenterId: wcId } })).id;
    teamB = (await prisma.team.create({ data: { code: 'TEAM-B', name: '乙班', workCenterId: wcId } })).id;
  });

  // ---- 班次边界（用例 1-4、12） ----

  it('用例1：晚班 00:00–08:00，查 23:30 → 非晚班（中/早班或 null），查 00:30 → 晚班', async () => {
    await createShift({ code: 'SH-N', name: '晚班', startTime: '00:00', endTime: '08:00' });
    await createShift({ code: 'SH-M', name: '中班', startTime: '16:00', endTime: '23:59' });
    // 00:30 北京 = UTC 前一日 16:30
    const r1 = await request(app.getHttpServer())
      .get('/api/shifts/current?at=2026-06-01T00%3A30%3A00%2B08%3A00').set('Authorization', `Bearer ${adminToken}`);
    expect(r1.body.data.shift.name).toBe('晚班');
    // 23:30 北京 = UTC 15:30
    const r2 = await request(app.getHttpServer())
      .get('/api/shifts/current?at=2026-06-01T23%3A30%3A00%2B08%3A00').set('Authorization', `Bearer ${adminToken}`);
    expect(r2.body.data.shift?.name).toBe('中班');
  });

  it('用例2：跨天班次 22:00–06:00，查 23:00 和 05:00 都命中', async () => {
    // 先建不重叠的早班，保证 22:00-06:00 可建
    await createShift({ code: 'SH-D', name: '白班', startTime: '08:00', endTime: '16:00' });
    const res = await createShift({ code: 'SH-N', name: '夜班', startTime: '22:00', endTime: '06:00' });
    expect(res.status).toBe(201);
    expect(res.body.data.crossDay).toBe(true);
    const at23 = await request(app.getHttpServer())
      .get('/api/shifts/current?at=2026-06-01T23%3A00%3A00%2B08%3A00').set('Authorization', `Bearer ${adminToken}`);
    const at05 = await request(app.getHttpServer())
      .get('/api/shifts/current?at=2026-06-02T05%3A00%3A00%2B08%3A00').set('Authorization', `Bearer ${adminToken}`);
    expect(at23.body.data.shift?.name).toBe('夜班');
    expect(at05.body.data.shift?.name).toBe('夜班');
  });

  it('用例3：两个班次时间重叠 → 409', async () => {
    await createShift({ code: 'SH-A', name: '早班', startTime: '08:00', endTime: '16:00' });
    const res = await createShift({ code: 'SH-B', name: '冲突班', startTime: '15:00', endTime: '20:00' });
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('重叠');
  });

  it('用例4：空档允许；current 在空档返回 null', async () => {
    await createShift({ code: 'SH-A', name: '早班', startTime: '08:00', endTime: '12:00' });
    // 12:00-24:00 无班次 → 空档
    const res = await request(app.getHttpServer())
      .get('/api/shifts/current?at=2026-06-01T15%3A00%3A00%2B08%3A00').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.shift).toBeNull();
  });

  // ---- 班组/员工边界（用例 5-12） ----

  async function makeEmployee(code: string, teamId: number) {
    return prisma.employee.create({ data: { code, name: code, teamId } });
  }

  it('用例5：调组 → teamId 更新且有 EmployeeTransfer 记录', async () => {
    const emp = await makeEmployee('EMP001', teamA);
    const res = await request(app.getHttpServer())
      .post(`/api/employees/${emp.id}/transfer`).set('Authorization', `Bearer ${adminToken}`)
      .send({ toTeamId: teamB });
    expect(res.status).toBe(200);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: emp.id } })).teamId).toBe(teamB);
    const transfers = await prisma.employeeTransfer.findMany({ where: { employeeId: emp.id } });
    expect(transfers).toHaveLength(1);
    expect(transfers[0].fromTeamId).toBe(teamA);
    expect(transfers[0].toTeamId).toBe(teamB);
  });

  it('用例6：离职 → LEFT，不在 ACTIVE 列表，详情可查', async () => {
    const emp = await makeEmployee('EMP002', teamA);
    const res = await request(app.getHttpServer())
      .post(`/api/employees/${emp.id}/leave`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('LEFT');
    const activeList = await request(app.getHttpServer())
      .get('/api/employees?status=ACTIVE').set('Authorization', `Bearer ${adminToken}`);
    expect(activeList.body.data.list.some((e: { id: number }) => e.id === emp.id)).toBe(false);
    const detail = await request(app.getHttpServer())
      .get(`/api/employees/${emp.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(detail.status).toBe(200); // 历史可见
  });

  it('用例7：离职员工再入职 → ACTIVE，工号不变', async () => {
    const emp = await makeEmployee('EMP003', teamA);
    await request(app.getHttpServer()).post(`/api/employees/${emp.id}/leave`).set('Authorization', `Bearer ${adminToken}`);
    const res = await request(app.getHttpServer())
      .post(`/api/employees/${emp.id}/rehire`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ACTIVE');
    expect(res.body.data.code).toBe('EMP003');
    expect(res.body.data.leftAt).toBeNull();
  });

  it('用例8：工号重复 → 409', async () => {
    await makeEmployee('EMP004', teamA);
    const res = await request(app.getHttpServer())
      .post('/api/employees').set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'EMP004', name: '重复工号', teamId: teamB });
    expect(res.status).toBe(409);
  });

  it('用例9：删除有员工的班组 → 409', async () => {
    await makeEmployee('EMP005', teamA);
    const res = await request(app.getHttpServer())
      .delete(`/api/teams/${teamA}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('员工');
  });

  it('用例10：组长不属于该班组 → 拒绝', async () => {
    const leader = await makeEmployee('EMP006', teamA);
    const res = await request(app.getHttpServer())
      .patch(`/api/teams/${teamB}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ leaderId: leader.id });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('不属于');
  });

  it('用例11：userId 已被其他员工关联 → 409', async () => {
    const user = await prisma.user.findFirstOrThrow({ where: { username: 'operator' } });
    await prisma.employee.create({ data: { code: 'EMP007', name: '有关联', teamId: teamA, userId: user.id } });
    const res = await request(app.getHttpServer())
      .post('/api/employees').set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'EMP008', name: '再关联', teamId: teamB, userId: user.id });
    expect(res.status).toBe(409);
  });

  it('用例12：服务器 UTC 时区下，工厂本地 10:00 判为早班（时区处理）', async () => {
    // 本测试进程由 jest-e2e setup 设 NODE_ENV=test；服务器时区可能是本机时区。
    // 显式断言：factoryLocal 用固定偏移（+8 Asia/Shanghai），不依赖 process.env.TZ。
    await createShift({ code: 'SH-A', name: '早班', startTime: '08:00', endTime: '16:00' });
    // 北京 10:00 = UTC 02:00
    const res = await request(app.getHttpServer())
      .get('/api/shifts/current?at=2026-06-01T02%3A00%3A00Z').set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.data.shift?.name).toBe('早班');
  });
});
