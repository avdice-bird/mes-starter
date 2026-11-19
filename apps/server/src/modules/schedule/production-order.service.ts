import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductionOrderDto, SplitProductionOrderDto, UpdateProductionOrderDto } from './dto/schedule.dto';
import { DispatchService } from '../dispatch/dispatch.service';
import { FACTORY_TZ_OFFSET_MIN } from '../equipment/equipment-time';

/** SQLite 写串行 + 高并发排队：交互式事务给足 maxWait/timeout（第 40 节攻击1 发现默认 2s/5s 不够） */
const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

@Injectable()
export class ProductionOrderService {
  constructor(private prisma: PrismaService, private dispatch: DispatchService) {}

  async list(query: { page?: number; pageSize?: number; keyword?: string; status?: string }) {
    const page = Number(query.page) > 0 ? Number(query.page) : 1;
    const pageSize = Math.min(Number(query.pageSize) > 0 ? Number(query.pageSize) : 20, 200);
    const where: Prisma.ProductionOrderWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.keyword
        ? { OR: [{ code: { contains: query.keyword } }, { material: { name: { contains: query.keyword } } }] }
        : {}),
    };
    const [list, total] = await this.prisma.$transaction([
      this.prisma.productionOrder.findMany({
        where, orderBy: { id: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
        include: { material: { select: { code: true, name: true } }, _count: { select: { workOrders: true } } },
      }),
      this.prisma.productionOrder.count({ where }),
    ]);
    return {
      list: list.map((o) => ({ ...o, workOrderCount: o._count.workOrders, _count: undefined })),
      total, page, pageSize,
    };
  }

  async findOne(id: number) {
    const order = await this.prisma.productionOrder.findUnique({
      where: { id },
      include: {
        material: { select: { code: true, name: true } },
        workOrders: {
          orderBy: { id: 'asc' },
          include: {
            material: { select: { code: true, name: true } },
            workCenter: { select: { code: true, name: true } },
          },
        },
      },
    });
    if (!order) throw new BusinessException(ErrorCode.NOT_FOUND, '生产订单不存在');
    const { workOrders, ...rest } = order;
    return { ...rest, workOrderCount: workOrders.length, workOrders };
  }

  /**
   * 新建订单：编码不传时自动生成 PO-YYYY-NNN（年份按工厂时区）。
   * 并发下两个请求可能取到同一序号：自动编码撞号就重新取号重试；手动编码撞号直接 409。
   */
  async create(dto: CreateProductionOrderDto, operator: string) {
    await this.assertMaterial(dto.materialId);
    const provided = dto.code?.trim();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = provided ?? (await this.nextOrderCode());
      try {
        return await this.prisma.productionOrder.create({
          data: {
            code,
            materialId: dto.materialId,
            qty: dto.qty,
            dueDate: new Date(dto.dueDate),
            priority: dto.priority ?? 3,
            source: dto.source ?? 'MANUAL',
            remark: dto.remark,
            createdBy: operator,
            updatedBy: operator,
          },
        });
      } catch (e) {
        if ((e as { code?: string }).code !== 'P2002') throw e;
        if (provided) throw new BusinessException(ErrorCode.CONFLICT, `订单编码 ${provided} 已存在`);
        // 自动编码被并发请求抢先占用：重新取号
      }
    }
    throw new BusinessException(ErrorCode.CONFLICT, '订单编码生成冲突，请重试');
  }

  /** 下一个可用订单编码：PO-{工厂时区年份}-{三位以上序号} */
  private async nextOrderCode(): Promise<string> {
    const year = new Date(Date.now() + FACTORY_TZ_OFFSET_MIN * 60_000).getUTCFullYear();
    const prefix = `PO-${year}-`;
    const rows = await this.prisma.productionOrder.findMany({
      where: { code: { startsWith: prefix } },
      select: { code: true },
    });
    const maxSeq = rows.reduce((max, { code }) => {
      const seq = Number(code.slice(prefix.length));
      return Number.isInteger(seq) && seq > max ? seq : max;
    }, 0);
    return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;
  }

  /** 已有工单时拒绝改 qty（第 27 节用例 4：先取消工单才能改数量）；交期/优先级随时可改（重排后重算延误） */
  async update(id: number, dto: UpdateProductionOrderDto, operator: string) {
    const order = await this.prisma.productionOrder.findUnique({ where: { id } });
    if (!order) throw new BusinessException(ErrorCode.NOT_FOUND, '生产订单不存在');
    if (dto.qty !== undefined && dto.qty !== order.qty) {
      const woCount = await this.prisma.workOrder.count({ where: { productionOrderId: id } });
      if (woCount > 0) {
        throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, `订单已拆出 ${woCount} 张工单，需先取消工单再改数量`);
      }
    }
    return this.prisma.productionOrder.update({
      where: { id },
      data: {
        ...(dto.qty !== undefined ? { qty: dto.qty } : {}),
        ...(dto.dueDate !== undefined ? { dueDate: new Date(dto.dueDate) } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.remark !== undefined ? { remark: dto.remark } : {}),
        updatedBy: operator,
      },
    });
  }

  /** 拆分守恒：数量之和必须等于订单 qty（第 26 节；差额提示在 27 节细化） */
  async split(id: number, dto: SplitProductionOrderDto, operator: string) {
    const order = await this.prisma.productionOrder.findUnique({ where: { id } });
    if (!order) throw new BusinessException(ErrorCode.NOT_FOUND, '生产订单不存在');
    if (order.status === 'CANCELLED') {
      throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, '已取消的订单不能拆分');
    }
    if (order.status !== 'DRAFT') {
      throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, `订单状态为 ${order.status}，只有 DRAFT 可拆分`);
    }
    const sum = dto.splits.reduce((s, it) => s + it.qty, 0);
    if (sum !== order.qty) {
      throw new BusinessException(ErrorCode.VALIDATION, `拆分数量之和 ${sum} 与订单数量 ${order.qty} 不相等，差额 ${order.qty - sum}`);
    }
    for (const it of dto.splits) {
      if (it.workCenterId !== undefined) await this.assertWorkCenter(it.workCenterId);
    }

    const baseSeq = await this.prisma.workOrder.count({ where: { productionOrderId: id } });
    const codes = dto.splits.map((_, i) => `${order.code}-W${String(baseSeq + i + 1).padStart(2, '0')}`);
    await this.prisma.$transaction([
      ...dto.splits.map((it, i) => this.prisma.workOrder.create({
        data: {
          code: codes[i],
          productionOrderId: id,
          materialId: order.materialId,
          qty: it.qty,
          ...(it.workCenterId !== undefined ? { workCenterId: it.workCenterId } : {}),
          createdBy: operator,
          updatedBy: operator,
        },
      })),
      this.prisma.productionOrder.update({ where: { id }, data: { status: 'PLANNED', updatedBy: operator } }),
    ]);
    return this.findOne(id);
  }

  /** 取消订单：级联取消 CREATED 工单；有已下达/开工工单时拒绝（第 27 节用例 11） */
  async cancel(id: number, operator: string) {
    const order = await this.prisma.productionOrder.findUnique({ where: { id } });
    if (!order) throw new BusinessException(ErrorCode.NOT_FOUND, '生产订单不存在');
    if (order.status === 'CANCELLED') {
      throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, '订单已是取消状态');
    }
    if (order.status === 'COMPLETED') {
      throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, '已完成的订单不能取消');
    }
    const activeCount = await this.prisma.workOrder.count({
      where: { productionOrderId: id, status: { in: ['RELEASED', 'IN_PROGRESS', 'COMPLETED'] } },
    });
    if (activeCount > 0) {
      throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, `订单下有 ${activeCount} 张已下达/开工的工单，不能取消`);
    }
    const cancelled = await this.prisma.$transaction(async (tx) => {
      const woRows = await tx.workOrder.findMany({ where: { productionOrderId: id }, select: { id: true } });
      await tx.workOrder.updateMany({
        where: { productionOrderId: id, status: 'CREATED' },
        data: { status: 'CANCELLED', updatedBy: operator },
      });
      for (const wo of woRows) {
        await this.dispatch.cancelTasksOfOrder(tx, wo.id, operator); // 第 35 节用例 10
      }
      return tx.productionOrder.update({
        where: { id }, data: { status: 'CANCELLED', updatedBy: operator },
      });
    }, TX_OPTIONS);
    void cancelled;
    return this.findOne(id);
  }

  async remove(id: number) {
    const order = await this.prisma.productionOrder.findUnique({
      where: { id },
      include: { _count: { select: { workOrders: true } } },
    });
    if (!order) throw new BusinessException(ErrorCode.NOT_FOUND, '生产订单不存在');
    if (order._count.workOrders > 0) {
      throw new BusinessException(ErrorCode.CONFLICT, `订单已拆出 ${order._count.workOrders} 张工单，不能删除（可取消）`);
    }
    await this.prisma.productionOrder.delete({ where: { id } });
  }

  private async assertMaterial(materialId: number) {
    const m = await this.prisma.material.findFirst({ where: { id: materialId, isDeleted: false } });
    if (!m) throw new BusinessException(ErrorCode.NOT_FOUND, `物料 ${materialId} 不存在`);
  }

  private async assertWorkCenter(workCenterId: number) {
    const wc = await this.prisma.workCenter.findUnique({ where: { id: workCenterId } });
    if (!wc) throw new BusinessException(ErrorCode.NOT_FOUND, `工作中心 ${workCenterId} 不存在`);
  }
}
