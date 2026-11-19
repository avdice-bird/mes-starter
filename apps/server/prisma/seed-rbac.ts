/**
 * RBAC 种子逻辑：可反复执行（upsert 幂等），被 prisma/seed.ts 和 e2e 测试共用。
 */
import type { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { MENUS, PERMISSIONS, ROLES, USERS } from './rbac-data';

/** 幂等写入 RBAC 全部种子数据。传入的 prisma 实例由调用方负责断连。 */
export async function seedRbac(prisma: PrismaClient) {
  // 1. 权限码
  const permIdByCode = new Map<string, number>();
  for (const [code, name, module] of PERMISSIONS) {
    const p = await prisma.permission.upsert({
      where: { code }, update: { name, module },
      create: { code, name, module },
    });
    permIdByCode.set(code, p.id);
  }

  // 2. 角色 + 角色-权限
  for (const role of ROLES) {
    const r = await prisma.role.upsert({
      where: { code: role.code },
      update: { name: role.name, isBuiltin: role.isBuiltin },
      create: { code: role.code, name: role.name, isBuiltin: role.isBuiltin },
    });
    const codes = role.codes === 'ALL' ? [...permIdByCode.keys()] : role.codes;
    const desiredIds = codes.map((code) => permIdByCode.get(code)!);
    // 种子是角色权限的正本：删掉定义里已移除的旧授权，避免数据库残留造成越权
    await prisma.rolePermission.deleteMany({
      where: { roleId: r.id, permissionId: { notIn: desiredIds } },
    });
    for (const code of codes) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: r.id, permissionId: permIdByCode.get(code)! } },
        update: {},
        create: { roleId: r.id, permissionId: permIdByCode.get(code)! },
      });
    }
  }

  // 3. 菜单（先目录后叶子；按 parentPath 挂接）
  const menuIdByPath = new Map<string, number>();
  for (const m of MENUS) {
    const parentId = m.parentPath ? menuIdByPath.get(m.parentPath) ?? null : null;
    const menu = await prisma.menu.upsert({
      where: { path: m.path },
      update: { parentId, name: m.name, icon: m.icon, component: m.component, permissionCode: m.permissionCode, sort: m.sort },
      create: { parentId, path: m.path, name: m.name, icon: m.icon, component: m.component, permissionCode: m.permissionCode, sort: m.sort },
    });
    menuIdByPath.set(m.path, menu.id);
  }

  // 4. 用户 + 用户-角色
  for (const u of USERS) {
    const user = await prisma.user.upsert({
      where: { username: u.username },
      update: { name: u.name },
      create: { username: u.username, password: await bcrypt.hash(u.password, 10), name: u.name },
    });
    const role = await prisma.role.findUnique({ where: { code: u.roleCode } });
    if (role) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: role.id } },
        update: {},
        create: { userId: user.id, roleId: role.id },
      });
    }
  }
}
