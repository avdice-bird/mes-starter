import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { createTestApp, resetDb, seedRbacForTest, login } from './helpers/app';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';

/**
 * 越权攻击测试（与 permissions-matrix / attack-report 互补，只测既有套件没覆盖的面）：
 * A. JWT 伪造与混用——直接打鉴权层（payload 篡改、错误密钥、alg:none、双 token 混用、信任头伪造）
 * B. 匿名全路由扫描——从源码收集全部 Controller 路由，匿名逐个探测：非 @Public 一律 401
 *    （permissions-matrix 只对部分接口有"匿名"行，这里是全量兜底）
 * C. 垂直矩阵缺口——inspection / inventory / andon / board / dispatch / reports /
 *    attachment / equipment-status / ai / notifications 这些模块在 matrix 里没有行
 * D. 提权语义——低权角色对自己 id 分配角色 / 改资料，应先被权限码拦下（403）
 *
 * 攻击者视角：合法格式但非法内容的凭证 + 匿名 + 低权账号，验证防线全部在"业务逻辑之前"生效。
 */

/** base64url 编码（JWT 分段格式），Buffer 原生支持 */
const b64url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');

/** 用任意密钥手签 HS256（攻击者密钥不在服务器信任列表内） */
function forgeToken(payload: Record<string, unknown>, secret: string, alg = 'HS256'): string {
  const header = { alg, typ: 'JWT' };
  const signedContent = `${b64url(header)}.${b64url(payload)}`;
  const sig = crypto.createHmac('sha256', secret).update(signedContent).digest('base64url');
  return `${signedContent}.${sig}`;
}

/** 拿一个真实 token 改 payload 但保留原签名（签名校验必须拦下） */
function tamperPayload(token: string, patch: Record<string, unknown>): string {
  const [h, p, s] = token.split('.');
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  return `${h}.${b64url({ ...payload, ...patch })}.${s}`;
}

interface RouteProbe { method: string; path: string; isPublic: boolean; file: string }

/**
 * 逐行状态机扫描 Controller 源码，收集 (method, path, 是否 @Public)。
 * @Public 可出现在 HTTP 装饰器之前（auth.login）或之后（health），
 * 用"下一个方法 public"和"当前方法已见 public"两个旗子两种顺序都覆盖。
 * 同文件多个 @Controller 类（andon.ts 里还有 notifications）按 prefix 切换处理。
 */
function collectRoutes(modulesDir: string): RouteProbe[] {
  const RE_CONTROLLER = /@Controller\(\s*(?:'([^']*)')?\s*\)/;
  const RE_METHOD = /@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)')?\s*\)/;

  const collectFile = (file: string): RouteProbe[] => {
    const out: RouteProbe[] = [];
    let prefix = '';
    let pending: { method: string; path: string } | null = null;
    let pendingIsPublic = false;
    let publicForNext = false;
    const flush = () => {
      if (pending) {
        out.push({
          method: pending.method,
          path: `api/${prefix}/${pending.path}`.replace(/\/+/g, '/').replace(/\/$/, ''),
          isPublic: pendingIsPublic,
          file,
        });
      }
      pending = null;
      pendingIsPublic = false;
    };
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const ctrl = line.match(RE_CONTROLLER);
      if (ctrl) {
        flush();
        prefix = ctrl[1] ?? '';
        publicForNext = false;
        continue;
      }
      const m = line.match(RE_METHOD);
      if (m) {
        flush();
        pending = { method: m[1].toUpperCase(), path: m[2] ?? '' };
        pendingIsPublic = publicForNext;
        publicForNext = false;
        continue;
      }
      if (/^\s*@Public\(\)/.test(line)) {
        if (pending) pendingIsPublic = true;
        else publicForNext = true;
        continue;
      }
      // 首个非装饰器、非空行 = 进入方法体/签名：本方法的装饰器堆叠已结束。
      // 没有这步，下一个方法的 @Public()（写在上一方法体之后）会被错记到上一个方法头上
      if (!/^\s*@/.test(line) && line.trim() !== '') flush();
    }
    flush();
    return out;
  };

  const walk = (dir: string): string[] => {
    const files: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) files.push(...walk(full));
      else if (entry.name.endsWith('.controller.ts')) files.push(full);
    }
    return files;
  };

  return walk(modulesDir).flatMap(collectFile);
}

