import { Injectable } from '@nestjs/common';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { isPrismaUniqueViolation } from '../../common/filters/all-exceptions.filter';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/material-category.dto';

export interface CategoryNode {
  id: number;
  parentId: number | null;
  code: string;
  name: string;
  materialCount: number;
  children: CategoryNode[];
}

@Injectable()
export class MaterialCategoryService {
  constructor(private prisma: PrismaService) {}

  /** 全部分类（未删除），平铺返回 */
  private async allFlat() {
    const categories = await this.prisma.materialCategory.findMany({
      where: { isDeleted: false },
      orderBy: [{ id: 'asc' }],
      include: { _count: { select: { materials: { where: { isDeleted: false } } } } },
    });
    return categories.map((c) => ({ ...c, materialCount: c._count.materials, _count: undefined }));
  }

  /** 分类树（列表页 el-tree 用） */
  async tree(): Promise<CategoryNode[]> {
    const flat = await this.allFlat();
    const byId = new Map<number, CategoryNode>();
    for (const c of flat) byId.set(c.id, { ...c, children: [] });
    const roots: CategoryNode[] = [];
    for (const node of byId.values()) {
      const parent = node.parentId != null ? byId.get(node.parentId) : undefined;
      // parentId 指向已删除分类的孤儿节点兜底挂根，避免前端丢数据
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  /** 平铺列表（导入校验复用：按 code 查找用） */
  async list() {
    return this.allFlat();
  }

  async create(dto: CreateCategoryDto, operator: string) {
    if (dto.parentId != null) {
      const parent = await this.prisma.materialCategory.findFirst({
        where: { id: dto.parentId, isDeleted: false },
      });
      if (!parent) throw new BusinessException(ErrorCode.NOT_FOUND, '父分类不存在');
    }
    try {
      return await this.prisma.materialCategory.create({
        data: { parentId: dto.parentId ?? null, code: dto.code, name: dto.name, createdBy: operator, updatedBy: operator },
      });
    } catch (e) {
      if (isPrismaUniqueViolation(e, 'code')) {
        throw new BusinessException(ErrorCode.CONFLICT, `分类编码 ${dto.code} 已存在`);
      }
      throw e;
    }
  }

  async update(id: number, dto: UpdateCategoryDto, operator: string) {
    const category = await this.prisma.materialCategory.findFirst({ where: { id, isDeleted: false } });
    if (!category) throw new BusinessException(ErrorCode.NOT_FOUND, '分类不存在');
    if (dto.parentId !== undefined) {
      await this.assertParentAllowed(id, category.parentId, dto.parentId);
    }
    return this.prisma.materialCategory.update({
      where: { id },
      data: { parentId: dto.parentId ?? null, name: dto.name, updatedBy: operator },
    });
  }

  /** 移动分类：不能挂到自己或自己的后代下（形成环） */
  private async assertParentAllowed(id: number, _currentParentId: number | null, newParentId: number | null) {
    if (newParentId == null) return; // 挂根：无环可能
    if (newParentId === id) throw new BusinessException(ErrorCode.MENU_CYCLE, '父分类不能是自己');
    // 沿新父链向上走，遇到自己即环
    let cursor: number | null = newParentId;
    for (let depth = 0; depth < 32 && cursor != null; depth += 1) {
      const node: { id: number; parentId: number | null; isDeleted: boolean } | null =
        await this.prisma.materialCategory.findUnique({
          where: { id: cursor },
          select: { id: true, parentId: true, isDeleted: true },
        });
      if (!node || node.isDeleted) throw new BusinessException(ErrorCode.NOT_FOUND, '父分类不存在');
      if (node.id === id) throw new BusinessException(ErrorCode.MENU_CYCLE, '父分类不能是自己的子孙节点');
      cursor = node.parentId;
    }
  }

  /** 删除有子分类或物料的分类 → 409 */
  async remove(id: number) {
    const category = await this.prisma.materialCategory.findFirst({
      where: { id, isDeleted: false },
      include: {
        _count: {
          select: {
            materials: { where: { isDeleted: false } },
            children: { where: { isDeleted: false } },
          },
        },
      },
    });
    if (!category) throw new BusinessException(ErrorCode.NOT_FOUND, '分类不存在');
    if (category._count.children > 0) {
      throw new BusinessException(ErrorCode.CONFLICT, `该分类下有 ${category._count.children} 个子分类，请先删除或移动子分类`);
    }
    if (category._count.materials > 0) {
      throw new BusinessException(ErrorCode.CONFLICT, `该分类下有 ${category._count.materials} 个物料，请先转移这些物料`);
    }
    await this.prisma.materialCategory.update({ where: { id }, data: { isDeleted: true, updatedBy: 'system' } });
  }
}
