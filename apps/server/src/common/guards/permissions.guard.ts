import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '../exceptions/business.exception';
import { BusinessException } from '../exceptions/business.exception';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { IS_PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 全局权限守卫：注册在 JwtAuthGuard 之后（见 app.module.ts 的 APP_GUARD 顺序）。
 *
 * 生效策略（ADR-002）：**每次请求查库取用户权限码**。
 * 角色权限改了、用户角色变了，下一次请求立即生效，不需要重新登录；
 * 项目规模下每次一两个查询的开销可以接受，换来的是不引入缓存失效的复杂度。
 *
 * 规则：
 * - @Public() 直接放行（未登录也允许）；
 * - 没有声明 @Permissions 的接口：只要求登录（鉴权防线在扫描测试里兜底，见 test/permissions-scan）；
 * - 声明了 @Permissions：所需的每个码用户都必须拥有，否则 403（code 1003）。
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<string[]>(IS_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as { id: number } | undefined;
    // JwtAuthGuard 在前面已跑过，user 理论上必在；防御式兜底
    if (!user) throw new BusinessException(ErrorCode.UNAUTHORIZED);

    const owned = await this.getUserPermissionCodes(user.id);
    const missing = required.filter((c) => !owned.has(c));
    if (missing.length > 0) {
      throw new BusinessException(ErrorCode.FORBIDDEN, `无权限，缺少：${missing.join('、')}`);
    }
    return true;
  }

  /** 每次请求查库：用户 → 用户角色 → 角色权限码 */
  private async getUserPermissionCodes(userId: number): Promise<Set<string>> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId },
      include: {
        role: { include: { rolePermissions: { include: { permission: true } } } },
      },
    });
    const codes = new Set<string>();
    for (const ur of userRoles) {
      for (const rp of ur.role.rolePermissions) codes.add(rp.permission.code);
    }
    return codes;
  }
}
