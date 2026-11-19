import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, resetDb, seedRbacForTest, login } from './helpers/app';
import { PrismaService } from '../src/prisma/prisma.service';
import { AndonService } from '../src/modules/andon/andon.service';
import { BoardGateway } from '../src/modules/board/board.gateway';

/**
 * 第 52 节【测】安灯集成：完整流转、合并、责任角色 403、resolution 400、
 * 超时升级（now 传入调两次）、通知已读 403、Gateway mock 推送、权限矩阵。
 */
describe('Andon 安灯（第 52 节）', () => {
  jest.setTimeout(120_000); // 登录限流（20/min）429 等待最长 ~60s/次，超过 jest 默认 5s
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let operatorToken: string;
  let qcToken: string;
  let maintainerToken: string;
  let wcId: number;
  let eqId: number;

  const api = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const create = (t: string, body: Record<string, unknown>) =>
    request(api()).post('/api/andon-calls').set(auth(t)).send(body);

  /** 建一条 OPEN 呼叫并返回 id（默认 EQUIPMENT→maintainer 责任） */
  const makeCall = async (t: string, overrides: Record<string, unknown> = {}) => {
    const res = await create(t, { type: 'EQUIPMENT', workCenterId: wcId, description: '测试呼叫', ...overrides });
    expect(res.status).toBe(201);
    return res.body.data as { id: number; code: string; merged: boolean };
  };

  beforeAll(async () => { ({ app, prisma } = await createTestApp()); });
  afterAll(async () => { await app.close(); });

  beforeEach(async () => {
    await resetDb(prisma);
    await seedRbacForTest(prisma);
    // 用户表被重建，token 必须每用例重取（sub 指向新 id）；login 已内建 429 等待重试
    adminToken = (await login(app, 'admin', 'Admin@123')).accessToken;
    operatorToken = (await login(app, 'operator', 'User@123')).accessToken;
    qcToken = (await login(app, 'qc', 'User@123')).accessToken;
    maintainerToken = (await login(app, 'maintainer', 'User@123')).accessToken;
    const wc = await prisma.workCenter.create({ data: { code: 'AD-WC', name: '安灯产线' } });
    wcId = wc.id;
    eqId = (await prisma.equipment.create({ data: { code: 'AD-EQ', name: '安灯设备', workCenterId: wc.id } })).id;
  }, 120_000);

  it('用例1：完整流转 OPEN→RESPONDED→CLOSED，通知数 = 责任角色用户数', async () => {
    const call = await makeCall(operatorToken);
    expect(call.merged).toBe(false);

    // 责任角色 maintainer 只有 1 个种子用户 → 恰 1 条通知
    const m = await prisma.user.findFirst({ where: { username: 'maintainer' } });
    const notifs = await prisma.notification.count({ where: { userId: m!.id, refId: call.id } });
    expect(notifs).toBe(1);

    // 非责任角色（qc 是 QUALITY 责任，不是 EQUIPMENT）→ 403
    const deny = await request(api()).post(`/api/andon-calls/${call.id}/respond`).set(auth(qcToken)).send({});
    expect(deny.status).toBe(403);

    // 责任角色响应 → 关闭
    const respond = await request(api()).post(`/api/andon-calls/${call.id}/respond`).set(auth(maintainerToken)).send({ remark: '到场' });
    expect(respond.body.data.status).toBe('RESPONDED');
    const close = await request(api()).post(`/api/andon-calls/${call.id}/close`).set(auth(maintainerToken)).send({ resolution: '已修复' });
    expect(close.body.data.status).toBe('CLOSED');
    const row = await prisma.andonCall.findUnique({ where: { id: call.id } });
    expect(row?.closedAt).not.toBeNull();
    expect(row?.responderId).toBe(m!.id);
  });

  it('用例2：同工作中心同类型 OPEN → 合并返回已有 id，通知不增加', async () => {
    const first = await makeCall(operatorToken);
    const second = await makeCall(operatorToken);
    expect(second).toMatchObject({ id: first.id, code: first.code, merged: true });

    const count = await prisma.notification.count({ where: { refId: first.id } });
    expect(count).toBe(1); // 合并不重复通知
  });

  it('用例3：关闭无 resolution → 400', async () => {
    const call = await makeCall(operatorToken);
    await request(api()).post(`/api/andon-calls/${call.id}/respond`).set(auth(maintainerToken)).send({});
    const res = await request(api()).post(`/api/andon-calls/${call.id}/close`).set(auth(maintainerToken)).send({ resolution: '' });
    expect(res.status).toBe(400);
  });

  it('用例4：超时升级——escalateTimeouts(now) 调第二次无变化（幂等）', async () => {
    const svc = app.get(AndonService);
    // OPEN 超时分钟字典未 seed → 默认 10；把 calledAt 拨到 11 分钟前
    const call = await makeCall(operatorToken);
    await prisma.andonCall.update({
      where: { id: call.id },
      data: { calledAt: new Date(Date.now() - 11 * 60_000) },
    });

    const now = new Date();
    expect(await svc.escalateTimeouts(now)).toBe(1);
    const row = await prisma.andonCall.findUnique({ where: { id: call.id } });
    expect(row?.escalated).toBe(true);

    // 第二次调用：已升级被查询排除 → 0，通知不翻倍
    expect(await svc.escalateTimeouts(new Date(now.getTime() + 60_000))).toBe(0);
    expect(await prisma.notification.count({ where: { refId: call.id, title: { contains: '升级' } } })).toBe(1);
  });

  it('用例5：标记别人的通知已读 → 403；自己的 → 未读数减少', async () => {
    const call = await makeCall(operatorToken); // 通知发给 maintainer
    const m = await prisma.user.findFirst({ where: { username: 'maintainer' } });
    const n = await prisma.notification.findFirst({ where: { userId: m!.id, refId: call.id } });

    const forbidden = await request(api()).post(`/api/notifications/${n!.id}/read`).set(auth(adminToken)).send({});
    expect(forbidden.status).toBe(403);

    const before = (await request(api()).get('/api/notifications/unread-count').set(auth(maintainerToken))).body.data.count;
    const ok = await request(api()).post(`/api/notifications/${n!.id}/read`).set(auth(maintainerToken)).send({});
    expect(ok.status).toBe(201);
    const after = (await request(api()).get('/api/notifications/unread-count').set(auth(maintainerToken))).body.data.count;
    expect(after).toBe(before - 1);
  });

  it('用例6：Gateway mock——创建呼叫时事件进 Gateway 并广播到 wc:<id> 与 all，payload 只带摘要', async () => {
    // test 环境不跑 main.ts 的 attach：手动 attach 一个 mock namespace（jwt/权限参数放行），
    // 事件监听的注册发生在 attach 里——随后创建呼叫即可断言 server.to(room).emit 的房间与 payload
    const gw = app.get(BoardGateway);
    const emittedTo: { room: string; event: string; payload: Record<string, unknown> }[] = [];
    const mockNs = {
      use: jest.fn(), // 只注册不执行（握手中间件在这里不跑）
      on: jest.fn(),
      to: (room: string) => ({ emit: (event: string, payload: Record<string, unknown>) => emittedTo.push({ room, event, payload }) }),
    };
    const jwt = app.get((await import('@nestjs/jwt')).JwtService);
    gw.attach(mockNs as never, (token: string) => jwt.verify(token) as { sub: number }, async () => true);
    expect(mockNs.use).toHaveBeenCalled(); // 握手中间件已注册
    expect(mockNs.on).toHaveBeenCalledWith('connection', expect.any(Function)); // 连接处理已注册
    // 业务事件监听注册在事件总线（eventemitter2）上——由下方 makeCall 触发广播链路验证

    const call = await makeCall(operatorToken);

    // 广播：wc 房间与 all 各一条，同一 payload
    const wcHit = emittedTo.find((e) => e.room === `wc:${wcId}` && e.event === 'andon.created');
    const allHit = emittedTo.find((e) => e.room === 'all' && e.event === 'andon.created');
    expect(wcHit?.payload).toMatchObject({ andonId: call.id, code: call.code, status: 'OPEN' });
    expect(allHit?.payload).toEqual(wcHit?.payload);
    // 脱敏：不含 description / callerId 等明细
    expect(Object.keys(wcHit?.payload ?? {})).toEqual(expect.not.arrayContaining(['description', 'callerId']));
  });

  it('用例7：设备不属于该工作中心 → 400；呼叫人取消已响应的 → 1006；非呼叫人取消 → 403', async () => {
    // 设备归属
    const otherWc = await prisma.workCenter.create({ data: { code: 'AD-WC2', name: '别的产线' } });
    const res = await create(operatorToken, { type: 'EQUIPMENT', workCenterId: otherWc.id, equipmentId: eqId, description: '跨产线设备' });
    expect(res.status).toBe(400);

    // 非呼叫人取消
    const call = await makeCall(operatorToken);
    const deny = await request(api()).post(`/api/andon-calls/${call.id}/cancel`).set(auth(adminToken)).send({ reason: '不是呼叫人' });
    expect(deny.status).toBe(403);

    // 呼叫人取消已 RESPONDED → 1006
    await request(api()).post(`/api/andon-calls/${call.id}/respond`).set(auth(maintainerToken)).send({});
    const late = await request(api()).post(`/api/andon-calls/${call.id}/cancel`).set(auth(operatorToken)).send({ reason: '晚了' });
    expect(late.status).toBe(409);
    expect(late.body.code).toBe(1006);

    // 关闭后再响应 → 1006
    await request(api()).post(`/api/andon-calls/${call.id}/close`).set(auth(maintainerToken)).send({ resolution: '处理完毕' });
    const again = await request(api()).post(`/api/andon-calls/${call.id}/respond`).set(auth(maintainerToken)).send({});
    expect(again.status).toBe(409);
    expect(again.body.code).toBe(1006);
  });

  it('用例8：权限矩阵——andon 四码三态', async () => {
    // operator 只有 create/view：respond/close 403
    const call = await makeCall(operatorToken);
    expect((await request(api()).post(`/api/andon-calls/${call.id}/respond`).set(auth(operatorToken)).send({})).status).toBe(403);
    expect((await request(api()).post(`/api/andon-calls/${call.id}/close`).set(auth(operatorToken)).send({ resolution: 'x' })).status).toBe(403);
    // operator 可取消自己的（create 权限）
    expect((await request(api()).post(`/api/andon-calls/${call.id}/cancel`).set(auth(operatorToken)).send({ reason: '不要了' })).status).toBe(201);

    // 未登录 401
    expect((await request(api()).get('/api/andon-calls')).status).toBe(401);
    // operator 有 notification:view（第 50 节铃铛需要）→ 200；未读数接口同
    expect((await request(api()).get('/api/notifications').set(auth(operatorToken))).status).toBe(200);
    expect((await request(api()).get('/api/notifications/unread-count').set(auth(operatorToken))).status).toBe(200);
    // admin 全通
    expect((await request(api()).get('/api/andon-calls').set(auth(adminToken))).status).toBe(200);
  });
});
