import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRoutingDto, SaveOperationsDto, UpdateRoutingDto } from './dto/routing.dto';

const SORT_FIELDS = ['id', 'createdAt', 'version'] as const;

const routingInclude = {
  material: { select: { code: true, name: true, type: true } },
  operations: {
    orderBy: { seq: 'asc' as const },
    include: { workCenter: { select: { code: true, name: true } } },
  },
} satisfies Prisma.RoutingInclude;

@Injectable()
export class RoutingService {
  constructor(private prisma: PrismaService) {}

  async list(query: { page?: number; pageSize?: number; keyword?: string; status?: string; sortBy?: string; sortOrder?: string }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const sortBy = SORT_FIELDS.includes(query.sortBy as (typeof SORT_FIELDS)[number])
      ? (query.sortBy as (typeof SORT_FIELDS)[number])
      : 'id';
    const where: Prisma.RoutingWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.keyword && {
        OR: [
          { material: { code: { contains: query.keyword } } },
          { material: { name: { contains: query.keyword } } },
          { version: { contains: query.keyword } },
        ],
      }),
    };
    const [list, total] = await this.prisma.$transaction([
      this.prisma.routing.findMany({
        where, include: { ...routingInclude, _count: { select: { operations: true } } },
        orderBy: { [sortBy]: query.sortOrder ?? 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
      }),
      this.prisma.routing.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  async findOne(id: number) {
    const routing = await this.prisma.routing.findUnique({ where: { id }, include: routingInclude });
    if (!routing) throw new BusinessException(ErrorCode.NOT_FOUND, '工艺路线不存在');
    return routing;
  }

  async create(dto: CreateRoutingDto, operator: string) {
    const material = await this.prisma.material.findFirst({ where: { id: dto.materialId, isDeleted: false } });
    if (!material) throw new BusinessException(ErrorCode.NOT_FOUND, '父物料不存在');
    try {
      return await this.prisma.routing.create({
        data: { materialId: dto.materialId, version: dto.version, remark: dto.remark, createdBy: operator, updatedBy: operator },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new BusinessException(ErrorCode.CONFLICT, `物料已存在路线版本 ${dto.version}`);
      throw e;
    }
  }

  async update(id: number, dto: UpdateRoutingDto, operator: string) {
    const routing = await this.prisma.routing.findUnique({ where: { id } });
    if (!routing) throw new BusinessException(ErrorCode.NOT_FOUND, '工艺路线不存在');
    return this.prisma.routing.update({ where: { id }, data: { remark: dto.remark, updatedBy: operator } });
  }

  /**
   * 工序批量保存（整体覆盖）：seq 重复由 @@unique([routingId, seq]) → 409；
   * 工作中心必须存在；ACTIVE 拒改（409）；标准工时 >0 由 DTO 保证。
   */
  async saveOperations(id: number, dto: SaveOperationsDto, operator: string) {
    const routing = await this.prisma.routing.findUnique({ where: { id } });
    if (!routing) throw new BusinessException(ErrorCode.NOT_FOUND, '工艺路线不存在');
    if (routing.status === 'ACTIVE') {
      throw new BusinessException(ErrorCode.CONFLICT, 'ACTIVE 版本的工序不能修改，请新建版本');
    }
    const wcIds = [...new Set(dto.operations.map((o) => o.workCenterId))];
    const wcs = await this.prisma.workCenter.findMany({ where: { id: { in: wcIds } } });
    if (wcs.length < wcIds.length) throw new BusinessException(ErrorCode.VALIDATION, '存在无效的工作中心');
    if (wcs.some((w) => w.status !== 1)) throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, '存在已停用的工作中心');

    const seqs = dto.operations.map((o) => o.seq);
    if (new Set(seqs).size !== seqs.length) {
      throw new BusinessException(ErrorCode.CONFLICT, '工序 seq 序号重复');
    }
    // 跨 BOM 式环不存在（工序是线性序列），但保存后需重排连续性：seq 允许跳号（10/20/30 风格）
    await this.prisma.$transaction(async (tx) => {
      await tx.routingOperation.deleteMany({ where: { routingId: id } });
      await tx.routingOperation.createMany({
        data: dto.operations.map((o) => ({
          routingId: id, seq: o.seq, code: o.code, name: o.name, workCenterId: o.workCenterId,
          standardMinutes: o.standardMinutes, isInspectionPoint: o.isInspectionPoint ?? false,
          allowSkip: o.allowSkip ?? false, remark: o.remark, createdBy: operator, updatedBy: operator,
        })),
      });
    });
    return this.findOne(id);
  }

  /** 激活：无工序拒绝；同物料旧 ACTIVE 自动 OBSOLETE（同 BOM 策略，同事务） */
  async activate(id: number, operator: string) {
    const routing = await this.prisma.routing.findUnique({ where: { id }, include: { _count: { select: { operations: true } } } });
    if (!routing) throw new BusinessException(ErrorCode.NOT_FOUND, '工艺路线不存在');
    if (routing._count.operations === 0) {
      throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, '路线没有工序，不能激活');
    }
    if (routing.status === 'ACTIVE') return this.findOne(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.routing.updateMany({
        where: { materialId: routing.materialId, status: 'ACTIVE', id: { not: id } },
        data: { status: 'OBSOLETE', updatedBy: operator },
      });
      await tx.routing.update({ where: { id }, data: { status: 'ACTIVE', updatedBy: operator } });
    });
    return this.findOne(id);
  }

  /** 复制为新版本：复制全部工序，新版本 DRAFT（第 21 节用例 4） */
  async copyAsNewVersion(id: number, newVersion: string, operator: string) {
    const source = await this.prisma.routing.findUnique({ where: { id }, include: { operations: true } });
    if (!source) throw new BusinessException(ErrorCode.NOT_FOUND, '工艺路线不存在');
    const created = await this.prisma.$transaction(async (tx) => {
      const copy = await tx.routing.create({
        data: {
          materialId: source.materialId, version: newVersion, status: 'DRAFT',
          effectiveFrom: new Date(), remark: `复制自 ${source.version}`,
          createdBy: operator, updatedBy: operator,
        },
      });
      await tx.routingOperation.createMany({
        data: source.operations.map((o) => ({
          routingId: copy.id, seq: o.seq, code: o.code, name: o.name, workCenterId: o.workCenterId,
          standardMinutes: o.standardMinutes, isInspectionPoint: o.isInspectionPoint, allowSkip: o.allowSkip,
          remark: o.remark, createdBy: operator, updatedBy: operator,
        })),
      });
      return copy;
    });
    return this.findOne(created.id);
  }

  async remove(id: number) {
    const routing = await this.prisma.routing.findUnique({ where: { id } });
    if (!routing) throw new BusinessException(ErrorCode.NOT_FOUND, '工艺路线不存在');
    if (routing.status === 'ACTIVE') throw new BusinessException(ErrorCode.CONFLICT, 'ACTIVE 版本不能删除，请先停用');
    await this.prisma.routing.delete({ where: { id } }); // 工序级联
  }

  /** 某物料当前 ACTIVE 路线（工序按 seq 排序）；没有 → 404 消息明确（第 21 节用例 11） */
  async findActiveByMaterial(materialId: number) {
    const material = await this.prisma.material.findFirst({ where: { id: materialId, isDeleted: false } });
    if (!material) throw new BusinessException(ErrorCode.NOT_FOUND, '物料不存在');
    const routing = await this.prisma.routing.findFirst({
      where: { materialId, status: 'ACTIVE' },
      include: routingInclude,
    });
    if (!routing) {
      throw new BusinessException(ErrorCode.NOT_FOUND, `物料 ${material.code} 没有生效中的工艺路线`);
    }
    return routing;
  }

  /** 重排：按给定顺序重写 seq（拖拽/上下移后前端传 id 数组） */
  async reorder(id: number, orderedIds: number[], operator: string) {
    const routing = await this.prisma.routing.findUnique({ where: { id }, include: { operations: true } });
    if (!routing) throw new BusinessException(ErrorCode.NOT_FOUND, '工艺路线不存在');
    if (routing.status === 'ACTIVE') throw new BusinessException(ErrorCode.CONFLICT, 'ACTIVE 版本的工序不能修改，请新建版本');
    const ids = new Set(routing.operations.map((o) => o.id));
    if (orderedIds.length !== routing.operations.length || orderedIds.some((oid) => !ids.has(oid))) {
      throw new BusinessException(ErrorCode.VALIDATION, '重排列表与现有工序不一致');
    }
    await this.prisma.$transaction(async (tx) => {
      // seq 唯一约束：先全部挪到负数区避免冲突，再写最终序
      for (const [i, oid] of orderedIds.entries()) {
        await tx.routingOperation.update({ where: { id: oid }, data: { seq: -(i + 1) } });
      }
      for (const [i, oid] of orderedIds.entries()) {
        await tx.routingOperation.update({ where: { id: oid }, data: { seq: (i + 1) * 10, updatedBy: operator } });
      }
    });
    return this.findOne(id);
  }
}
