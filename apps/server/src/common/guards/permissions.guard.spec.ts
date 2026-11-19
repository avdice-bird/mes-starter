import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { IS_PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { PermissionsGuard } from '../guards/permissions.guard';
import { ErrorCode } from '../exceptions/business.exception';

/** 只 mock Reflector 与 Prisma，验证守卫自身的分支逻辑（测试名用中文描述行为） */
describe('PermissionsGuard（权限守卫）', () => {
  const meta = new Map<symbol | string, unknown>([[IS_PUBLIC_KEY, false]]);
  const reflector = {
    getAllAndOverride: (key: symbol | string) => meta.get(key),
  } as unknown as Reflector;

  const ownedCodes = new Set(['material:view']);
  const prismaMock = {
    userRole: {
      // 模拟用户拥有 material:view 一个码
      findMany: jest.fn().mockImplementation(async () => [
        { role: { rolePermissions: [...ownedCodes].map((code) => ({ permission: { code } })) } },
      ]),
    },
  };
  const prisma = prismaMock as unknown as PrismaService;

  const guard = new PermissionsGuard(reflector, prisma);

  function makeContext(user?: unknown): ExecutionContext {
    return {
      getHandler: () => () => undefined,
      getClass: () => class Controller {},
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
  }

  it('没有 @Permissions 装饰器的接口，登录即可访问', async () => {
    meta.delete(IS_PERMISSIONS_KEY);
    await expect(guard.canActivate(makeContext({ id: 1 }))).resolves.toBe(true);
  });

  it('@Public() 的接口直接放行，不查权限', async () => {
    meta.set(IS_PERMISSIONS_KEY, ['user:delete']);
    meta.set(IS_PUBLIC_KEY, true);
    await expect(guard.canActivate(makeContext(undefined))).resolves.toBe(true);
    meta.set(IS_PUBLIC_KEY, false);
  });

  it('接口声明了权限码而用户没有，应抛 403（code 1003）', async () => {
    meta.set(IS_PERMISSIONS_KEY, ['user:delete']);
    await expect(guard.canActivate(makeContext({ id: 1 }))).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
  });

  it('接口声明的权限码用户都有，应放行', async () => {
    meta.set(IS_PERMISSIONS_KEY, ['material:view']);
    await expect(guard.canActivate(makeContext({ id: 1 }))).resolves.toBe(true);
  });
});
