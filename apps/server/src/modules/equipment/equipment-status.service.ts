import { Inject, Injectable } from '@nestjs/common';
import { BOARD_EVENT_BUS, BoardEventBus } from '../board/board.events';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { splitByDay } from './equipment-time';

/** SQLite 写串行 + 高并发排队（第 40 节约定） */
const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

const VALID_STATUSES = ['RUNNING', 'IDLE', 'FAULT', 'MAINTENANCE'];
/** 停机状态：处于这两态时自动开停机记录 */
const DOWN_STATUSES = ['FAULT', 'MAINTENANCE'];

@Injectable()
export class EquipmentStatusService {
  constructor(
    private prisma: PrismaService,
    @Inject(BOARD_EVENT_BUS) private events: BoardEventBus,
  ) {}

  /**
   * 状态切换（第 46 节）：留痕 + 停机自动开关。
   * - 切到 FAULT/MAINTENANCE：自动开一条 Downtime
   * - 切回 RUNNING/IDLE：自动关闭未结束的 Downtime 并计算时长
   * - 切换到当前状态：409（用例 5）
   */
  async changeStatus(id: number, dto: { status: string; reason?: string }, operatorId: number, operatorName: string) {
    if (!VALID_STATUSES.includes(dto.status)) {
      throw new BusinessException(ErrorCode.VALIDATION, `无效状态 ${dto.status}`);
    }
    return this.prisma.$transaction(async (tx) => {
      const eq = await tx.equipment.findUniqueOrThrow({ where: { id } });
      if (eq.status === dto.status) {
        throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, `设备已处于 ${dto.status} 状态`);
      }

      await tx.equipmentStatusLog.create({
        data: {
          equipmentId: id,
          fromStatus: eq.status,
          toStatus: dto.status,
          operatorId,
          operatorName,
          reason: dto.reason,
        },
      });

      const wasDown = DOWN_STATUSES.includes(eq.status);
      const isDown = DOWN_STATUSES.includes(dto.status);

      if (!wasDown && isDown) {
        // 开一条停机记录
        await tx.downtime.create({
          data: { equipmentId: id, reasonCode: dto.reason ?? '未分类', startedAt: new Date(), workOrderId: null },
        });
      } else if (wasDown && !isDown) {
        // 关闭未结束的停机记录
        const open = await tx.downtime.findFirst({ where: { equipmentId: id, endedAt: null } });
        if (open) {
          const now = new Date();
          await tx.downtime.update({
            where: { id: open.id },
            data: { endedAt: now, durationMinutes: Math.floor((now.getTime() - open.startedAt.getTime()) / 60_000) },
          });
        }
      }

      await tx.equipment.update({ where: { id }, data: { status: dto.status } });

      // 看板事件（第 48 节）
      this.events.emit('equipment.status-changed', {
        equipmentId: id,
        equipmentCode: eq.code,
        equipmentName: eq.name,
        workCenterId: eq.workCenterId,
        fromStatus: eq.status,
        toStatus: dto.status,
        at: new Date().toISOString(),
      } as import('../board/board.events').EquipmentStatusChangedEvent);

      return tx.equipment.findUniqueOrThrow({ where: { id } });
    }, TX_OPTIONS);
  }

  /** 停机记录列表 */
  async listDowntimes(query: { equipmentId?: number; page?: number; pageSize?: number }) {
    const page = Number(query.page) > 0 ? Number(query.page) : 1;
    const pageSize = Math.min(Number(query.pageSize) > 0 ? Number(query.pageSize) : 20, 200);
    const where = { ...(query.equipmentId ? { equipmentId: Number(query.equipmentId) } : {}) };
    const [list, total] = await this.prisma.$transaction([
      this.prisma.downtime.findMany({
        where,
        include: { equipment: { select: { code: true, name: true } } },
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.downtime.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  /** 手动补录停机（第 47 节用例 6/7）：endedAt < startedAt 400；与已有停机重叠 409 */
  async createDowntime(dto: { equipmentId: number; reasonCode: string; startedAt: string; endedAt?: string; remark?: string }, operatorName: string) {
    void operatorName;
    const startedAt = new Date(dto.startedAt);
    const endedAt = dto.endedAt ? new Date(dto.endedAt) : null;
    if (!dto.reasonCode?.trim()) {
      throw new BusinessException(ErrorCode.VALIDATION, '停机原因代码必填');
    }
    if (Number.isNaN(startedAt.getTime())) throw new BusinessException(ErrorCode.VALIDATION, 'startedAt 无效');
    if (endedAt && Number.isNaN(endedAt.getTime())) throw new BusinessException(ErrorCode.VALIDATION, 'endedAt 无效');
    if (endedAt && endedAt <= startedAt) {
      throw new BusinessException(ErrorCode.VALIDATION, '结束时间必须晚于开始时间');
    }
    // 重叠检测：同设备 [startedAt, endedAt) 与已有区间相交即拒绝（开放停机视为延伸到无限）
    const probeEnd = endedAt ?? new Date(Date.now() + 1);
    const overlapping = await this.prisma.downtime.findFirst({
      where: {
        equipmentId: dto.equipmentId,
        startedAt: { lt: probeEnd },
        OR: [{ endedAt: null }, { endedAt: { gt: startedAt } }],
      },
    });
    if (overlapping) {
      throw new BusinessException(ErrorCode.CONFLICT, '与已有停机记录时间重叠');
    }
    return this.prisma.downtime.create({
      data: {
        equipmentId: dto.equipmentId,
        reasonCode: dto.reasonCode,
        startedAt,
        endedAt,
        durationMinutes: endedAt ? Math.floor((endedAt.getTime() - startedAt.getTime()) / 60_000) : null,
        remark: dto.remark,
      },
    });
  }

  /** 日报列表 */
  async listReports(query: { equipmentId?: number; date?: string; page?: number; pageSize?: number }) {
    const page = Number(query.page) > 0 ? Number(query.page) : 1;
    const pageSize = Math.min(Number(query.pageSize) > 0 ? Number(query.pageSize) : 20, 200);
    const where = {
      ...(query.equipmentId ? { equipmentId: Number(query.equipmentId) } : {}),
      ...(query.date ? { date: query.date } : {}),
    };
    const [list, total] = await this.prisma.$transaction([
      this.prisma.equipmentDailyReport.findMany({
        where,
        include: { equipment: { select: { code: true, name: true } } },
        orderBy: [{ date: 'desc' }, { equipmentId: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.equipmentDailyReport.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  /**
   * 生成某天日报（第 46 节核心方法，定时任务只是调它）。
   * 幂等：@@unique([equipmentId, date]) + upsert（用例 3：跑两次数据不翻倍）。
   * 跨天切分：splitByDay 把停机分钟分摊到各天（用例 1）；未结束的停机算到当天 24:00 并标记 open（用例 2）。
   */
  async generateDailyReport(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BusinessException(ErrorCode.VALIDATION, 'date 格式应为 yyyy-MM-dd');
    // 工厂时区的该天 [00:00, 24:00) 对应的 UTC 区间
    const dayStartUtc = new Date(Date.parse(`${date}T00:00:00.000Z`) - 480 * 60_000);
    const dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 3600_000);
    // 该天尚未结束（今天/未来）→ 不生成
    if (dayEndUtc > new Date()) {
      throw new BusinessException(ErrorCode.VALIDATION, `日报只能生成已结束的日期（${date} 尚未结束）`);
    }

    const equipments = await this.prisma.equipment.findMany({ orderBy: { id: 'asc' } });
    let generated = 0;
    for (const eq of equipments) {
      // 该设备与该天有交集的停机记录（含未结束的）
      const downtimes = await this.prisma.downtime.findMany({
        where: {
          equipmentId: eq.id,
          startedAt: { lt: dayEndUtc },
          OR: [{ endedAt: null }, { endedAt: { gt: dayStartUtc } }],
        },
      });
      let downMinutes = 0;
      let downtimeCount = 0;
      let hasOpen = false;
      for (const d of downtimes) {
        downtimeCount += 1;
        const segEnd = d.endedAt ?? dayEndUtc;
        for (const seg of splitByDay(d.startedAt, segEnd)) {
          if (seg.date === date) downMinutes += seg.minutes;
        }
        if (!d.endedAt) hasOpen = true;
      }
      const downOverlap = downtimes.some((d) => d.startedAt < dayEndUtc && (d.endedAt === null || d.endedAt > dayStartUtc));
      const runningMinutes = downOverlap ? Math.max(0, 1440 - downMinutes) : 1440;
      await this.prisma.equipmentDailyReport.upsert({
        where: { equipmentId_date: { equipmentId: eq.id, date } },
        create: { equipmentId: eq.id, date, runningMinutes, downMinutes, downtimeCount, open: hasOpen },
        update: { runningMinutes, downMinutes, downtimeCount, open: hasOpen },
      });
      generated += 1;
    }
    return { date, generated };
  }

  /** 状态日志列表 */
  async listStatusLogs(equipmentId: number) {
    return this.prisma.equipmentStatusLog.findMany({
      where: { equipmentId },
      orderBy: { id: 'desc' },
      take: 100,
    });
  }
}
