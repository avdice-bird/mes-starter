import { Injectable } from '@nestjs/common';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateMenuDto, UpdateMenuDto } from './dto/menu.dto';
import { MenuNode, MenuRow } from '@mes/shared';

type MenuRecord = {
  id: number; parentId: number | null; path: string; name: string;
  icon: string | null; component: string | null; permissionCode: string | null; sort: number;
};

function toRow(m: MenuRecord): MenuRow {
  return {
    id: m.id, parentId: m.parentId, path: m.path, name: m.name,
    icon: m.icon, component: m.component, permissionCode: m.permissionCode, sort: m.sort,
    children: [],
  };
}

@Injectable()
export class MenuService {
  constructor(private prisma: PrismaService) {}

  /** 管理用全量菜单树 */
  async tree(): Promise<MenuRow[]> {
    const all = await this.prisma.menu.findMany({ orderBy: [{ sort: 'asc' }, { id: 'asc' }] });
    return this.buildTree(all.map(toRow));
  }

  async create(dto: CreateMenuDto): Promise<MenuRow> {
    if (dto.parentId != null) await this.assertParentExists(dto.parentId);
    if (dto.permissionCode) await this.assertPermissionCode(dto.permissionCode);
    if (dto.component && dto.path) {
      // 组件路径与路由路径一一对应由前端约定保证，这里只防明显的重复
    }
    try {
      const menu = await this.prisma.menu.create({ data: { ...dto, sort: dto.sort ?? 0 } });
      return toRow(menu);
    } catch {
      throw new BusinessException(ErrorCode.CONFLICT, `菜单路径 ${dto.path} 已存在`);
    }
  }

  /**
   * 编辑菜单（第 7 节用例 7）：parentId 指向自己或自己的子孙会形成循环，拒绝。
   * 做法：从新 parentId 沿 parent 链向上走，遇到自己即循环；走到根仍没遇到则安全。
   */
  async update(id: number, dto: UpdateMenuDto): Promise<MenuRow> {
    const menu = await this.prisma.menu.findUnique({ where: { id } });
    if (!menu) throw new BusinessException(ErrorCode.NOT_FOUND, '菜单不存在');
    if (dto.parentId != null) {
      if (dto.parentId === id) throw new BusinessException(ErrorCode.MENU_CYCLE, '父菜单不能是自己');
      let cursor: number | null = dto.parentId;
      const guard = new Set<number>();
      while (cursor != null) {
        if (cursor === id) throw new BusinessException(ErrorCode.MENU_CYCLE, '父菜单不能是自己的子孙节点');
        if (guard.has(cursor)) throw new BusinessException(ErrorCode.MENU_CYCLE);
        guard.add(cursor);
        const parent: { parentId: number | null } | null = await this.prisma.menu.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });
        if (!parent) throw new BusinessException(ErrorCode.NOT_FOUND, '父菜单不存在');
        cursor = parent.parentId;
      }
    }
    if (dto.permissionCode) await this.assertPermissionCode(dto.permissionCode);
    const { parentId, path, name, icon, component, permissionCode, sort } = dto;
    try {
      const updated = await this.prisma.menu.update({
        where: { id },
        data: {
          ...(parentId !== undefined ? { parentId } : {}),
          ...(path !== undefined ? { path } : {}),
          ...(name !== undefined ? { name } : {}),
          ...(icon !== undefined ? { icon } : {}),
          ...(component !== undefined ? { component } : {}),
          ...(permissionCode !== undefined ? { permissionCode } : {}),
          ...(sort !== undefined ? { sort } : {}),
        },
      });
      return toRow(updated);
    } catch {
      throw new BusinessException(ErrorCode.CONFLICT, `菜单路径已存在`);
    }
  }

  /** 删除菜单：有子菜单时拒绝（避免孤儿与前端路由悬空） */
  async remove(id: number): Promise<void> {
    const menu = await this.prisma.menu.findUnique({
      where: { id },
      include: { _count: { select: { children: true } } },
    });
    if (!menu) throw new BusinessException(ErrorCode.NOT_FOUND, '菜单不存在');
    if (menu._count.children > 0) {
      throw new BusinessException(ErrorCode.CONFLICT, `该菜单下还有 ${menu._count.children} 个子菜单，请先删除子菜单`);
    }
    await this.prisma.menu.delete({ where: { id } });
  }

  /**
   * /auth/me 用的"我可见的菜单树"：
   * 叶子按权限码过滤；目录不绑码，只要还有可见子节点就保留（否则整支隐藏）。
   */
  async visibleTree(userCodes: Set<string>): Promise<MenuNode[]> {
    const all = await this.prisma.menu.findMany({ orderBy: [{ sort: 'asc' }, { id: 'asc' }] });
    const rows = all.map(toRow).filter((m) => !m.permissionCode || userCodes.has(m.permissionCode));
    const tree = this.buildTree(rows);
    // 目录不绑码：没有可见子节点的目录整支剪掉，避免用户看到空目录
    return this.pruneEmptyCatalogs(tree) as unknown as MenuNode[];
  }

  /** 递归删除没有子节点的目录节点（绑了码的叶子不受影响） */
  private pruneEmptyCatalogs(nodes: MenuRow[]): MenuRow[] {
    const kept: MenuRow[] = [];
    for (const n of nodes) {
      if (n.children.length > 0) {
        n.children = this.pruneEmptyCatalogs(n.children);
        if (n.children.length > 0 || n.permissionCode) kept.push(n);
      } else if (n.permissionCode) {
        kept.push(n);
      }
      // 无码也无子节点的目录节点丢弃
    }
    return kept;
  }

  private buildTree(rows: MenuRow[]): MenuRow[] {
    const byId = new Map<number, MenuRow>(rows.map((r) => [r.id, r]));
    const roots: MenuRow[] = [];
    for (const r of rows) {
      if (r.parentId != null && byId.has(r.parentId)) {
        byId.get(r.parentId)!.children.push(r);
      } else {
        roots.push(r);
      }
    }
    return roots;
  }

  private async assertParentExists(parentId: number) {
    const parent = await this.prisma.menu.findUnique({ where: { id: parentId } });
    if (!parent) throw new BusinessException(ErrorCode.NOT_FOUND, '父菜单不存在');
  }

  private async assertPermissionCode(code: string) {
    const perm = await this.prisma.permission.findUnique({ where: { code } });
    if (!perm) throw new BusinessException(ErrorCode.VALIDATION, `权限码 ${code} 不在权限字典中，请先入种子表`);
  }
}
