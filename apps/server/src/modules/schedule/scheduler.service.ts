import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../prisma/prisma.service';
import type { ScheduleRunResult } from '@mes/shared';
import { addDays, diffDays, schedule } from './scheduler.algorithm';

/** 排产窗口缺省天数 */
const DEFAULT_WINDOW_DAYS = 90;

@Injectable()
export class SchedulerService {
  constructor(private prisma: PrismaService) {}

  /**
   * 一键排产：对窗口内 status=CREATED 的工单按算法填产线与计划起止。
   * 已开工（RELEASED/IN_PROGRESS/COMPLETED）的工单不参与重排，其产能占用被扣除。
   */
  async run(input: { from: string; to?: string; workCenterIds?: number[] }): Promise<ScheduleRunResult> {
    const from = new Date(`${input.from}T00:00:00.000Z`);
    if (Number.isNaN(from.getTime())) throw new BusinessException(ErrorCode.VALIDATION, 'from 不是有效日期');
    const to = input.to ? new Date(`${input.to}T00:00:00.000Z`) : addDays(from, DEFAULT_WINDOW_DAYS);
    if (Number.isNaN(to.getTime())) throw new BusinessException(ErrorCode.VALIDATION, 'to 不是有效日期');
    if (to < from) throw new BusinessException(ErrorCode.VALIDATION, 'to 不能早于 from');
    const windowDays = diffDays(from, to) + 1; // 含首尾两天

    // 参与排产的产线：启用；指定了 workCenterIds 则只取这些
    const workCenters = await this.prisma.workCenter.findMany({
      where: {
        status: 1,
        ...(input.workCenterIds?.length ? { id: { in: input.workCenterIds } } : {}),
      },
      orderBy: { id: 'asc' },
    });

    // 待排工单：CREATED 全部重排；RELEASED 但尚无计划日期的补排（先下达后排产的场景）
    const workOrders = await this.prisma.workOrder.findMany({
      where: {
        productionOrder: { status: { notIn: ['CANCELLED'] } },
        OR: [
          { status: 'CREATED' },
          { status: 'RELEASED', plannedStart: null },
        ],
      },
      include: { productionOrder: { select: { dueDate: true, priority: true } } },
      orderBy: { id: 'asc' },
    });

    // 已开工工单的产能占用：按每张工单的计划天数均摊到日（同产线同口径）
    const existingLoad = await this.buildExistingLoad();

    const result = schedule(
      workOrders.map((wo, i) => ({
        id: wo.id,
        qty: wo.qty,
        workCenterId: wo.workCenterId,
        dueDate: wo.productionOrder.dueDate,
        priority: wo.productionOrder.priority,
        createdAt: wo.createdAt,
        seq: i, // 查询按 id asc，同毫秒创建的工单按 id 兜底（用例 12 可复现）
      })),
      workCenters.map((w) => ({ id: w.id, dailyCapacity: w.dailyCapacity, status: w.status })),
      existingLoad,
      from,
      windowDays,
    );

    // 写库：更新工单的产线/计划起止/延误标记
    await this.prisma.$transaction(result.items.map((it) =>
      this.prisma.workOrder.update({
        where: { id: it.workOrderId },
        data: {
          workCenterId: it.workCenterId,
          plannedStart: it.plannedStart,
          plannedEnd: it.plannedEnd,
          isDelayed: it.isDelayed,
          updatedBy: 'scheduler',
        },
      })));

    // 汇总：按产线分组（含指定但跳过的）
    const idToWo = new Map(workOrders.map((wo) => [wo.id, wo]));
    const wcMap = new Map(workCenters.map((w) => [w.id, w]));
    const groups = new Map<number, ScheduleRunResult['groups'][number]>();
    for (const it of result.items) {
      const wc = wcMap.get(it.workCenterId)!;
      const wo = idToWo.get(it.workOrderId)!;
      if (!groups.has(it.workCenterId)) {
        groups.set(it.workCenterId, { workCenterId: it.workCenterId, workCenter: { code: wc.code, name: wc.name }, items: [] });
      }
      groups.get(it.workCenterId)!.items.push({
        id: wo.id, code: wo.code, qty: wo.qty,
        plannedStart: it.plannedStart.toISOString(), plannedEnd: it.plannedEnd.toISOString(),
        isDelayed: it.isDelayed,
      });
    }
    // 没分到产线的跳过项归到 null 组，便于前端提示
    if (result.skipped.length > 0) {
      groups.set(-1, { workCenterId: null, workCenter: null, items: [] });
    }

    return {
      scheduled: result.items.length,
      skipped: result.skipped,
      delayed: result.items.filter((it) => it.isDelayed).length,
      groups: [...groups.values()],
    };
  }

  /** 排产结果查询：按产线分组的窗口内已排工单 */
  async view(query: { from?: string; to?: string }) {
    const where: Prisma.WorkOrderWhereInput = {
      workCenterId: { not: null },
      status: { in: ['CREATED', 'RELEASED', 'IN_PROGRESS'] },
      plannedStart: { not: null },
      // 时间窗过滤：与窗口重叠才返回（plannedEnd ≥ from 且 plannedStart ≤ to）。
      // 之前用 OR 会把窗口外的历史工单也带回来，前端裁条后只剩空行
      ...(query.from ? { plannedEnd: { gte: new Date(`${query.from}T00:00:00.000Z`) } } : {}),
      ...(query.to ? { plannedStart: { lte: new Date(`${query.to}T23:59:59.999Z`) } } : {}),
    };
    const rows = await this.prisma.workOrder.findMany({
      where,
      include: {
        material: { select: { code: true, name: true } },
        workCenter: { select: { code: true, name: true } },
        productionOrder: { select: { code: true, dueDate: true, priority: true } },
      },
      orderBy: [{ workCenterId: 'asc' }, { plannedStart: 'asc' }],
    });
    const groups = new Map<number, { workCenterId: number; workCenter: { code: string; name: string }; items: typeof rows }>();
    for (const r of rows) {
      const wcId = r.workCenterId!;
      if (!groups.has(wcId)) {
        groups.set(wcId, { workCenterId: wcId, workCenter: r.workCenter!, items: [] });
      }
      groups.get(wcId)!.items.push(r);
    }
    return { groups: [...groups.values()], total: rows.length };
  }

  /**
   * 已开工工单占用的产能：{ workCenterId: { 'yyyy-mm-dd': qty } }。
   * 口径：与排产一致——工单占 ceil(qty/日产能) 天，每天占用 min(qty, 日产能)，从 plannedStart 起摊。
   */
  private async buildExistingLoad(): Promise<Record<number, Record<string, number>>> {
    const rows = await this.prisma.workOrder.findMany({
      where: { status: { in: ['RELEASED', 'IN_PROGRESS'] }, workCenterId: { not: null }, plannedStart: { not: null } },
      include: { workCenter: { select: { dailyCapacity: true } } },
    });
    const load: Record<number, Record<string, number>> = {};
    for (const wo of rows) {
      const capacity = wo.workCenter?.dailyCapacity ?? 0;
      if (capacity <= 0) continue;
      const days = Math.ceil(wo.qty / capacity);
      const perDay = Math.min(wo.qty, capacity);
      const start = wo.plannedStart!;
      const wcLoad = (load[wo.workCenterId!] ??= {});
      for (let d = 0; d < days; d++) {
        const day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + d));
        const iso = day.toISOString().slice(0, 10);
        wcLoad[iso] = (wcLoad[iso] ?? 0) + perDay;
      }
    }
    return load;
  }
}