/** 路径参数统一替换为 1（探测只关心"路由可达后守卫是否拦下"，不关心资源存在） */
const probePath = (p: string) => `/${p}`.replace(/:[A-Za-z0-9_]+/g, '1');

describe('越权攻击 A：JWT 伪造与双 token 混用（打鉴权层）', () => {
  let app: INestApplication; let prisma: PrismaService;
  let adminToken: string; let adminRefresh: string;
  const api = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await resetDb(prisma);
    await seedRbacForTest(prisma);
    const pair = await login(app, 'admin', 'Admin@123');
    adminToken = pair.accessToken;
    adminRefresh = pair.refreshToken;
  });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it('对照：未篡改的真实 token 应正常访问（证明不是无脑全拒）', async () => {
    const res = await request(api()).get('/api/auth/me').set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.user.username).toBe('admin');
  });

  it('篡改 payload.sub 为别人的 id、保留原签名 → 401', async () => {
    const forged = tamperPayload(adminToken, { sub: 999999 });
    const res = await request(api()).get('/api/auth/me').set(auth(forged));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(1002);
  });

  it('篡改 payload 塞管理员声明（role:admin、permissions:*）保留原签名 → 401', async () => {
    const forged = tamperPayload(adminToken, { role: 'admin', permissions: ['*'] });
    const res = await request(api()).get('/api/auth/me').set(auth(forged));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(1002);
  });

  it('错误密钥自签、带管理员声明与 sub=1 的合法结构 token → 401（签名密钥校验）', async () => {
    const forged = forgeToken({ sub: 1, username: 'admin', role: 'admin', permissions: ['*'] }, 'attacker-secret');
    const res = await request(api()).get('/api/users').set(auth(forged));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(1002);
  });

  it('alg:none 空签名伪造 token → 401（算法白名单）', async () => {
    const forged = forgeToken({ sub: 1, username: 'admin' }, 'whatever', 'none');
    const res = await request(api()).get('/api/users').set(auth(forged));
    expect(res.status).toBe(401);
  });

  it('签名合法但 sub 指向不存在的用户 → 401（每请求查库，不认凭证不认人）', async () => {
    const jwt = app.get(JwtService);
    const validSigGhostUser = jwt.sign({ sub: 999999, username: 'ghost' });
    const res = await request(api()).get('/api/auth/me').set(auth(validSigGhostUser));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(1002);
  });

  it('格式混乱：空 Bearer / 无 Bearer 前缀裸 token / 垃圾字符串 → 全部 401', async () => {
    const bare = await request(api()).get('/api/auth/me').set('Authorization', '');
    const noScheme = await request(api()).get('/api/auth/me').set('Authorization', adminToken);
    const garbage = await request(api()).get('/api/auth/me').set('Authorization', 'Bearer %%%not-a-jwt%%');
    expect(bare.status).toBe(401);
    expect(noScheme.status).toBe(401);
    expect(garbage.status).toBe(401);
  });

  it('refresh token 当 access token 打业务接口 → 401（双 token 不混用）', async () => {
    const res = await request(api()).get('/api/users').set(auth(adminRefresh));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(1002);
  });

  it('access token 当 refresh token 换新 → 校验层/服务层拒绝，绝不签发新 token 对', async () => {
    const res = await request(api()).post('/api/auth/refresh').send({ refreshToken: adminToken });
    // refresh token 是 ≤128 位随机串，JWT 远超上限 → 校验层 400 拒；即便放行到服务层也须 401
    expect([400, 401]).toContain(res.status);
    const data = (res.body?.data ?? {}) as Record<string, unknown>;
    expect(data.accessToken).toBeUndefined();
    expect(data.refreshToken).toBeUndefined();
  });

  it('伪造信任头（X-User-Id / X-Forwarded-User）匿名请求 → 仍 401（后端不信任请求头）', async () => {
    const res = await request(api()).get('/api/users')
      .set('X-User-Id', '1')
      .set('X-Forwarded-User', 'admin');
    expect(res.status).toBe(401);
  });
});

