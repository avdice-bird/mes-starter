import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, resetDb, seedRbacForTest, login } from './helpers/app';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * 第 21 节【磨】工艺路线与设备边界用例（12 条，编号对应任务卡）。
 */
describe('Routing/WorkCenter/Equipment 边界（第 21 节）', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let wcA: number; let wcB: number;
  let matF: number;
  let catId: number; let unitId: number;

  const createRouting = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/api/routings').set('Authorization', `Bearer ${adminToken}`).send(body);
  const saveOps = (id: number, ops: unknown[]) =>
    request(app.getHttpServer()).put(`/api/routings/${id}/operations`).set('Authorization', `Bearer ${adminToken}`).send({ operations: ops });
  const activate = (id: number) =>
    request(app.getHttpServer()).post(`/api/routings/${id}/activate`).set('Authorization', `Bearer ${adminToken}`);

  const op = (seq: number, wcId: number, minutes = 5) => ({
    seq, code: `OP${seq}`, name: `工序${seq}`, workCenterId: wcId, standardMinutes: minutes,
  });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => { await app.close(); });

  beforeEach(async () => {
    await resetDb(prisma);
    await seedRbacForTest(prisma);
    adminToken = (await login(app, 'admin', 'Admin@123')).accessToken;
    const cat = await prisma.materialCategory.create({ data: { code: 'RT_CAT', name: '分类' } });
    const unit = await prisma.unit.create({ data: { code: 'RT_PCS', name: '个' } });
    catId = cat.id; unitId = unit.id;
    matF = (await prisma.material.create({ data: { code: 'RT_FIN', name: '成品', type: 'FINISHED', categoryId: catId, unitId } })).id;
        wcA = (await prisma.workCenter.create({ data: { code: 'WC-A', name: '工作中心A', type: 'LINE' } })).id;
    wcB = (await prisma.workCenter.create({ data: { code: 'WC-B', name: '工作中心B', type: 'CELL' } })).id;
  });

  it('用例1：工序 seq 重复 → 409', async () => {
    const r = (await createRouting({ materialId: matF, version: 'v1' })).body.data;
    const res = await saveOps(r.id, [op(10, wcA), op(10, wcB)]);
    expect(res.status).toBe(409);
  });

  it('用例2：重排接口按给定顺序重写 seq（10/20/30…）', async () => {
    const r = (await createRouting({ materialId: matF, version: 'v1' })).body.data;
    await saveOps(r.id, [op(10, wcA), op(20, wcB), op(30, wcA)]);
    const detail = await getRoutingDetail(r.id);
    const reversed = [...detail.operations].reverse().map((o: { id: number }) => o.id);
    const res = await request(app.getHttpServer())
      .put(`/api/routings/${r.id}/reorder`).set('Authorization', `Bearer ${adminToken}`)
      .send({ orderedIds: reversed });
    expect(res.status).toBe(200);
    expect(res.body.data.operations.map((o: { seq: number }) => o.seq)).toEqual([10, 20, 30]);
    expect(res.body.data.operations[0].code).toBe('OP30'); // 原最后一道变第一道
  });

  it('用例3：修改 ACTIVE 路线的工序 → 409', async () => {
    const r = (await createRouting({ materialId: matF, version: 'v1' })).body.data;
    await saveOps(r.id, [op(10, wcA)]);
    await activate(r.id);
    const res = await saveOps(r.id, [op(10, wcA), op(20, wcB)]);
    expect(res.status).toBe(409);
  });

  it('用例4：复制为新版本：工序数一致、DRAFT、seq 不变', async () => {
    const r = (await createRouting({ materialId: matF, version: 'v1' })).body.data;
    await saveOps(r.id, [op(10, wcA), op(20, wcB)]);
    await activate(r.id);
    const res = await request(app.getHttpServer())
      .post(`/api/routings/${r.id}/copy`).set('Authorization', `Bearer ${adminToken}`)
      .send({ version: 'v2' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.version).toBe('v2');
    expect(res.body.data.operations).toHaveLength(2);
    expect(res.body.data.operations.map((o: { seq: number }) => o.seq)).toEqual([10, 20]);
  });

  it('用例5：激活 v2 后 v1 自动 OBSOLETE；同物料只有一个 ACTIVE', async () => {
    const v1 = (await createRouting({ materialId: matF, version: 'v1' })).body.data;
    const v2 = (await createRouting({ materialId: matF, version: 'v2' })).body.data;
    await saveOps(v1.id, [op(10, wcA)]);
    await saveOps(v2.id, [op(10, wcB)]);
    await activate(v1.id);
    await activate(v2.id);
    expect(await prisma.routing.count({ where: { materialId: matF, status: 'ACTIVE' } })).toBe(1);
    expect((await prisma.routing.findUniqueOrThrow({ where: { id: v1.id } })).status).toBe('OBSOLETE');
  });

  it('用例6：删除有设备的工作中心 → 409', async () => {
    await prisma.equipment.create({ data: { code: 'EQ-1', name: '设备1', workCenterId: wcA } });
    const res = await request(app.getHttpServer()).delete(`/api/work-centers/${wcA}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('设备');
  });

  it('用例7：删除被工序引用的工作中心 → 409', async () => {
    const r = (await createRouting({ materialId: matF, version: 'v1' })).body.data;
    await saveOps(r.id, [op(10, wcB)]);
    const res = await request(app.getHttpServer()).delete(`/api/work-centers/${wcB}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('工序');
  });

  it('用例8：设备转移工作中心 → 允许，且产生审计记录', async () => {
    const eq = await prisma.equipment.create({ data: { code: 'EQ-2', name: '设备2', workCenterId: wcA } });
    const res = await request(app.getHttpServer())
      .patch(`/api/equipments/${eq.id}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ workCenterId: wcB });
    expect(res.status).toBe(200);
    expect(res.body.data.workCenterId).toBe(wcB);
    await new Promise((r) => setTimeout(r, 300)); // 审计异步落库
    const audits = await prisma.auditLog.findMany({ where: { path: `/api/equipments/${eq.id}`, method: 'PATCH' } });
    expect(audits.length).toBeGreaterThan(0);
  });

  it('用例9：路线没有工序时激活 → 409', async () => {
    const r = (await createRouting({ materialId: matF, version: 'v1' })).body.data;
    const res = await activate(r.id);
    expect(res.status).toBe(409);
  });

  it('用例10：标准工时为 0 或负数 → 400', async () => {
    const r = (await createRouting({ materialId: matF, version: 'v1' })).body.data;
    const res = await saveOps(r.id, [{ ...op(10, wcA), standardMinutes: 0 }]);
    expect(res.status).toBe(400);
    const res2 = await saveOps(r.id, [{ ...op(10, wcA), standardMinutes: -5 }]);
    expect(res2.status).toBe(400);
  });

  it('用例11：物料没有 ACTIVE 路线 → active-routing 404 消息明确', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/materials/${matF}/active-routing`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
    expect(res.body.message).toContain('RT_FIN');
  });

  it('用例11b：有 ACTIVE 路线时 active-routing 返回 seq 排序工序', async () => {
    const r = (await createRouting({ materialId: matF, version: 'v1' })).body.data;
    await saveOps(r.id, [op(30, wcA), op(10, wcB), op(20, wcA)]);
    await activate(r.id);
    const res = await request(app.getHttpServer())
      .get(`/api/materials/${matF}/active-routing`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.operations.map((o: { seq: number }) => o.seq)).toEqual([10, 20, 30]);
  });

  it('用例12：物料被路线引用时删除 → 409（补第 14 节预留）', async () => {
    const r = (await createRouting({ materialId: matF, version: 'v1' })).body.data;
    await saveOps(r.id, [op(10, wcA), { ...op(20, wcB), childMaterialId: undefined }]);
    // matRaw 被 BOM 引用的场景已在 material 模块处理；这里验证被路线（作为父物料）引用
    const res = await request(app.getHttpServer()).delete(`/api/materials/${matF}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
  });

  it('回归：裸 @Query 字符串分页不炸（浏览器 query 到达时是字符串）', async () => {
    // 500 根因：pageSize="20" 直接传 Prisma take。断言 4 个列表接口都能用字符串 query 正常返回
    for (const u of ['work-centers?page=1&pageSize=20', 'equipments?page=1&pageSize=20', 'routings?page=1&pageSize=20', 'shifts?page=1&pageSize=20']) {
      const res = await request(app.getHttpServer()).get(`/api/${u}`).set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
    }
  });

  async function getRoutingDetail(id: number) {
    const res = await request(app.getHttpServer()).get(`/api/routings/${id}`).set('Authorization', `Bearer ${adminToken}`);
    return res.body.data;
  }
});
