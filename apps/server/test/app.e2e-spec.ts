import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/app';

describe('GET /api/health', () => {
  let app: INestApplication;
  beforeAll(async () => { ({ app } = await createTestApp()); });
  afterAll(async () => { await app.close(); });

  it('应返回统一响应结构且 status=ok', async () => {
    const res = await request(app.getHttpServer()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ code: 0, message: 'ok', data: { status: 'ok', db: 'ok' } });
  });

  it('不存在的路径应返回 404 且 code=1004', async () => {
    const res = await request(app.getHttpServer()).get('/api/not-exist');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(1004);
    expect(res.body.data).toBeNull();
  });
});