describe('越权攻击 B：匿名全路由扫描（非 @Public 一律 401）', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });
  afterAll(async () => { await app.close(); });

  it('@Public 路由集合恰为 health + login + captcha + refresh（多一个或少一个都失败）', () => {
    const routes = collectRoutes(path.resolve(__dirname, '../src/modules'));
    expect(routes.length).toBeGreaterThan(50);
    const publics = routes.filter((r) => r.isPublic)
      .map((r) => `${r.method} /${r.path}`).sort();
    expect(publics).toEqual([
      'GET /api/health',
      'POST /api/auth/captcha',
      'POST /api/auth/login',
      'POST /api/auth/refresh',
    ]);
  });

  it('匿名探测全部非 @Public 路由：一律 401，不允许 404/500 泄漏路由可达性', async () => {
    const routes = collectRoutes(path.resolve(__dirname, '../src/modules'))
      .filter((r) => !r.isPublic);
    expect(routes.length).toBeGreaterThan(50);

    const offenders: string[] = [];
    for (const r of routes) {
      const res = await request(app.getHttpServer())[r.method.toLowerCase() as 'get'](probePath(r.path));
      if (res.status !== 401) offenders.push(`${r.method} /${r.path} → ${res.status} (${r.file})`);
    }
    // 404 说明测试自身拼错了路由或收集出错；200/500 说明鉴权防线缺失或异常泄漏
    expect(offenders).toEqual([]);
  }, 120_000);
});

