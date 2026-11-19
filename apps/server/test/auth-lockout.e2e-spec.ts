import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, resetDb } from './helpers/app';
import { PrismaService } from '../src/prisma/prisma.service';
import * as bcrypt from 'bcrypt';

const USER = 'lockuser';
const PASS = 'Lock@123';

describe('Auth 登录滑块验证与 15 分钟锁定', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    await prisma.user.create({
      data: { username: USER, password: await bcrypt.hash(PASS, 10), name: '锁定测试用户' },
    });
  });

  const login = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/api/auth/login').send(body);

  async function captcha(username: string) {
    const res = await request(app.getHttpServer()).post('/api/auth/captcha').send({ username });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    return res.body.data as { captchaId: string; target: number; tolerance: number; maxOffset: number };
  }

  async function attemptsOf() {
    return prisma.user.findUniqueOrThrow({ where: { username: USER } });
  }

  it('3 次错误要求滑块；5 次错误锁定 15 分钟', async () => {
    for (let i = 0; i < 2; i += 1) {
      const res = await login({ username: USER, password: 'wrong' });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe(1002);
    }

    // 第 3 次失败：返回 1010，前端据此弹滑块
    let res = await login({ username: USER, password: 'wrong' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(1010);
    let user = await attemptsOf();
    expect(user.failedAttempts).toBe(3);

    // 第 4 次不带滑块：仍然 1010，且不累加失败次数
    res = await login({ username: USER, password: 'wrong' });
    expect(res.body.code).toBe(1010);
    user = await attemptsOf();
    expect(user.failedAttempts).toBe(3);

    // 第 4 次带有效滑块 + 错误密码：失败次数变为 4，继续要求滑块
    let c = await captcha(USER);
    res = await login({ username: USER, password: 'wrong', captchaId: c.captchaId, captchaOffset: c.target });
    expect(res.body.code).toBe(1010);
    user = await attemptsOf();
    expect(user.failedAttempts).toBe(4);

    // 第 5 次带有效滑块 + 错误密码：锁定 15 分钟
    c = await captcha(USER);
    res = await login({ username: USER, password: 'wrong', captchaId: c.captchaId, captchaOffset: c.target });
    expect(res.status).toBe(423);
    expect(res.body.code).toBe(1009);
    user = await attemptsOf();
    expect(user.failedAttempts).toBe(0);
    expect(user.lockedUntil).not.toBeNull();
    expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);

    // 锁定期间即使密码正确也拒绝
    res = await login({ username: USER, password: PASS });
    expect(res.body.code).toBe(1009);
  }, 30_000);

  it('3 次失败后携带有效滑块 + 正确密码：登录成功并清零', async () => {
    await prisma.user.update({ where: { username: USER }, data: { failedAttempts: 3 } });
    const c = await captcha(USER);
    const res = await login({ username: USER, password: PASS, captchaId: c.captchaId, captchaOffset: c.target });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    const user = await attemptsOf();
    expect(user.failedAttempts).toBe(0);
    expect(user.lockedUntil).toBeNull();
  }, 30_000);

  it('滑块偏移错误：返回 1010，且不累加失败次数', async () => {
    await prisma.user.update({ where: { username: USER }, data: { failedAttempts: 3 } });
    const c = await captcha(USER);
    const wrongOffset = c.target > c.maxOffset / 2 ? 0 : c.maxOffset;
    const res = await login({ username: USER, password: 'wrong', captchaId: c.captchaId, captchaOffset: wrongOffset });
    expect(res.body.code).toBe(1010);
    const user = await attemptsOf();
    expect(user.failedAttempts).toBe(3);
  }, 30_000);

  it('锁定到期后可以重新登录', async () => {
    await prisma.user.update({
      where: { username: USER },
      data: { failedAttempts: 0, lockedUntil: new Date(Date.now() - 1000) },
    });
    const res = await login({ username: USER, password: PASS });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
  }, 30_000);

  it('不存在的用户名也遵循相同的滑块/锁定阈值（防用户名枚举）', async () => {
    for (let i = 0; i < 2; i += 1) {
      const res = await login({ username: 'ghost', password: 'x' });
      expect(res.body.code).toBe(1002);
    }
    let res = await login({ username: 'ghost', password: 'x' });
    expect(res.body.code).toBe(1010);

    let c = await captcha('ghost');
    res = await login({ username: 'ghost', password: 'x', captchaId: c.captchaId, captchaOffset: c.target });
    expect(res.body.code).toBe(1010);

    c = await captcha('ghost');
    res = await login({ username: 'ghost', password: 'x', captchaId: c.captchaId, captchaOffset: c.target });
    expect(res.body.code).toBe(1009);
  }, 30_000);
});
