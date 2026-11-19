import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FACTORY_TZ_OFFSET_MIN } from '../equipment/equipment-time';
import type { WorkOrderProgressQueryDto, YieldQueryDto, OeeQueryDto, DefectTopQueryDto } from './dto/reports.dto';

/** 报表口径（唯一正本：docs/acceptance/reports.md）。日期换算与查询全部参数化，禁止拼接。 */
@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  /** 工厂时区日期 yyyy-MM-dd → UTC 区间 [start, end)（to 含当天，所以 end = to+1d） */
  private utcRange(from?: string, to?: string): { gte?: Date; lt?: Date } {
    const toUtc = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - FACTORY_TZ_OFFSET_MIN * 60_000);
    const range: { gte?: Date; lt?: Date } = {};
    if (from) range.gte = toUtc(from);
    if (to) range.lt = new Date(toUtc(to).getTime() + 24 * 3600_000);
    return range;
  }

  /** 工单进度：每单 计划/完成/进度%/延误（口径见 acceptance/reports.md §1） */
  async workOrderProgress(q: WorkOrderProgressQueryDto) {
    const created = this.utcRange(q.from, q.to);
    const rows = await this.prisma.workOrder.findMany({
      where: {
        ...(Object.keys(created).length ? { createdAt: created } : {}),
        ...(q.workCenterId ? { workCenterId: q.workCenterId } : {}),
        ...(q.status ? { status: q.status } : {}),
      },
      select: {
        id: true, code: true, status: true, qty: true, completedQty: true,
        plannedStart: true, plannedEnd: true,
        productionOrder: { select: { code: true, dueDate: true } },
        workCenter: { select: { name: true } },
      },
      orderBy: { id: 'asc' },
    });
    const today = new Date().toISOString().slice(0, 10);
    return rows.map((w) => ({
      id: w.id,
      code: w.code,
      status: w.status,
      workCenterName: w.workCenter?.name ?? null,
      plannedQty: w.qty,
      completedQty: w.completedQty,
      progressPct: Math.min(Math.round((w.completedQty / w.qty) * 1000) / 10, 999),
      plannedStart: w.plannedStart,
      plannedEnd: w.plannedEnd,
      dueDate: w.productionOrder.dueDate?.toISOString().slice(0, 10) ?? null,
      delayed: !!w.productionOrder.dueDate
        && w.productionOrder.dueDate.toISOString().slice(0, 10) < today
        && !['COMPLETED', 'CLOSED', 'CANCELLED'].includes(w.status),
    }));
  }

  /** 良率：按维度分组（口径 §2）。用 $queryRaw 占位符聚合报工流水（负数流水自然抵扣）。 */
  async yield(q: YieldQueryDto) {
    const range = this.utcRange(q.from, q.to);
    const where = {
      reportedAt: range,
      ...(q.workCenterId ? { operation: { workCenterId: q.workCenterId } } : {}),
    };
    // 全维度一次拉流水（流水字段小），分组在内存做——SQLite groupBy join 复杂度不划算
    const reports = await this.prisma.workReport.findMany({
      where,
      select: {
        goodQty: true, defectQty: true, shiftId: true, teamId: true, reportedAt: true,
        operation: { select: { operationName: true, workOrder: { select: { material: { select: { id: true, code: true, name: true } } } } } },
        shift: { select: { name: true } },
        team: { select: { name: true } },
      },
    });
    const keyOf = (r: (typeof reports)[number]): string => {
      switch (q.groupBy) {
        case 'operation': return r.operation.operationName;
        case 'shift': return r.shift?.name ?? '未记班次';
        case 'team': return r.team?.name ?? '未记班组';
        case 'date': return new Date(r.reportedAt.getTime() + FACTORY_TZ_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
        default: return r.operation.workOrder.material.code;
      }
    };
    const labelOf = (r: (typeof reports)[number]): string => {
      switch (q.groupBy) {
        case 'operation': return r.operation.operationName;
        case 'shift': return r.shift?.name ?? '未记班次';
        case 'team': return r.team?.name ?? '未记班组';
        case 'date': return keyOf(r);
        default: return r.operation.workOrder.material.name;
      }
    };
    const acc = new Map<string, { key: string; label: string; good: number; defect: number }>();
    for (const r of reports) {
      const key = keyOf(r);
      const row = acc.get(key) ?? { key, label: labelOf(r), good: 0, defect: 0 };
      row.good += r.goodQty;
      row.defect += r.defectQty;
      acc.set(key, row);
    }
    return [...acc.values()]
      .map((r) => ({
        key: r.key, label: r.label, goodQty: r.good, defectQty: r.defect,
        yieldRate: r.good + r.defect > 0 ? Math.round((r.good / (r.good + r.defect)) * 1000) / 10 : null,
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  /** 缺陷 TOP N（口径 §2）：InspectionDefect 按 defectCode 聚合 */
  async defectTop(q: DefectTopQueryDto) {
    const range = this.utcRange(q.from, q.to);
    const rows = await this.prisma.inspectionDefect.groupBy({
      by: ['defectCodeId'],
      where: { inspection: { inspectedAt: range } },
      _sum: { qty: true },
      orderBy: { _sum: { qty: 'desc' } },
      take: q.top ?? 5,
    });
    const codes = await this.prisma.defectCode.findMany({
      where: { id: { in: rows.map((r) => r.defectCodeId) } },
      select: { id: true, code: true, name: true },
    });
    const byId = new Map(codes.map((c) => [c.id, c]));
    return rows.map((r) => ({
      defectCode: byId.get(r.defectCodeId)?.code ?? String(r.defectCodeId),
      defectName: byId.get(r.defectCodeId)?.name ?? String(r.defectCodeId),
      qty: r._sum.qty ?? 0,
    }));
  }

  /** OEE（口径 §3）：可用率 × 表现性 × 良率，按设备 */
  async oee(q: OeeQueryDto) {
    const range = this.utcRange(q.from, q.to);
    // 区间天数（工厂时区，含首尾）；无 from/to 时按 1 天算
    const days = q.from && q.to
      ? Math.max(1, Math.round((Date.parse(q.to) - Date.parse(q.from)) / 86_400_000) + 1)
      : 1;
    const plannedMinutes = 480 * days; // 简化：3 班 × 8h

    const equipments = await this.prisma.equipment.findMany({
      where: {
        ...(q.equipmentId ? { id: q.equipmentId } : {}),
        ...(q.workCenterId ? { workCenterId: q.workCenterId } : {}),
      },
      select: { id: true, code: true, name: true },
    });

    const result = [];
    for (const eq of equipments) {
      // 停机：跨天分钟切分后取区间内合计（复用第 47 节口径）
      const downtimes = await this.prisma.downtime.findMany({
        where: { equipmentId: eq.id, startedAt: { lt: range.lt ?? new Date() }, ...(range.gte ? {} : {}) },
        select: { startedAt: true, endedAt: true },
      });
      let downtimeMinutes = 0;
      for (const d of downtimes) {
        const s = Math.max(d.startedAt.getTime(), range.gte?.getTime() ?? Number.NEGATIVE_INFINITY);
        const e = Math.min(d.endedAt?.getTime() ?? Date.now(), range.lt?.getTime() ?? Date.now());
        if (e > s) downtimeMinutes += Math.floor((e - s) / 60_000);
      }
      void range; // range.lt 已用于 startedAt 预过滤

      const runningMinutes = Math.max(0, plannedMinutes - downtimeMinutes);
      const availability = plannedMinutes > 0 ? Math.round((runningMinutes / plannedMinutes) * 1000) / 10 : null;

      const reports = await this.prisma.workReport.findMany({
        where: { equipmentId: eq.id, reportedAt: range },
        select: { goodQty: true, defectQty: true, operation: { select: { standardMinutes: true } } },
      });
      const good = reports.reduce((s, r) => s + r.goodQty, 0);
      const total = reports.reduce((s, r) => s + r.goodQty + r.defectQty, 0);
      const stdMinutes = reports.reduce((s, r) => s + r.operation.standardMinutes * r.goodQty, 0);

      const performance = runningMinutes > 0 && total > 0
        ? Math.round((stdMinutes / runningMinutes) * 1000) / 10
        : null;
      const yieldRate = total > 0 ? Math.round((good / total) * 1000) / 10 : null;
      const oee = availability !== null && performance !== null && yieldRate !== null
        ? Math.round((availability / 100) * (performance / 100) * (yieldRate / 100) * 1000) / 10
        : null;

      result.push({
        equipmentId: eq.id, equipmentCode: eq.code, equipmentName: eq.name,
        plannedMinutes, downtimeMinutes, runningMinutes,
        availability, performance, yieldRate, oee,
        goodQty: good, totalQty: total,
      });
    }
    return result;
  }
}