describe('越权攻击 C：垂直矩阵缺口模块（低权 403 / 有权方对照）', () => {
  let app: INestApplication; let prisma: PrismaService;
  const tokens: Partial<Record<'admin' | 'planner' | 'operator' | 'qc' | 'maintainer', string>> = {};

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await resetDb(prisma);
    await seedRbacForTest(prisma);
    tokens.admin = (await login(app, 'admin', 'Admin@123')).accessToken;
    tokens.planner = (await login(app, 'planner', 'User@123')).accessToken;
    tokens.operator = (await login(app, 'operator', 'User@123')).accessToken;
    tokens.qc = (await login(app, 'qc', 'User@123')).accessToken;
    tokens.maintainer = (await login(app, 'maintainer', 'User@123')).accessToken;
  });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  type Role = keyof typeof tokens;
  /** want 为精确断言；不存在 id 的写入行有权方过守卫后由业务层拒（错误码随夹具），断言不再是 403/401 */
  const cases: { m: 'GET' | 'POST'; p: string; url: () => string; role: Role | null; body?: () => Record<string, unknown>; want?: number; notWant?: number[] }[] = [
    // inventory：planner 有 inventory:view/adjust；qc/maintainer/operator 全无
    { m: 'GET', p: '/api/inventory/balances', url: () => '/api/inventory/balances', role: 'planner', want: 200 },
    { m: 'GET', p: '/api/inventory/balances', url: () => '/api/inventory/balances', role: 'qc', want: 403 },
    { m: 'GET', p: '/api/inventory/balances', url: () => '/api/inventory/balances', role: 'operator', want: 403 },
    { m: 'POST', p: '/api/inventory/adjust', url: () => '/api/inventory/adjust', role: 'planner', body: () => ({}), notWant: [401, 403] },
    { m: 'POST', p: '/api/inventory/adjust', url: () => '/api/inventory/adjust', role: 'maintainer', body: () => ({}), want: 403 },
    { m: 'POST', p: '/api/inventory/material-issues/generate/999999', url: () => '/api/inventory/material-issues/generate/999999', role: 'planner', notWant: [401, 403] },
    { m: 'POST', p: '/api/inventory/material-issues/generate/999999', url: () => '/api/inventory/material-issues/generate/999999', role: 'operator', want: 403 },
    { m: 'POST', p: '/api/inventory/receipts/999999', url: () => '/api/inventory/receipts/999999', role: 'planner', notWant: [401, 403] },
    { m: 'POST', p: '/api/inventory/receipts/999999', url: () => '/api/inventory/receipts/999999', role: 'operator', want: 403 },

    // inspection：qc 全权；operator/maintainer 无任何 inspection 码
    { m: 'GET', p: '/api/inspections', url: () => '/api/inspections', role: 'qc', want: 200 },
    { m: 'GET', p: '/api/inspections', url: () => '/api/inspections', role: 'operator', want: 403 },
    { m: 'GET', p: '/api/inspections', url: () => '/api/inspections', role: 'maintainer', want: 403 },
    { m: 'POST', p: '/api/inspections/999999/submit', url: () => '/api/inspections/999999/submit', role: 'qc', body: () => ({}), notWant: [401, 403] },
    { m: 'POST', p: '/api/inspections/999999/submit', url: () => '/api/inspections/999999/submit', role: 'operator', body: () => ({}), want: 403 },

    // andon：operator 有 view/create（发起呼叫是合法的），无 respond/close
    { m: 'GET', p: '/api/andon-calls', url: () => '/api/andon-calls', role: 'operator', want: 200 },
    { m: 'GET', p: '/api/andon-calls', url: () => '/api/andon-calls', role: 'planner', want: 200 },
    { m: 'POST', p: '/api/andon-calls/999999/respond', url: () => '/api/andon-calls/999999/respond', role: 'operator', body: () => ({}), want: 403 },
    { m: 'POST', p: '/api/andon-calls/999999/respond', url: () => '/api/andon-calls/999999/respond', role: 'planner', body: () => ({}), notWant: [401, 403] },
    { m: 'POST', p: '/api/andon-calls/999999/close', url: () => '/api/andon-calls/999999/close', role: 'operator', body: () => ({}), want: 403 },
    { m: 'POST', p: '/api/andon-calls/999999/close', url: () => '/api/andon-calls/999999/close', role: 'qc', body: () => ({}), notWant: [401, 403] },

    // board / notifications：看板要 board:view（operator 无）；站内信登录即有 notification:view
    { m: 'GET', p: '/api/board/summary', url: () => '/api/board/summary', role: 'planner', want: 200 },
    { m: 'GET', p: '/api/board/summary', url: () => '/api/board/summary', role: 'operator', want: 403 },
    { m: 'GET', p: '/api/notifications', url: () => '/api/notifications', role: 'operator', want: 200 },
    { m: 'GET', p: '/api/notifications', url: () => '/api/notifications', role: 'qc', want: 200 },
    { m: 'POST', p: '/api/notifications/999999/read', url: () => '/api/notifications/999999/read', role: 'maintainer', notWant: [401, 403] },

    // dispatch：operator 有 view/start（报工需要），无 assign
    { m: 'GET', p: '/api/work-order-operations/work-order/999999', url: () => '/api/work-order-operations/work-order/999999', role: 'planner', notWant: [401, 403] },
    { m: 'GET', p: '/api/work-order-operations/work-order/999999', url: () => '/api/work-order-operations/work-order/999999', role: 'operator', want: 200 },
    { m: 'POST', p: '/api/work-order-operations/999999/start', url: () => '/api/work-order-operations/999999/start', role: 'operator', body: () => ({}), notWant: [401, 403] },
    { m: 'POST', p: '/api/work-order-operations/999999/assign', url: () => '/api/work-order-operations/999999/assign', role: 'operator', body: () => ({}), want: 403 },

    // equipment-status / downtime：maintainer 专管；qc 只读名单里没有它
    { m: 'POST', p: '/api/equipment/999999/status', url: () => '/api/equipment/999999/status', role: 'qc', body: () => ({}), want: 403 },
    { m: 'POST', p: '/api/equipment/999999/status', url: () => '/api/equipment/999999/status', role: 'maintainer', body: () => ({}), notWant: [401, 403] },
    { m: 'GET', p: '/api/equipment/downtimes', url: () => '/api/equipment/downtimes', role: 'maintainer', want: 200 },
    { m: 'GET', p: '/api/equipment/downtimes', url: () => '/api/equipment/downtimes', role: 'qc', want: 403 },

    // reports / attachments / ai：只读报表与导出按码拦截；ai 查询低权全拒（有权方涉及外部调用不在此验证）
    { m: 'GET', p: '/api/reports/yield', url: () => '/api/reports/yield', role: 'operator', want: 403 },
    { m: 'GET', p: '/api/reports/yield', url: () => '/api/reports/yield', role: 'qc', want: 403 },
    { m: 'GET', p: '/api/attachments', url: () => '/api/attachments', role: 'planner', notWant: [401, 403] }, // 列表要求 refType/refId，缺参是业务校验，不该是权限错
    { m: 'GET', p: '/api/attachments', url: () => '/api/attachments', role: 'operator', want: 403 },
    { m: 'POST', p: '/api/attachments', url: () => '/api/attachments', role: 'operator', body: () => ({}), want: 403 },
    { m: 'POST', p: '/api/ai/query', url: () => '/api/ai/query', role: 'operator', body: () => ({}), want: 403 },
    { m: 'POST', p: '/api/ai/query', url: () => '/api/ai/query', role: 'qc', body: () => ({}), want: 403 },
    { m: 'POST', p: '/api/ai/query', url: () => '/api/ai/query', role: 'maintainer', body: () => ({}), want: 403 },
  ];

  let i = 0;
  for (const c of cases) {
    i += 1;
    it(`越权 ${String(i).padStart(2, '0')}  ${c.m} ${c.p} as ${c.role ?? '匿名'}${c.want !== undefined ? ` → ${c.want}` : ` → 非 ${c.notWant!.join('/')}`}`, async () => {
      const req = request(app.getHttpServer())[c.m.toLowerCase() as 'get' | 'post'](c.url());
      if (c.role && tokens[c.role]) req.set('Authorization', `Bearer ${tokens[c.role]}`);
      if (c.body) req.send(c.body());
      const res = await req;
      if (c.want !== undefined) expect(res.status).toBe(c.want);
      else expect(c.notWant!).not.toContain(res.status);
    });
  }
});

