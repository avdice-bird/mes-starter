import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { BomExplodeService } from './bom-explode.service';
import { CreateBomDto, SaveBomItemsDto, UpdateBomDto } from './dto/bom.dto';

const SORT_FIELDS = ['id', 'createdAt', 'version'] as const;

@Injectable()
export class BomService {
  constructor(
    private prisma: PrismaService,
    private explode: BomExplodeService,
  ) {}

  async list(query: { page?: number; pageSize?: number; keyword?: string; status?: string; sortBy?: string; sortOrder?: string }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const sortBy = SORT_FIELDS.includes(query.sortBy as (typeof SORT_FIELDS)[number])
      ? (query.sortBy as (typeof SORT_FIELDS)[number])
      : 'id';
    const where: Prisma.BomWhereInput = {
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
      this.prisma.bom.findMany({
        where,
        include: { material: { select: { code: true, name: true, type: true } }, _count: { select: { items: true } } },
        orderBy: { [sortBy]: query.sortOrder ?? 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.bom.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  async findOne(id: number) {
    const bom = await this.prisma.bom.findUnique({
      where: { id },
      include: {
        material: { select: { code: true, name: true, type: true, unitId: true } },
        items: { orderBy: { id: 'asc' }, include: { childMaterial: { select: { code: true, name: true, type: true } } } },
      },
    });
    if (!bom) throw new BusinessException(ErrorCode.NOT_FOUND, 'BOM 不存在');
    return bom;
  }

  async create(dto: CreateBomDto, operator: string) {
    const material = await this.prisma.material.findFirst({ where: { id: dto.materialId, isDeleted: false } });
    if (!material) throw new BusinessException(ErrorCode.NOT_FOUND, '父物料不存在');
    if (dto.effectiveTo && dto.effectiveTo < dto.effectiveFrom) {
      throw new BusinessException(ErrorCode.VALIDATION, '失效日期不能早于生效日期');
    }
    try {
      return await this.prisma.bom.create({
        data: {
          materialId: dto.materialId,
          version: dto.version,
          effectiveFrom: new Date(dto.effectiveFrom),
          effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
          remark: dto.remark,
          createdBy: operator,
          updatedBy: operator,
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new BusinessException(ErrorCode.CONFLICT, `物料已存在版本 ${dto.version}`);
      }
      throw e;
    }
  }

  /** ACTIVE 版本的骨架字段（日期/备注）可改，明细不可改 */
  async update(id: number, dto: UpdateBomDto, operator: string) {
    const bom = await this.prisma.bom.findUnique({ where: { id } });
    if (!bom) throw new BusinessException(ErrorCode.NOT_FOUND, 'BOM 不存在');
    if (dto.effectiveFrom && dto.effectiveTo && dto.effectiveTo < dto.effectiveFrom) {
      throw new BusinessException(ErrorCode.VALIDATION, '失效日期不能早于生效日期');
    }
    return this.prisma.bom.update({
      where: { id },
      data: {
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined,
        effectiveTo: dto.effectiveTo === undefined ? undefined : dto.effectiveTo ? new Date(dto.effectiveTo) : null,
        remark: dto.remark,
        updatedBy: operator,
      },
    });
  }

  async remove(id: number) {
    const bom = await this.prisma.bom.findUnique({ where: { id } });
    if (!bom) throw new BusinessException(ErrorCode.NOT_FOUND, 'BOM 不存在');
    if (bom.status === 'ACTIVE') throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, 'ACTIVE 版本不能删除，请先停用');
    await this.prisma.bom.delete({ where: { id } }); // 明细级联
  }

  /**
   * 明细批量保存（整体覆盖）：校验 ①子件不能是父物料自己（2003）②展开后无环（2003）。
   * DRAFT / OBSOLETE 可改，ACTIVE 拒绝（409，须新建版本）。
   */
  async saveItems(id: number, dto: SaveBomItemsDto, operator: string) {
    const bom = await this.prisma.bom.findUnique({ where: { id } });
    if (!bom) throw new BusinessException(ErrorCode.NOT_FOUND, 'BOM 不存在');
    if (bom.status === 'ACTIVE') {
      throw new BusinessException(ErrorCode.CONFLICT, 'ACTIVE 版本的明细不能修改，请新建版本');
    }
    const selfRef = dto.items.find((it) => it.childMaterialId === bom.materialId);
    if (selfRef) throw new BusinessException(ErrorCode.BOM_CYCLE, '明细不能包含父物料自身');

    const childIds = [...new Set(dto.items.map((it) => it.childMaterialId))];
    const children = await this.prisma.material.findMany({ where: { id: { in: childIds }, isDeleted: false } });
    if (children.length < childIds.length) {
      throw new BusinessException(ErrorCode.VALIDATION, '存在无效或已删除的子件物料');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.bomItem.deleteMany({ where: { bomId: id } });
      await tx.bomItem.createMany({
        data: dto.items.map((it) => ({
          bomId: id,
          childMaterialId: it.childMaterialId,
          qty: it.qty,
          scrapRate: it.scrapRate,
          position: it.position,
          remark: it.remark,
          createdBy: operator,
          updatedBy: operator,
        })),
      });
    });

    // 保存后跑一次全图展开检测跨 BOM 环（图含所有 ACTIVE BOM + 本 BOM 若为 DRAFT 也临时纳入）
    await this.assertNoCycle(id, bom.materialId);
    return this.findOne(id);
  }

  /** 环检测：临时图 = 所有 ACTIVE BOM + 本 BOM（若非 ACTIVE），从本 BOM 沿子件可达性找环 */
  private async assertNoCycle(bomId: number, materialId: number) {
    // 环检测图必须包含 DRAFT：跨 DRAFT BOM 的环（A→B→A 两个都是草稿）也要拦
    const graph = await this.explode.loadGraph(undefined, 'all-live');
    if (!graph.byMaterial.has(materialId)) {
      const bom = await this.prisma.bom.findUnique({ where: { id: bomId }, include: { items: true } });
      if (bom) {
        graph.byMaterial.set(materialId, {
          materialId,
          bomId,
          items: bom.items.map((it) => ({ childMaterialId: it.childMaterialId, qty: it.qty, scrapRate: it.scrapRate })),
        });
      }
    }
    // 从本物料沿图走 20 步，回到自己即环（深度防御同一处兜底）
    const seen = new Set<number>();
    const walk = (mid: number, depth: number) => {
      if (mid === materialId && seen.size > 0) {
        throw new BusinessException(ErrorCode.BOM_CYCLE, '保存后 BOM 形成循环引用');
      }
      if (depth > 20 || seen.has(mid)) return;
      seen.add(mid);
      const node = graph.byMaterial.get(mid);
      for (const it of node?.items ?? []) walk(it.childMaterialId, depth + 1);
      seen.delete(mid);
    };
    const node = graph.byMaterial.get(materialId);
    for (const it of node?.items ?? []) walk(it.childMaterialId, 1);
  }

  /**
   * 激活：同父物料的其他 ACTIVE → OBSOLETE（自动让位策略，ADR/日志 17 记录）。
   * 同事务保证"同一父物料同一时刻只有一个 ACTIVE"。
   */
  async activate(id: number, operator: string) {
    const bom = await this.prisma.bom.findUnique({ where: { id } });
    if (!bom) throw new BusinessException(ErrorCode.NOT_FOUND, 'BOM 不存在');
    if (bom.status === 'ACTIVE') return bom;
    await this.prisma.$transaction(async (tx) => {
      await tx.bom.updateMany({
        where: { materialId: bom.materialId, status: 'ACTIVE', id: { not: id } },
        data: { status: 'OBSOLETE', updatedBy: operator },
      });
      await tx.bom.update({ where: { id }, data: { status: 'ACTIVE', updatedBy: operator } });
    });
    return this.prisma.bom.findUniqueOrThrow({ where: { id } });
  }

  /** 树形展开（多级）：一次查全图内存展开，固定 3 次查询（ADR-002：图 1 次 + 明细归属 1 次 + 物料 1 次） */
  async tree(id: number, parentQty = 1) {
    const bom = await this.prisma.bom.findUnique({
      where: { id },
      select: { id: true, materialId: true, version: true, status: true, material: { select: { code: true, name: true } }, items: { select: { childMaterialId: true, qty: true, scrapRate: true } } },
    });
    if (!bom) throw new BusinessException(ErrorCode.NOT_FOUND, 'BOM 不存在');
    const graph = await this.explode.loadGraph();
    // 本 BOM 是 ACTIVE 时图里已有（不再重复查）；DRAFT/预览则用本次明细覆盖图中该物料
    graph.byMaterial.set(bom.materialId, {
      materialId: bom.materialId,
      bomId: bom.id,
      items: bom.items.map((it) => ({ childMaterialId: it.childMaterialId, qty: it.qty, scrapRate: it.scrapRate })),
    });
    // 展开过程中涉及的物料是全图的物料（可能深入多层），直接取全量（1 次查询；200 物料量级无压力）
    const materials = await this.prisma.material.findMany({
      select: { id: true, code: true, name: true, type: true },
    });
    const matMap = new Map(materials.map((m) => [m.id, m]));
    const result = this.explode.explodeFromBom(graph, { id: bom.id, materialId: bom.materialId, items: bom.items }, matMap, parentQty);
    return { bom: { id: bom.id, version: bom.version, status: bom.status, material: bom.material }, ...result };
  }

  /** 按物料 + 日期取生效版本并展开（供 MRP/成本用） */
  async treeByMaterial(materialId: number, date: string, qty: number) {
    const active = await this.explode.findActiveBomByDate(materialId, new Date(date));
    if (!active) throw new BusinessException(ErrorCode.NOT_FOUND, '该物料在此日期没有生效的 BOM');
    return this.tree(active.id, qty);
  }
}
