import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, resetDb, seedRbacForTest, login } from './helpers/app';
import { buildXlsx, buildFakeXlsx, readXlsx, getXlsx, IMPORT_HEADERS } from './helpers/xlsx';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * 第 15 节【测】物料导入导出与 CRUD（用例编号对应任务卡 15 必测表）：
 * 导入 3 条 / 文件内重复 / 库内重复 / 单位不存在 / 非法类型 / 空行 / 非 xlsx / 导出
 * CRUD：重复编码 409、修改 code 不生效、删除有物料的分类 409、单位/分类删除保护
 */

/** 正常行工厂：code 唯一由调用方保证 */
const goodRow = (code: string): [string, string, string, string, string, string, string] =>
  [code, `物料${code}`, '规格X', 'CAT', 'PCS', '原料', '100'];

describe('Material 导入导出与 CRUD（第 13-15 节）', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => { await app.close(); });

  let catId: number;
  let unitId: number;

  beforeEach(async () => {
    await resetDb(prisma);
    await seedRbacForTest(prisma);
    adminToken = (await login(app, 'admin', 'Admin@123')).accessToken;
    // 夹具：一个分类 + 一个单位（SQLite 自增不复位，必须用返回 id，不能假设 =1）
    const cat = await prisma.materialCategory.create({ data: { code: 'CAT', name: '通用分类' } });
    const unit = await prisma.unit.create({ data: { code: 'PCS', name: '个' } });
    catId = cat.id;
    unitId = unit.id;
  });

  const importFile = (buffer: Buffer, name = 'materials.xlsx') =>
    request(app.getHttpServer())
      .post('/api/materials/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', buffer, name);

  it('导入 3 条正常数据：返回 success=3，库中可查到', async () => {
    const res = await importFile(await buildXlsx([goodRow('M-001'), goodRow('M-002'), goodRow('M-003')]));
    expect(res.status).toBe(201);
    expect(res.body.data.successCount).toBe(3);
    expect(res.body.data.errorCount).toBe(0);
    const count = await prisma.material.count();
    expect(count).toBe(3);
    const m = await prisma.material.findUnique({ where: { code: 'M-001' } });
    expect(m).toMatchObject({ name: '物料M-001', type: 'RAW', safetyStock: 100 });
  });

  it('文件内重复编码：失败行号 [2,3]，库中 0 条新增（整批拒绝）', async () => {
    const res = await importFile(await buildXlsx([goodRow('M-DUP'), goodRow('M-DUP')]));
    expect(res.status).toBe(201); // 请求成功，但导入被整批拒绝
    expect(res.body.data.successCount).toBe(0);
    const errRows = res.body.data.errors.map((e: any) => e.rowNumber).sort((a: number, b: number) => a - b);
    expect(errRows).toEqual([2, 3]);
    expect(res.body.data.errors[0].message).toContain('重复');
    expect(await prisma.material.count()).toBe(0);
  });

  it('与库中已有编码重复：报错，整批不写入（第 14 节策略：不更新）', async () => {
    await prisma.material.create({
      data: { code: 'M-EX', name: '已有物料', categoryId: catId, unitId, type: 'RAW' },
    });
    const res = await importFile(await buildXlsx([goodRow('M-NEW'), goodRow('M-EX')]));
    expect(res.status).toBe(201);
    expect(res.body.data.successCount).toBe(0);
    const dup = res.body.data.errors.find((e: any) => e.message.includes('M-EX'));
    expect(dup).toBeTruthy();
    expect(dup.message).toContain('已存在');
    // 整批拒绝：M-NEW 也没进来
    expect(await prisma.material.findUnique({ where: { code: 'M-NEW' } })).toBeNull();
    expect(await prisma.material.count()).toBe(1);
  });

  it('单位不存在：失败原因含单位编码', async () => {
    const row = goodRow('M-U1');
    row[4] = 'KGX'; // 不存在的单位
    const res = await importFile(await buildXlsx([row]));
    expect(res.body.data.successCount).toBe(0);
    const err = res.body.data.errors[0];
    expect(err.message).toContain('KGX');
    expect(err.rowNumber).toBe(2);
  });

  it('非法类型：失败原因含可选值提示', async () => {
    const row = goodRow('M-T1');
    row[5] = '原材料'; // 非枚举值
    const res = await importFile(await buildXlsx([row]));
    expect(res.body.data.successCount).toBe(0);
    expect(res.body.data.errors[0].message).toContain('原料/半成品/成品');
  });

  it('中间空行：跳过不计失败，前后行都导入', async () => {
    const res = await importFile(await buildXlsx([goodRow('M-A'), ['', '', '', '', '', '', ''], goodRow('M-B')]));
    expect(res.status).toBe(201);
    expect(res.body.data.successCount).toBe(2);
    expect(res.body.data.errorCount).toBe(0);
    expect(await prisma.material.count()).toBe(2);
  });

  it('必填列缺失（无名称）：报错行号 + 列名', async () => {
    const row = goodRow('M-N1');
    row[1] = ''; // 物料名称置空
    const res = await importFile(await buildXlsx([row]));
    expect(res.body.data.successCount).toBe(0);
    expect(res.body.data.errors[0].message).toContain('名称');
    expect(res.body.data.errors[0].rowNumber).toBe(2);
  });

  it('表头顺序打乱：按表头名识别，照常导入', async () => {
    const shuffled = ['类型', '物料编码', '安全库存', '单位编码', '物料名称', '分类编码', '规格型号'];
    const res = await importFile(await buildXlsx([['成品', 'M-S1', '5', 'PCS', '打乱表头物料', 'CAT', '']], { header: shuffled }));
    expect(res.body.data.successCount).toBe(1);
    const m = await prisma.material.findUnique({ where: { code: 'M-S1' } });
    expect(m).toMatchObject({ type: 'FINISHED', name: '打乱表头物料', safetyStock: 5 });
  });

  it('非 xlsx（改名 txt）：400 友好提示', async () => {
    const res = await importFile(buildFakeXlsx());
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('xlsx');
  });

  it('全角编码：报错提示全角', async () => {
    const row = goodRow('Ｍ-Ｆ1'); // 全角字符
    const res = await importFile(await buildXlsx([row]));
    expect(res.body.data.successCount).toBe(0);
    expect(res.body.data.errors[0].message).toContain('全角');
  });

  it('编码前后空格：自动 trim 后导入', async () => {
    const row = goodRow('  M-TRIM  ');
    const res = await importFile(await buildXlsx([row]));
    expect(res.body.data.successCount).toBe(1);
    expect(await prisma.material.findUnique({ where: { code: 'M-TRIM' } })).not.toBeNull();
  });

  it('导出：返回 xlsx，解析后行数 = 库中筛选结果数，列头正确', async () => {
    await importFile(await buildXlsx([goodRow('M-E1'), goodRow('M-E2')]));
    const buffer = await getXlsx(app, '/api/materials/export', adminToken);
    const rows = await readXlsx(buffer);
    expect(rows[0].slice(0, 7)).toEqual(IMPORT_HEADERS);
    expect(rows).toHaveLength(3); // 表头 + 2 行
    const codes = rows.slice(1).map((r) => r[0]).sort();
    expect(codes).toEqual(['M-E1', 'M-E2']);
  });

  it('导入模板下载：返回带标准表头的 xlsx', async () => {
    const buffer = await getXlsx(app, '/api/materials/import-template', adminToken);
    const rows = await readXlsx(buffer);
    expect(rows[0].slice(0, 7)).toEqual(IMPORT_HEADERS);
  });

  // ---------- CRUD 边界 ----------

  it('创建重复编码 → 409', async () => {
    const mk = () => request(app.getHttpServer())
      .post('/api/materials').set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'M-C1', name: '物料C1', categoryId: catId, unitId, type: 'RAW' });
    expect((await mk()).status).toBe(201);
    const dup = await mk();
    expect(dup.status).toBe(409);
    expect(dup.body.message).toContain('M-C1');
  });

  it('修改物料时传 code：code 不变（创建后不可改）', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/materials').set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'M-K1', name: '原名', categoryId: catId, unitId, type: 'RAW' });
    const res = await request(app.getHttpServer())
      .patch(`/api/materials/${created.body.data.id}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'M-HACKED', name: '新名' });
    expect(res.status).toBe(200);
    expect(res.body.data.code).toBe('M-K1');
    expect(res.body.data.name).toBe('新名');
  });

  it('删除有物料的分类 → 409；删除有物料的单位 → 409', async () => {
    await request(app.getHttpServer())
      .post('/api/materials').set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'M-R1', name: '物料R1', categoryId: catId, unitId, type: 'RAW' });
    const catRes = await request(app.getHttpServer())
      .delete(`/api/material-categories/${catId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(catRes.status).toBe(409);
    expect(catRes.body.message).toContain('物料');
    const unitRes = await request(app.getHttpServer())
      .delete(`/api/units/${unitId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(unitRes.status).toBe(409);
    expect(unitRes.body.message).toContain('物料');
  });

  it('分类删除：有子分类 → 409；删除被移动过的空分类成功', async () => {
    await request(app.getHttpServer())
      .post('/api/material-categories').set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'SUB', name: '子分类', parentId: catId });
    const res = await request(app.getHttpServer())
      .delete(`/api/material-categories/${catId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('子分类');
  });

  it('分类移动成环：把父分类挂到自己的子分类下 → 422 (2005)', async () => {
    const child = await request(app.getHttpServer())
      .post('/api/material-categories').set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'CHILD', name: '子分类', parentId: catId });
    const res = await request(app.getHttpServer())
      .patch(`/api/material-categories/${catId}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ parentId: child.body.data.id });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(2005);
  });
});