describe('越权攻击 D：提权语义（低权角色改自己也不行）', () => {
  let app: INestApplication; let prisma: PrismaService;
  let operatorToken: string; let qcToken: string; let operatorId: number; let qcId: number;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await resetDb(prisma);
    await seedRbacForTest(prisma);
    operatorToken = (await login(app, 'operator', 'User@123')).accessToken;
    qcToken = (await login(app, 'qc', 'User@123')).accessToken;
    operatorId = (await prisma.user.findUniqueOrThrow({ where: { username: 'operator' } })).id;
    qcId = (await prisma.user.findUniqueOrThrow({ where: { username: 'qc' } })).id;
  });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it('operator 给自己的 id 分配 admin 角色 → 403（先被 user:assign-role 拦下）', async () => {
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
    const res = await request(app.getHttpServer())
      .put(`/api/users/${operatorId}/roles`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ roleIds: [adminRole.id] });
    expect(res.status).toBe(403);
    // 且没有真的提上权
    const roles = await prisma.userRole.count({ where: { userId: operatorId, roleId: adminRole.id } });
    expect(roles).toBe(0);
  });

  it('qc PATCH 自己的资料 → 403（user:update 也没有）', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/users/${qcId}`)
      .set('Authorization', `Bearer ${qcToken}`)
      .send({ name: '提权改名' });
    expect(res.status).toBe(403);
    const name = (await prisma.user.findUniqueOrThrow({ where: { id: qcId } })).name;
    expect(name).not.toBe('提权改名');
  });
});
