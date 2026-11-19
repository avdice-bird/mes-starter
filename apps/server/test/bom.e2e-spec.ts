import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, resetDb, seedRbacForTest, login } from './helpers/app';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * 第 18 节【测】BOM 集成测试：版本与激活规则、明细边界、树接口结构。
 * 前置：物料模块已有（material/unit/material-category）。
 */
describe('BOM 集成（第 16-18 节）', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let matFinished: number;
  let matSemi: number;
  let matRaw: number;

  const createBom = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/api/boms').set('Authorization', `Bearer ${adminToken}`).send(body);
  const saveItems = (id: number, items: unknown[]) =>
    request(app.getHttpServer()).put(`/api/boms/${id}/items`).set('Authorization', `Bearer ${adminToken}`).send({ items });
  const activate = (id: number) =>
    request(app.getHttpServer()).post(`/api/boms/${id}/activate`).set('Authorization', `Bearer ${adminToken}`);

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => { await app.close(); });

  beforeEach(async () => {
    await resetDb(prisma);
    await seedRbacForTest(prisma);
    adminToken = (await login(app, 'admin', 'Admin@123')).accessToken;
    // 建三个物料：成品/半成品/原料
    const cat = await prisma.materialCategory.create({ data: { code: 'CAT', name: '测试分类' } });
    const unit = await prisma.unit.create({ data: { code: 'PCS', name: '个' } });
    const mk = async (code: string, type: string) =>
      (
        await prisma.material.create({
          data: { code, name: code, type, categoryId: cat.id, unitId: unit.id },
        })
      ).id;
    matFinished = await mk('BOM_FIN', 'FINISHED');
    matSemi = await mk('BOM_SEMI', 'SEMI');
    matRaw = await mk('BOM_RAW', 'RAW');
  });

  it('验收1：创建版本；同物料同版本重复 → 409', async () => {
    const r1 = await createBom({ materialId: matFinished, version: 'v1', effectiveFrom: '2026-01-01' });
    expect(r1.status).toBe(201);
    expect(r1.body.data.status).toBe('DRAFT');
    const dup = await createBom({ materialId: matFinished, version: 'v1', effectiveFrom: '2026-02-01' });
    expect(dup.status).toBe(409);
  });

  it('验收2+4：批量保存明细 → 树形展开三级、数量正确（手算）', async () => {
    const bom = (await createBom({ materialId: matFinished, version: 'v1', effectiveFrom: '2026-01-01' })).body.data;
    const semiBom = (await createBom({ materialId: matSemi, version: 'v1', effectiveFrom: '2026-01-01' })).body.data;
    await saveItems(semiBom.id, [{ childMaterialId: matRaw, qty: 3, scrapRate: 300 }]);
    const saved = await saveItems(bom.id, [
      { childMaterialId: matSemi, qty: 2, scrapRate: 0 },
      { childMaterialId: matRaw, qty: 4, scrapRate: 0 },
    ]);
    expect(saved.status).toBe(200);
    expect(saved.body.data.items).toHaveLength(2);

    // 激活两个版本后展开
    await activate(bom.id);
    await activate(semiBom.id);
    const tree = await request(app.getHttpServer())
      .get(`/api/boms/${bom.id}/tree`).set('Authorization', `Bearer ${adminToken}`);
    expect(tree.status).toBe(200);
    const { tree: node, summary, depth } = tree.body.data;
    expect(depth).toBe(2);
    expect(node.children).toHaveLength(2); // SEMI + 直用 RAW
    const semiNode = node.children.find((c: { materialId: number }) => c.materialId === matSemi);
    expect(semiNode.qty).toBe(2);
    expect(semiNode.children[0].qty).toBe(6); // 2×3=6 → 含损耗 round(6×1.03)=6
    const screw = summary.find((s: { materialId: number }) => s.materialId === matRaw);
    expect(screw.qty).toBe(6 + 4); // 6 + 4 = 10（同单测口径）
  });

  it('验收3+5：激活 v2 后 v1 自动 OBSOLETE；同一父物料只有一个 ACTIVE', async () => {
    const v1 = (await createBom({ materialId: matFinished, version: 'v1', effectiveFrom: '2026-01-01' })).body.data;
    const v2 = (await createBom({ materialId: matFinished, version: 'v2', effectiveFrom: '2026-03-01' })).body.data;
    await activate(v1.id);
    expect((await prisma.bom.findUniqueOrThrow({ where: { id: v1.id } })).status).toBe('ACTIVE');
    await activate(v2.id);
    const activeCount = await prisma.bom.count({ where: { materialId: matFinished, status: 'ACTIVE' } });
    expect(activeCount).toBe(1);
    expect((await prisma.bom.findUniqueOrThrow({ where: { id: v1.id } })).status).toBe('OBSOLETE');
  });

  it('边界：明细含父物料自身 → 422/2003', async () => {
    const bom = (await createBom({ materialId: matFinished, version: 'v1', effectiveFrom: '2026-01-01' })).body.data;
    const res = await saveItems(bom.id, [{ childMaterialId: matFinished, qty: 1, scrapRate: 0 }]);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(2003);
  });

  it('边界：跨 BOM 成环 A→B→A → 422/2003', async () => {
    // A 的 v1 已激活且子件是 B；保存 B 的明细子件是 A → 保存时检测到环
    const bomA = (await createBom({ materialId: matFinished, version: 'v1', effectiveFrom: '2026-01-01' })).body.data;
    const bomB = (await createBom({ materialId: matSemi, version: 'v1', effectiveFrom: '2026-01-01' })).body.data;
    await saveItems(bomA.id, [{ childMaterialId: matSemi, qty: 1, scrapRate: 0 }]);
    await activate(bomA.id);
    const res = await saveItems(bomB.id, [{ childMaterialId: matFinished, qty: 1, scrapRate: 0 }]);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(2003);
  });

  it('边界：修改 ACTIVE 版本明细 → 409；删除 ACTIVE → 409', async () => {
    const bom = (await createBom({ materialId: matFinished, version: 'v1', effectiveFrom: '2026-01-01' })).body.data;
    await saveItems(bom.id, [{ childMaterialId: matRaw, qty: 1, scrapRate: 0 }]);
    await activate(bom.id);
    const edit = await saveItems(bom.id, [{ childMaterialId: matRaw, qty: 9, scrapRate: 0 }]);
    expect(edit.status).toBe(409);
    const del = await request(app.getHttpServer())
      .delete(`/api/boms/${bom.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(409);
  });

  it('边界：明细选了不存在/已删除的物料 → 400（1001）', async () => {
    const bom = (await createBom({ materialId: matFinished, version: 'v1', effectiveFrom: '2026-01-01' })).body.data;
    const res = await saveItems(bom.id, [{ childMaterialId: 99999, qty: 1, scrapRate: 0 }]);
    expect(res.status).toBe(400);
  });
});
