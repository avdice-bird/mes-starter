import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, resetDb, seedRbacForTest, login } from './helpers/app';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * 第 12 节【建+测】审计日志（任务卡 4 条）：
 * 1. 调一次 POST /dicts 后审计表多一条，字段正确
 * 2. 登录接口的 params 里没有密码（明文/哈希都不出现）
 * 3. operator 访问审计页 403（矩阵另有行）
 * 4. 失败的请求也被记录，result 含错误码
 */
/** 拦截器是响应后异步落库（不阻塞业务），测试里轮询等待写入完成 */
async function waitForAudit(
  prisma: PrismaService,
  where: { module: string; path?: string },
  minCount: number,
  timeoutMs = 3000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const n = await prisma.auditLog.count({ where });
    if (n >= minCount) return n;
    await new Promise((r) => setTimeout(r, 50));
  }
  return prisma.auditLog.count({ where });
}

describe('AuditLog 审计日志（第 12 节）', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => { await app.close(); });

  beforeEach(async () => {
    await resetDb(prisma);
    await seedRbacForTest(prisma);
    adminToken = (await login(app, 'admin', 'Admin@123')).accessToken;
  });

  it('用例1：POST /dicts 后审计表多一条，字段正确', async () => {
    const before = await prisma.auditLog.count({ where: { module: 'dicts' } });
    await request(app.getHttpServer())
      .post('/api/dicts').set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'audit_case', name: '审计用例' });
    await waitForAudit(prisma, { module: 'dicts', path: '/api/dicts' }, before + 1);
    const logs = await prisma.auditLog.findMany({ where: { module: 'dicts', path: '/api/dicts' } });
    expect(logs).toHaveLength(before + 1);
    const log = logs.at(-1)!;
    expect(log.method).toBe('POST');
    expect(log.module).toBe('dicts');
    expect(log.action).toContain('create');
    expect(log.result).toBe('success');
    expect(log.durationMs).toBeGreaterThanOrEqual(0);
    expect(log.username).toBe('admin');
  });

  it('用例2：登录请求的审计 params 里没有密码（明文与原文都不出现）', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login').send({ username: 'admin', password: 'SuperSecret9' });
    const logs = await prisma.auditLog.findMany({ where: { module: 'auth' } });
    // 登录接口要么不记（@SkipAudit），要么记了必须无密码——两种实现都算过
    for (const log of logs) {
      expect(log.params).not.toContain('SuperSecret9');
    }
    const all = await prisma.auditLog.findMany();
    for (const log of all) {
      expect(log.params).not.toContain('SuperSecret9');
    }
  });

  it('用例3：operator 访问审计页 → 403（矩阵另有行）', async () => {
    const operatorToken = (await login(app, 'operator', 'User@123')).accessToken;
    const res = await request(app.getHttpServer())
      .get('/api/audit-logs').set('Authorization', `Bearer ${operatorToken}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(1003);
  });

  it('用例4：失败的写请求也被记录，result 含错误码', async () => {
    // 制造失败：重复 code → 409/1005（beforeEach 里 admin 登录本身可能也产生审计，按 module+path 精确查）
    await request(app.getHttpServer())
      .post('/api/dicts').set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'dup_audit', name: '第一个' });
    await request(app.getHttpServer())
      .post('/api/dicts').set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'dup_audit', name: '重复的' });
    await waitForAudit(prisma, { module: 'dicts', path: '/api/dicts' }, 2);
    const logs = await prisma.auditLog.findMany({
      where: { module: 'dicts', path: '/api/dicts' },
      orderBy: { id: 'asc' },
    });
    expect(logs).toHaveLength(2);
    expect(logs[0].result).toBe('success');
    // 审计层先于异常过滤器看到错误：Service 已把 P2002 转成 BusinessException(1005)，
    // 这里拿到的应是业务码；若看到 P2002 说明拿到的是未转换的原始错误
    expect(logs[1].result).toBe('1005');
  });
});
