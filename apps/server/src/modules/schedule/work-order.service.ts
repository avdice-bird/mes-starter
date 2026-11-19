import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { allowedActions, nextStatus, WorkOrderAction } from './work-order.state';
import { DispatchService } from '../dispatch/dispatch.service';
import { BOARD_EVENT_BUS, BoardEventBus } from '../board/board.events';

/** SQLite 写串行 + 高并发排队：交互式事务给足 maxWait/timeout（第 40 节攻击1 发现默认 2s/5s 不够） */
const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

/** 工单：列表/详情只读；plan 调整（甘特图拖拽，第 29 节）；状态流转走 transition()（第 30 节） */
@Injectable()
export class WorkOrderService {
  constructor(
    private prisma: PrismaService,
    private dispatch: DispatchService,
    @Inject(BOARD_EVENT_BUS) private events: BoardEventBus,
  ) {}

  async list(query: { page?: number; pageSize?: number; keyword?: string; status?: string; workCenterId?: number; delayed?: string }) {
    const page = Number(query.page) > 0 ? Number(query.page) : 1;
    const pageSize = Math.min(Number(query.pageSize) > 0 ? Number(query.pageSize) : 20, 200);
    const where: Prisma.WorkOrderWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.workCenterId ? { workCenterId: Number(query.workCenterId) } : {}),
      ...(query.delayed === '1' ? { isDelayed: true } : {}),
      ...(query.keyword
        ? { OR: [{ code: { contains: query.keyword } }, { material: { name: { contains: query.keyword } } }] }
        : {}),
    };
    const [list, total] = await this.prisma.$transaction([
      this.prisma.workOrder.findMany({
        where,
        orderBy: [{ isDelayed: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          material: { select: { code: true, name: true } },
          workCenter: { select: { code: true, name: true } },
          productionOrder: { select: { code: true, dueDate: true, priority: true } },
        },
      }),
      this.prisma.workOrder.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  async findOne(id: number) {
    const wo = await this.prisma.workOrder.findUnique({
      where: { id },
      include: {
        material: { select: { code: true, name: true } },
        workCenter: { select: { code: true, name: true } },
        productionOrder: { select: { code: true, dueDate: true, priority: true, status: true } },
      },
    });
    if (!wo) return null;
    return wo;
  }

  /**
   * 手工调整计划（甘特图拖拽回写，第 29 节）：
   * - 只有 CREATED 可调整（已下达/开工/完成/取消的计划不可再动）
   * - end ≥ start；产线必须存在且启用；拖到产线后重算 isDelayed
   */
  async adjustPlan(id: number, dto: { plannedStart: string; plannedEnd: string; workCenterId: number }, operator: string) {
    const wo = await this.prisma.workOrder.findUnique({ where: { id } });
    if (!wo) throw new BusinessException(ErrorCode.NOT_FOUND, '工单不存在');
    if (wo.status !== 'CREATED') {
      throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, `工单状态为 ${wo.status}，只有已创建的工单可调整计划`);
    }
    const start = new Date(`${dto.plannedStart.slice(0, 10)}T00:00:00.000Z`);
    const end = new Date(`${dto.plannedEnd.slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BusinessException(ErrorCode.VALIDATION, '计划日期无效');
    }
    if (end < start) throw new BusinessException(ErrorCode.VALIDATION, '计划结束日不能早于开始日');
    const wc = await this.prisma.workCenter.findUnique({ where: { id: dto.workCenterId } });
    if (!wc) throw new BusinessException(ErrorCode.NOT_FOUND, `工作中心 ${dto.workCenterId} 不存在`);
    if (wc.status !== 1) throw new BusinessException(ErrorCode.VALIDATION, `工作中心 ${wc.name} 已停用，不能接收工单`);

    const order = await this.prisma.productionOrder.findUniqueOrThrow({ where: { id: wo.productionOrderId } });
    // 乐观锁（第 33 节审查补齐）：甘特图双开窗口/排产与手调并发时，count=0 抛 1007
    const updated = await this.prisma.workOrder.updateMany({
      where: { id, version: wo.version },
      data: {
        workCenterId: dto.workCenterId,
        plannedStart: start,
        plannedEnd: end,
        isDelayed: end > order.dueDate,
        version: { increment: 1 },
        updatedBy: operator,
      },
    });
    if (updated.count === 0) {
      throw new BusinessException(ErrorCode.CONCURRENT_CONFLICT, '工单已被他人修改，请刷新重试');
    }
    return this.findOne(id);
  }

  /**
   * 状态机统一入口（第 30-31 节）：查转换表 → 前置条件 → 乐观锁更新 + 写 log，同一个事务。
   * 乐观锁：updateMany 带 version 条件，count=0 说明并发修改，抛 1007。
   * 事务中途任何一步失败全部回滚（第 33 节有回滚测试）。
   */
  async transition(
    id: number,
    action: WorkOrderAction,
    ctx: { operatorId: number; operatorName: string; reason?: string },
  ) {
    await this.getWorkOrder(id); // 存在性校验（转换合法性在事务内二次查表时判定）

    // 动作前置条件（查表之外的分支只在这里，不散在业务代码里）
    if (action === 'release') await this.assertRouting(id);
    if (action === 'complete') {
      // 先判工序是否全部完工：这才是最常见的"不能完工"原因。
      // 若先做数量/原因校验，会给用户一个"完工数量 0 少于计划数量 700"的误导性提示。
      await this.dispatch.assertAllOperationsDone(id);
      await this.assertComplete(id, ctx.reason);
    }

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.workOrder.findUniqueOrThrow({ where: { id } });
      // 事务内二次查表（并发窗口）：先查表判合法性（非法 → 1006），再用 version 条件原子更新
      // （version 已变 = 他人已改 → 1007）。SQLite 写事务串行，read-then-update 在事务内不会撕裂。
      const expected = nextStatus(current.status, action);
      const updated = await tx.workOrder.updateMany({
        where: { id, version: current.version },
        data: { status: expected, version: { increment: 1 }, updatedBy: ctx.operatorName },
      });
      if (updated.count === 0) {
        throw new BusinessException(ErrorCode.CONCURRENT_CONFLICT, '工单状态已被他人修改，请刷新重试');
      }
      await tx.workOrderStatusLog.create({
        data: {
          workOrderId: id,
          fromStatus: current.status,
          toStatus: expected,
          action,
          operatorId: ctx.operatorId,
          operatorName: ctx.operatorName,
          reason: ctx.reason,
        },
      });
      // release：同事务生成工序任务快照（ADR-003 事务边界；第 34 节）
      if (action === 'release') {
        const routing = await tx.routing.findFirst({ where: { materialId: current.materialId, status: 'ACTIVE' } });
        if (routing) {
          await tx.workOrder.update({ where: { id }, data: { routingId: routing.id } });
          await this.dispatch.generateTasksForRelease(tx, id, routing.id, current.qty);
        }
      }
      // cancel：级联取消未完工任务（第 35 节用例 10）
      if (action === 'cancel') {
        await this.dispatch.cancelTasksOfOrder(tx, id, ctx.operatorName);
      }
      const result = await tx.workOrder.findUniqueOrThrow({ where: { id } });

      // 看板事件（第 48 节）
      this.events.emit('work-order.status-changed', {
        workOrderId: id,
        workOrderCode: result.code,
        fromStatus: current.status,
        toStatus: expected,
        workCenterId: result.workCenterId,
        at: new Date().toISOString(),
      } as import('../board/board.events').WorkOrderStatusChangedEvent);

      return result;
    }, TX_OPTIONS);
  }

  /** 详情（含 log 与 allowedActions，前端状态条用） */
  async detailWithLog(id: number) {
    const wo = await this.findOne(id);
    if (!wo) throw new BusinessException(ErrorCode.NOT_FOUND, '工单不存在');
    const logs = await this.prisma.workOrderStatusLog.findMany({
      where: { workOrderId: id },
      orderBy: { id: 'asc' },
    });
    return { ...wo, logs, allowedActions: allowedActions(wo.status) };
  }

  async listLogs(id: number) {
    await this.assertExists(id);
    return this.prisma.workOrderStatusLog.findMany({ where: { workOrderId: id }, orderBy: { id: 'asc' } });
  }

  private async getWorkOrder(id: number) {
    const wo = await this.prisma.workOrder.findUnique({ where: { id } });
    if (!wo) throw new BusinessException(ErrorCode.NOT_FOUND, '工单不存在');
    return wo;
  }

  private async assertExists(id: number) {
    await this.getWorkOrder(id);
  }

  /** release 前置：物料有 ACTIVE 路线（派工第 34 节用） */
  private async assertRouting(id: number) {
    const wo = await this.getWorkOrder(id);
    const routing = await this.prisma.routing.findFirst({
      where: { materialId: wo.materialId, status: 'ACTIVE' },
    });
    if (!routing) {
      throw new BusinessException(ErrorCode.OP_NOT_READY, '物料没有生效中的工艺路线（ACTIVE），请先在工艺管理里激活');
    }
    // 下达时确定路线
    await this.prisma.workOrder.update({ where: { id }, data: { routingId: routing.id } });
  }

  /** complete 前置：完工数 ≥ 计划数；部分完工必须填 reason（第 30 节决策）。
   *  第 34 节起末道完工回写 WorkOrder.completedQty，直接用它判断（不再需要 0 桩）。 */
  private async assertComplete(id: number, reason?: string) {
    const wo = await this.getWorkOrder(id);
    if (wo.completedQty < wo.qty && !reason) {
      throw new BusinessException(ErrorCode.VALIDATION, `完工数量 ${wo.completedQty} 少于计划数量 ${wo.qty}，部分完工必须填写原因`);
    }
  }
}
