import { INestApplication } from '@nestjs/common';
import { Server as HttpServer } from 'http';
import { createTestApp, resetDb, seedRbacForTest, login } from './helpers/app';
import { PrismaService } from '../src/prisma/prisma.service';
import { BoardGateway } from '../src/modules/board/board.gateway';
import { JwtService } from '@nestjs/jwt';

/**
 * 第 49 节【磨+测】看板 socket：握手鉴权四态（用例 2/3）、房间互斥与隔离（用例 4/5）、
 * 事件风暴恰收一份（用例 6 的服务端面）、payload 脱敏（用例 8）。
 * main.ts 的 socket.io 挂载在 test 环境不执行，这里按 main.ts 同款配置自挂（真实端口）。
 */
describe('Board socket（第 49 节）', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let operatorToken: string;
  let httpServer: HttpServer;
  let baseUrl: string;
  let ioServer: import('socket.io').Server;

  const client = (token: string | undefined) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { io } = require('socket.io-client') as typeof import('socket.io-client');
    const s = io(`${baseUrl}/board`, {
      path: '/board/socket.io',
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      timeout: 3000,
    });
    return s;
  };

  /** 等连接结果：connected / connect_error 消息 */
  const handshake = (token: string | undefined) =>
    new Promise<{ ok: boolean; message: string }>((resolve) => {
      const s = client(token);
      const done = (r: { ok: boolean; message: string }) => { s.disconnect(); resolve(r); };
      s.on('connect', () => done({ ok: true, message: 'connected' }));
      s.on('connect_error', (e: Error) => done({ ok: false, message: e.message }));
    });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    httpServer = app.getHttpServer() as HttpServer;
    // 与 main.ts 同款：socket.io 挂真实端口 + gateway.attach（jwt + board:view 实时查库）
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ioServer = require('socket.io')(httpServer, { path: '/board/socket.io' });
    const gateway = app.get(BoardGateway);
    const jwt = app.get(JwtService);
    gateway.attach(
      ioServer.of('/board'),
      (token: string) => jwt.verify(token) as { sub: number },
      async (userId: number) => {
        const owned = await prisma.$queryRaw<{ code: string }[]>`
          SELECT p.code FROM "Permission" p
          JOIN "RolePermission" rp ON rp."permissionId" = p.id
          JOIN "UserRole" ur ON ur."roleId" = rp."roleId"
          WHERE ur."userId" = ${userId} AND p.code = 'board:view'`;
        return owned.length > 0;
      },
    );
    await app.listen(0); // 随机端口，避免并发套件冲突
    const address = app.getHttpServer().address() as { port: number };
    baseUrl = `http://localhost:${address.port}`;
  });

  afterAll(async () => {
    ioServer?.close();
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    await seedRbacForTest(prisma);
    adminToken = (await login(app, 'admin', 'Admin@123')).accessToken;
    operatorToken = (await login(app, 'operator', 'User@123')).accessToken;
  });

  it('用例2：无 token / 无效 token / 过期 token 握手均被拒', async () => {
    await expect(handshake(undefined)).resolves.toMatchObject({ ok: false, message: expect.stringContaining('no token') });
    await expect(handshake('not.a.jwt')).resolves.toMatchObject({ ok: false, message: expect.stringContaining('rejected') });
    const expired = (app.get(JwtService) as JwtService).sign({ sub: 1 }, { expiresIn: '-10s' });
    await expect(handshake(expired)).resolves.toMatchObject({ ok: false, message: expect.stringContaining('rejected') });
  });

  it('用例3：无 board:view 权限（operator）握手被拒；admin 可连', async () => {
    await expect(handshake(operatorToken)).resolves.toMatchObject({ ok: false, message: expect.stringContaining('board:view') });
    await expect(handshake(adminToken)).resolves.toMatchObject({ ok: true });
  });

  it('用例5：只 watch wc:A 收不到 wc:B 的事件；用例4：watch 后恰收一份（不与 all 重复）', async () => {
    const wcA = client(adminToken);
    const wcB = client(adminToken);
    const all = client(adminToken);
    const evA: unknown[] = [];
    const evB: unknown[] = [];
    const evAll: unknown[] = [];
    await Promise.all([
      new Promise<void>((r) => wcA.on('connect', () => { wcA.emit('watch-wc', 1); setTimeout(r, 200); })),
      new Promise<void>((r) => wcB.on('connect', () => { wcB.emit('watch-wc', 2); setTimeout(r, 200); })),
      new Promise<void>((r) => all.on('connect', () => { all.emit('watch-wc', null); setTimeout(r, 200); })),
    ]);
    wcA.on('work-report.created', (e: unknown) => evA.push(e));
    wcB.on('work-report.created', (e: unknown) => evB.push(e));
    all.on('work-report.created', (e: unknown) => evAll.push(e));

    app.get(BoardGateway).onWorkReportCreated({
      workOrderId: 1, workOrderCode: 'WO-1', operationId: 1, operationName: 'op',
      goodQty: 1, defectQty: 0, employeeName: 'e', workCenterId: 1, at: new Date().toISOString(),
    });
    await new Promise((r) => setTimeout(r, 400));
    expect(evA).toHaveLength(1);
    expect(evB).toHaveLength(0);
    expect(evAll).toHaveLength(1);
    wcA.disconnect(); wcB.disconnect(); all.disconnect();
  });

  it('用例6：事件风暴 50 连发——watch 同房间的 socket 恰收 50 份、不重不漏', async () => {
    const watcher = client(adminToken);
    await new Promise<void>((r) => watcher.on('connect', () => { watcher.emit('watch-wc', 7); setTimeout(r, 200); }));
    const got: unknown[] = [];
    watcher.on('work-report.created', (e: unknown) => got.push(e));
    const gateway = app.get(BoardGateway);
    for (let i = 0; i < 50; i += 1) {
      gateway.onWorkReportCreated({
        workOrderId: i, workOrderCode: `WO-${i}`, operationId: 1, operationName: 'op',
        goodQty: 1, defectQty: 0, employeeName: 'e', workCenterId: 7, at: new Date().toISOString(),
      });
    }
    await new Promise((r) => setTimeout(r, 600));
    expect(got).toHaveLength(50);
    watcher.disconnect();
  });

  it('用例8：事件 payload 只带 id/编码/数量/姓名摘要，不含成本、明细等敏感字段', async () => {
    const watcher = client(adminToken);
    await new Promise<void>((r) => watcher.on('connect', () => { watcher.emit('watch-wc', 9); setTimeout(r, 200); }));
    const got: Record<string, unknown>[] = [];
    watcher.on('equipment.status-changed', (e: Record<string, unknown>) => got.push(e));
    app.get(BoardGateway).onEquipmentStatusChanged({
      equipmentId: 3, equipmentCode: 'EQ-3', equipmentName: '设备3', workCenterId: 9,
      fromStatus: 'IDLE', toStatus: 'RUNNING', at: new Date().toISOString(),
    });
    await new Promise((r) => setTimeout(r, 400));
    expect(got).toHaveLength(1);
    const allowed = new Set(['equipmentId', 'equipmentCode', 'equipmentName', 'workCenterId', 'fromStatus', 'toStatus', 'at']);
    for (const key of Object.keys(got[0])) expect(allowed.has(key)).toBe(true);
    watcher.disconnect();
  });
});
