import { Injectable } from '@nestjs/common';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AssignPermissionsDto, CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import { RoleRow } from '@mes/shared';

type RoleWithCount = {
  id: number; code: string; name: string; remark: string | null; isBuiltin: boolean;
  createdAt: Date; _count: { userRoles: number; rolePermissions: number };
  rolePermissions?: { permissionId: number }[];
};

function toRow(role: RoleWithCount): RoleRow {
  return {
    id: role.id,
    code: role.code,
    name: role.name,
    remark: role.remark,
    isBuiltin: role.isBuiltin,
    userCount: role._count.userRoles,
    permissionCount: role._count.rolePermissions,
    permissionIds: (role.rolePermissions ?? []).map((rp) => rp.permissionId),
    createdAt: role.createdAt.toISOString(),
  };
}

const includeCount = { _count: { select: { userRoles: true, rolePermissions: true } } } as const;

@Injectable()
export class RoleService {
  constructor(private prisma: PrismaService) {}

  async list(): Promise<RoleRow[]> {
    const roles = await this.prisma.role.findMany({ include: includeCount, orderBy: { id: 'asc' } });
    return roles.map(toRow);
  }

  async findOne(id: number): Promise<RoleRow> {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { ...includeCount, rolePermissions: { select: { permissionId: true } } },
    });
    if (!role) throw new BusinessException(ErrorCode.NOT_FOUND, '角色不存在');
    return toRow(role);
  }

  async create(dto: CreateRoleDto): Promise<RoleRow> {
    const exists = await this.prisma.role.findUnique({ where: { code: dto.code } });
    if (exists) throw new BusinessException(ErrorCode.CONFLICT, `角色编码 ${dto.code} 已存在`);
    const role = await this.prisma.role.create({
      data: { code: dto.code, name: dto.name, remark: dto.remark ?? null },
      include: includeCount,
    });
    return toRow(role);
  }

  /** 编辑角色：内置角色（admin 等）拒绝改名（第 7 节用例 4）；编码不允许改 */
  async update(id: number, dto: UpdateRoleDto): Promise<RoleRow> {
    const role = await this.findExisting(id);
    if (role.isBuiltin) {
      throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, '内置角色不允许修改');
    }
    const updated = await this.prisma.role.update({
      where: { id }, data: { name: dto.name, remark: dto.remark }, include: includeCount,
    });
    return toRow(updated);
  }

  /**
   * 删除角色（第 7 节用例 3、4）：
   * - 内置角色拒绝；
   * - 仍有关联用户时拒绝，并提示关联用户数（前端据此引导先转移用户）。
   */
  async remove(id: number): Promise<void> {
    const role = await this.findExisting(id);
    if (role.isBuiltin) {
      throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, '内置角色不允许删除');
    }
    if (role._count.userRoles > 0) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `该角色已关联 ${role._count.userRoles} 个用户，不能删除；请先给这些用户重新分配角色`,
      );
    }
    await this.prisma.role.delete({ where: { id } });
  }

  /** 分配权限（第 7 节用例 4）：admin 等内置角色的权限即"全部"的兜底，不允许改 */
  async assignPermissions(id: number, dto: AssignPermissionsDto): Promise<RoleRow> {
    const role = await this.findExisting(id);
    if (role.isBuiltin) {
      throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, '内置角色不允许修改权限');
    }
    const perms = await this.prisma.permission.findMany({ where: { id: { in: dto.permissionIds } } });
    if (perms.length !== new Set(dto.permissionIds).size) {
      const found = new Set(perms.map((p) => p.id));
      const missing = dto.permissionIds.filter((pid) => !found.has(pid));
      throw new BusinessException(ErrorCode.NOT_FOUND, `权限不存在：${missing.join(', ')}`);
    }
    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId: id } }),
      ...dto.permissionIds.map((permissionId) =>
        this.prisma.rolePermission.create({ data: { roleId: id, permissionId } }),
      ),
    ]);
    return this.findOne(id);
  }

  private async findExisting(id: number): Promise<RoleWithCount> {
    const role = await this.prisma.role.findUnique({ where: { id }, include: includeCount });
    if (!role) throw new BusinessException(ErrorCode.NOT_FOUND, '角色不存在');
    return role;
  }
}
