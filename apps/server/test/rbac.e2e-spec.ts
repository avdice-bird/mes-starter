import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, resetDb, seedRbacForTest, login } from './helpers/app';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * 第 7 节【磨】RBAC 边界用例（用例编号对应任务卡 07 的表格）。
 * 用例 8（@Permissions 码扫描）在 permissions-scan.e2e-spec.ts。
 */
describe('RBAC 边界用例（第 7 节）', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => { await app.close(); });

  let admin: { accessToken: string };
  let planner: { accessToken: string };
  let plannerUserId: number;

  beforeEach(async () => {
    await resetDb(prisma);
    await seedRbacForTest(prisma);
    admin = await login(app, 'admin', 'Admin@123');
    planner = await login(app, 'planner', 'User@123');
    plannerUserId = (await prisma.user.findUniqueOrThrow({ where: { username: 'planner' } })).id;
  });

  it('用例 1：前端隐藏按钮后直接调接口应被后端拦下（planner 调 POST /users → 403）', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/users')
      .set('Authorization', `Bearer ${planner.accessToken}`)
      .send({ username: 'hacker', password: 'Passw0rd!', name: '越权者' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(1003);
  });

  it('用例 2：修改角色权限后，该角色用户的下一次请求即按新权限生效（无需重新登录）', async () => {
    // planner 的角色本来没有 user:view
    const denied = await request(app.getHttpServer())
      .get('/api/users')
      .set('Authorization', `Bearer ${planner.accessToken}`);
    expect(denied.status).toBe(403);

    // admin 给 planner 角色加上 user:view
    const role = await prisma.role.findUniqueOrThrow({ where: { code: 'planner' } });
    const perm = await prisma.permission.findUniqueOrThrow({ where: { code: 'user:view' } });
    const granted = await request(app.getHttpServer())
      .put(`/api/roles/${role.id}/permissions`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ permissionIds: [perm.id] });
    expect(granted.status).toBe(200);

    // 下一次请求立即生效，不需要重新登录
    const allowed = await request(app.getHttpServer())
      .get('/api/users')
      .set('Authorization', `Bearer ${planner.accessToken}`);
    expect(allowed.status).toBe(200);
  });

  it('用例 3：删除还有用户关联的角色应被拒绝，并提示关联用户数', async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: 'planner' } });
    const res = await request(app.getHttpServer())
      .delete(`/api/roles/${role.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('1 个用户');
  });

  it('用例 4：删除 admin 角色、修改 admin 角色权限都应被拒绝', async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
    const del = await request(app.getHttpServer())
      .delete(`/api/roles/${role.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`);
    expect(del.status).toBe(409); // 内置角色保护：状态不允许（1006），不是权限不足

    const perm = await prisma.permission.findUniqueOrThrow({ where: { code: 'user:view' } });
    const assign = await request(app.getHttpServer())
      .put(`/api/roles/${role.id}/permissions`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ permissionIds: [perm.id] });
    expect(assign.status).toBe(409);
  });

  it('用例 5：删除自己当前登录的用户应被拒绝', async () => {
    const adminUserId = (await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } })).id;
    const res = await request(app.getHttpServer())
      .delete(`/api/users/${adminUserId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(409); // 自操作保护：状态不允许，不是权限不足
  });

  it('用例 6：没有任何角色的用户能登录，菜单为空，业务接口 403', async () => {
    // 建一个无角色用户
    const created = await request(app.getHttpServer())
      .post('/api/users')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ username: 'norole', password: 'User@12345', name: '无角色' });
    expect(created.status).toBe(201);

    const tokens = await login(app, 'norole', 'User@12345');
    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.permissions).toEqual([]);
    expect(me.body.data.menus).toEqual([]);

    const business = await request(app.getHttpServer())
      .get('/api/users')
      .set('Authorization', `Bearer ${tokens.accessToken}`);
    expect(business.status).toBe(403);
  });

  it('用例 7：菜单 parentId 指向自己或子孙应被拒绝（防循环）', async () => {
    const system = await prisma.menu.findUniqueOrThrow({ where: { path: '/system' } });
    const users = await prisma.menu.findUniqueOrThrow({ where: { path: '/system/users' } });

    // 指向自己
    const self = await request(app.getHttpServer())
      .patch(`/api/menus/${users.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ parentId: users.id });
    expect(self.status).toBe(422);
    expect(self.body.code).toBe(2005);

    // 指向自己的子孙（把 /system 挂到 /system/users 下）
    const cycle = await request(app.getHttpServer())
      .patch(`/api/menus/${system.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ parentId: users.id });
    expect(cycle.status).toBe(422);
    expect(cycle.body.code).toBe(2005);
  });

  it('用例 9：禁用用户后，已有 token 立即不能访问', async () => {
    // 禁用前正常
    const before = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${planner.accessToken}`);
    expect(before.status).toBe(200);

    await request(app.getHttpServer())
      .patch(`/api/users/${plannerUserId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ status: 0 });

    const after = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${planner.accessToken}`);
    expect(after.status).toBe(401);
  });

  it('用例 10：分配角色接口需要 user:assign-role；不能给自己分配角色（含 admin）', async () => {
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });

    // planner 没有该权限
    const noPerm = await request(app.getHttpServer())
      .put(`/api/users/${plannerUserId}/roles`)
      .set('Authorization', `Bearer ${planner.accessToken}`)
      .send({ roleIds: [adminRole.id] });
    expect(noPerm.status).toBe(403);

    // admin 有权限但不能改自己的角色（防止给自己加 admin）
    const adminUserId = (await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } })).id;
    const selfAssign = await request(app.getHttpServer())
      .put(`/api/users/${adminUserId}/roles`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ roleIds: [adminRole.id] });
    expect(selfAssign.status).toBe(409); // 自操作保护改为 1006：状态不允许，非权限不足
  });
});
