import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AssignRolesDto, CreateUserDto, QueryUserDto, UpdateUserDto } from './dto/user.dto';
import { PageResult, UserRow } from '@mes/shared';

const userInclude = {
  userRoles: { include: { role: { select: { id: true, code: true, name: true } } } },
} as const;

/** Prisma 查询结果 → 响应行（剔除密码哈希、拍平角色） */
function toRow(user: {
  id: number; username: string; name: string; status: number; createdAt: Date;
  userRoles: { role: { id: number; code: string; name: string } }[];
}): UserRow {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    status: user.status,
    roles: user.userRoles.map((ur) => ur.role),
    createdAt: user.createdAt.toISOString(),
  };
}

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  async list(query: QueryUserDto): Promise<PageResult<UserRow>> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 20));
    const where = query.keyword
      ? { OR: [{ username: { contains: query.keyword } }, { name: { contains: query.keyword } }] }
      : {};
    const [total, list] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        include: userInclude,
        orderBy: { id: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { list: list.map(toRow), total, page, pageSize };
  }

  async findOne(id: number): Promise<UserRow> {
    const user = await this.prisma.user.findUnique({ where: { id }, include: userInclude });
    if (!user) throw new BusinessException(ErrorCode.NOT_FOUND, '用户不存在');
    return toRow(user);
  }

  async create(dto: CreateUserDto): Promise<UserRow> {
    const exists = await this.prisma.user.findUnique({ where: { username: dto.username.trim() } });
    if (exists) throw new BusinessException(ErrorCode.CONFLICT, `用户名 ${dto.username} 已存在`);
    const user = await this.prisma.user.create({
      data: {
        username: dto.username.trim(),
        password: await bcrypt.hash(dto.password, 10),
        name: dto.name,
      },
      include: userInclude,
    });
    return toRow(user);
  }

  async update(id: number, dto: UpdateUserDto, currentUserId: number): Promise<UserRow> {
    await this.findExisting(id);
    // 停用自己会导致自己立刻被踢下线，属误操作高危区，直接禁止
    if (id === currentUserId && dto.status === 0) {
      throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, '不能停用当前登录用户');
    }
    const data: { name?: string; password?: string; status?: number } = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.password !== undefined) data.password = await bcrypt.hash(dto.password, 10);
    if (dto.status !== undefined) data.status = dto.status;
    const user = await this.prisma.user.update({ where: { id }, data, include: userInclude });
    return toRow(user);
  }

  /**
   * 删除用户：拒绝删除自己（第 7 节用例 5）；
   * refresh token、用户角色关系与用户同事务删除，不留孤儿数据
   */
  async remove(id: number, currentUserId: number): Promise<void> {
    await this.findExisting(id);
    if (id === currentUserId) {
      throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, '不能删除当前登录用户');
    }
    await this.prisma.$transaction([
      this.prisma.refreshToken.deleteMany({ where: { userId: id } }),
      this.prisma.userRole.deleteMany({ where: { userId: id } }),
      this.prisma.user.delete({ where: { id } }),
    ]);
  }

  /**
   * 分配角色（第 7 节用例 10）：只允许 user:assign-role 权限调用（守卫拦），
   * 且不允许修改自己的角色——否则有该权限的人可以给自己加 admin，权限体系形同虚设。
   */
  async assignRoles(id: number, dto: AssignRolesDto, currentUserId: number): Promise<UserRow> {
    await this.findExisting(id);
    if (id === currentUserId) {
      throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, '不能修改自己的角色');
    }
    const roles = await this.prisma.role.findMany({ where: { id: { in: dto.roleIds } } });
    if (roles.length !== new Set(dto.roleIds).size) {
      const found = new Set(roles.map((r) => r.id));
      const missing = dto.roleIds.filter((rid) => !found.has(rid));
      throw new BusinessException(ErrorCode.NOT_FOUND, `角色不存在：${missing.join(', ')}`);
    }
    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId: id } }),
      ...dto.roleIds.map((roleId) =>
        this.prisma.userRole.create({ data: { userId: id, roleId } }),
      ),
    ]);
    return this.findOne(id);
  }

  private async findExisting(id: number) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new BusinessException(ErrorCode.NOT_FOUND, '用户不存在');
    return user;
  }
}
