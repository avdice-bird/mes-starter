import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, resetDb } from './helpers/app';
import { PrismaService } from '../src/prisma/prisma.service';
import * as bcrypt from 'bcrypt';

describe('Auth（认证）', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => { await app.close(); });

  beforeEach(async () => {
    await resetDb(prisma);
    await prisma.user.create({
      data: { username: 'admin', password: await bcrypt.hash('Admin@123', 10), name: '管理员' },
    });
  });

  it('正确用户名密码应登录成功并返回双 token', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'Admin@123' });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
    expect(res.body.data.user.username).toBe('admin');
    expect(res.body.data.user).not.toHaveProperty('password');
  });

  it('错误密码应返回 401 且不返回 token', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(1002);
  });

  it('未登录访问 /me 应返回 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(1002);
  });

  describe('已登录后', () => {
    let tokens: { accessToken: string; refreshToken: string };

    beforeEach(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'Admin@123' });
      tokens = { accessToken: res.body.data.accessToken, refreshToken: res.body.data.refreshToken };
    });

    it('带 token 访问 /me 应返回当前用户与权限信息', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.user.username).toBe('admin');
      expect(Array.isArray(res.body.data.permissions)).toBe(true);
      expect(Array.isArray(res.body.data.menus)).toBe(true);
    });

    it('刷新应返回新 token 对且旧 refresh 失效', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: tokens.refreshToken });
      expect(res.status).toBe(200);
      expect(res.body.data.refreshToken).not.toBe(tokens.refreshToken);

      const again = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: tokens.refreshToken });
      expect(again.status).toBe(401);
    });

    it('登出后用原 refresh 刷新应失败', async () => {
      const out = await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ refreshToken: tokens.refreshToken });
      expect(out.status).toBe(200);

      const res = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: tokens.refreshToken });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe(1002);
    });
  });
});
