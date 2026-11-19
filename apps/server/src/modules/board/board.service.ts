import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** 看板初始化数据（第 48 节）：当日产量、良率、在制工单数、设备状态分布 */
@Injectable()
export class BoardService {
  constructor(private prisma: PrismaService) {}

  async summary(workCenterId?: number) {
    // 当日（工厂时区口径简化为 UTC 日——看板口径在 53 节 OEE 前统一）
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);

    // 当日产量：当日报工流水的良品合计（按工单的工作中心过滤）
    const reports = await this.prisma.workReport.findMany({
      where: { reportedAt: { gte: dayStart } },
      select: { goodQty: 1, defectQty: 1 } as never,
    });
    let totalGood = 0;
    let totalDefect = 0;
    for (const r of reports) {
      totalGood += (r as unknown as { goodQty: number }).goodQty;
      totalDefect += (r as unknown as { defectQty: number }).defectQty;
    }

    // 在制工单数（RELEASED/IN_PROGRESS）
    const wipOrders = await this.prisma.workOrder.count({
      where: { status: { in: ['RELEASED', 'IN_PROGRESS'] } },
    });

    // 设备状态分布（按工作中心）
    const equipments = await this.prisma.equipment.findMany({
      where: workCenterId ? { workCenterId } : undefined,
      select: { id: true, code: true, name: true, status: true },
    });
    const byStatus: Record<string, number> = { RUNNING: 0, IDLE: 0, FAULT: 0, MAINTENANCE: 0 };
    for (const eq of equipments) byStatus[eq.status] = (byStatus[eq.status] ?? 0) + 1;

    // 最近 10 条报工
    const recent = await this.prisma.workReport.findMany({
      orderBy: { id: 'desc' },
      take: 10,
      include: {
        employee: { select: { name: true } },
        operation: { select: { operationName: true, workOrderId: true } },
      },
    });

    return {
      todayGoodQty: totalGood,
      todayDefectQty: totalDefect,
      yieldRate: totalGood + totalDefect > 0 ? Math.round((totalGood / (totalGood + totalDefect)) * 1000) / 10 : null,
      wipOrders,
      equipmentStatus: byStatus,
      recentReports: recent.map((r) => ({
        id: r.id,
        employeeName: r.employee.name,
        operationName: r.operation.operationName,
        goodQty: r.goodQty,
        defectQty: r.defectQty,
        reportedAt: r.reportedAt,
      })),
    };
  }
}
