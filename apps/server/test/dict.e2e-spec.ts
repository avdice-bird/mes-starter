import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, resetDb, seedRbacForTest, login } from './helpers/app';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * 第 11 节【磨】字典特有边界用例（用例编号对应任务卡 11）：
 * 1. 字典 code 不可修改（PATCH 带 code 也不生效）
 * 2. 删除有字典项的字典 → 409 且提示项数
 * 3. 字典项 value 同一字典内唯一 → 409；不同字典可重复
 * 4. 停用项不出现在下拉 options；字典项管理列表仍显示（历史数据可查）
 */
describe('Dict 边界用例（第 11 节）', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => { await app.close(); });

  let dictId: number;
  let dictBId: number;

  beforeEach(async () => {
    await resetDb(prisma);
    await seedRbacForTest(prisma);
    adminToken = (await login(app, 'admin', 'Admin@123')).accessToken;
    const r1 = await request(app.getHttpServer())
      .post('/api/dicts').set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'edge_dict', name: '边界字典' });
    dictId = r1.body.data.id;
    const r2 = await request(app.getHttpServer())
      .post('/api/dicts').set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'edge_dict_b', name: '另一个字典' });
    dictBId = r2.body.data.id;
  });

  it('用例1：PATCH 带 code 也不可修改编码', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/dicts/${dictId}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'hacked_code', name: '改名了' });
    expect(res.status).toBe(200);
    expect(res.body.data.code).toBe('edge_dict'); // code 不变
    expect(res.body.data.name).toBe('改名了');
  });

  it('用例3：同一字典内 value 冲突 → 409；不同字典同 value 允许', async () => {
    const mk = (dictId2: number, value: string) =>
      request(app.getHttpServer())
        .post(`/api/dicts/${dictId2}/items`).set('Authorization', `Bearer ${adminToken}`)
        .send({ label: `L-${value}`, value });
    expect((await mk(dictId, 'V1')).status).toBe(201);
    const dup = await mk(dictId, 'V1');
    expect(dup.status).toBe(409);
    expect(dup.body.message).toContain('已存在相同 value');
    const other = await mk(dictBId, 'V1');
    expect(other.status).toBe(201);
  });

  it('用例2：删除有字典项的字典 → 409 且提示项数', async () => {
    await request(app.getHttpServer())
      .post(`/api/dicts/${dictId}/items`).set('Authorization', `Bearer ${adminToken}`)
      .send({ label: 'L1', value: 'V1' });
    const res = await request(app.getHttpServer())
      .delete(`/api/dicts/${dictId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('1 个字典项');
  });

  it('用例4：停用项不出现在下拉；管理列表仍显示（历史数据可查）', async () => {
    const created = await request(app.getHttpServer())
      .post(`/api/dicts/${dictId}/items`).set('Authorization', `Bearer ${adminToken}`)
      .send({ label: '启用项', value: 'ON' });
    await request(app.getHttpServer())
      .post(`/api/dicts/${dictId}/items`).set('Authorization', `Bearer ${adminToken}`)
      .send({ label: '停用项', value: 'OFF', status: 0 });
    // 下拉只出现启用项
    const opts = await request(app.getHttpServer())
      .get('/api/dicts/code/edge_dict/options').set('Authorization', `Bearer ${adminToken}`);
    const values = (opts.body.data as { value: string }[]).map((o) => o.value);
    expect(values).toEqual(['ON']);
    // 停用 created 再查：下拉为空，管理列表还在
    await request(app.getHttpServer())
      .put(`/api/dicts/items/${created.body.data.id}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 0 });
    const opts2 = await request(app.getHttpServer())
      .get('/api/dicts/code/edge_dict/options').set('Authorization', `Bearer ${adminToken}`);
    expect(opts2.body.data).toEqual([]);
    const list = await request(app.getHttpServer())
      .get(`/api/dicts/${dictId}/items`).set('Authorization', `Bearer ${adminToken}`);
    expect(list.body.data).toHaveLength(2);
  });
});
