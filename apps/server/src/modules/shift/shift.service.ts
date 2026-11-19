import { Injectable } from '@nestjs/common';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../prisma/prisma.service';

/** 工厂时区：班次时间按工厂本地时区判断，不依赖服务器时区（第 24 节用例 12） */
export const FACTORY_TZ = process.env.FACTORY_TZ ?? 'Asia/Shanghai';
/** 常见时区偏移（小时）表：覆盖亚洲主要工厂时区；未列出时回退 +8 */
const TZ_OFFSET_HOURS: Record<string, number> = {
  'Asia/Shanghai': 8, 'Asia/Hong_Kong': 8, 'Asia/Taipei': 8, 'Asia/Singapore': 8,
  'Asia/Tokyo': 9, 'Asia/Seoul': 9, 'Asia/Bangkok': 7, 'Asia/Jakarta': 7,
  'Asia/Kolkata': 5.5, 'Asia/Dubai': 4, 'Europe/Berlin': 1, 'Europe/London': 0,
  'America/New_York': -5, 'America/Los_Angeles': -8,
};

/**
 * 把 UTC 时刻换算成工厂本地时区的 "HH:mm" 与日期偏移。
 * 不用 new Date().getHours()（取决于服务器时区）；显式按 UTC 毫秒 + 固定偏移计算。
 */
export function factoryLocal(at: Date): { minutesOfDay: number; dayOffsetFromUtc: number } {
  const offsetH = TZ_OFFSET_HOURS[FACTORY_TZ] ?? 8;
  const offsetMs = offsetH * 3600_000;
  const local = new Date(at.getTime() + offsetMs);
  const minutesOfDay = local.getUTCHours() * 60 + local.getUTCMinutes();
  // 本地日期与 UTC 日期的差（跨天班次判断用）
  const utcDay = Math.floor(at.getTime() / 86400_000);
  const localDay = Math.floor((at.getTime() + offsetMs) / 86400_000);
  return { minutesOfDay, dayOffsetFromUtc: localDay - utcDay };
}

/** 解析 "HH:mm" → 当天分钟数 */
export function parseHHmm(v: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m) throw new BusinessException(ErrorCode.VALIDATION, `时间格式须为 HH:mm：${v}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new BusinessException(ErrorCode.VALIDATION, `时间格式须为 HH:mm（0–23 时）：${v}`);
  return h * 60 + min;
}

@Injectable()
export class ShiftService {
  constructor(private prisma: PrismaService) {}

  async list(query: { page?: number; pageSize?: number }) {
    // @Query() 裸对象：数值参数显式转换
    const page = Number(query.page) > 0 ? Number(query.page) : 1;
    const pageSize = Math.min(Number(query.pageSize) > 0 ? Number(query.pageSize) : 50, 200);
    const [list, total] = await this.prisma.$transaction([
      this.prisma.shift.findMany({ orderBy: { id: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.shift.count(),
    ]);
    return { list, total, page, pageSize };
  }

  async create(dto: { code: string; name: string; startTime: string; endTime: string }, operator: string) {
    const start = parseHHmm(dto.startTime);
    const end = parseHHmm(dto.endTime);
    const crossDay = end <= start; // 结束 ≤ 开始即跨天（00:00-08:00：0 < 480 → 跨天；08:00-16:00 不跨）
    await this.assertNoOverlap(start, end, crossDay, null);
    return this.prisma.shift.create({
      data: { code: dto.code, name: dto.name, startTime: dto.startTime, endTime: dto.endTime, crossDay, createdBy: operator, updatedBy: operator },
    });
  }

  async update(id: number, dto: { name?: string; startTime?: string; endTime: string | undefined }, operator: string) {
    const shift = await this.prisma.shift.findUnique({ where: { id } });
    if (!shift) throw new BusinessException(ErrorCode.NOT_FOUND, '班次不存在');
    const start = parseHHmm(dto.startTime ?? shift.startTime);
    const end = parseHHmm(dto.endTime ?? shift.endTime);
    const crossDay = end <= start;
    await this.assertNoOverlap(start, end, crossDay, id);
    return this.prisma.shift.update({
      where: { id },
      data: { name: dto.name, startTime: dto.startTime, endTime: dto.endTime, crossDay, updatedBy: operator },
    });
  }

  /** 重叠检查：任意两班次的时间区间（跨天拆两段）不能相交。允许空档（第 24 节用例 4），不允许重叠（用例 3） */
  private async assertNoOverlap(start: number, end: number, crossDay: boolean, excludeId: number | null) {
    const segments: [number, number][] = crossDay ? [[start, 1440], [0, end]] : [[start, end]];
    const all = await this.prisma.shift.findMany();
    for (const s of all) {
      if (excludeId !== null && s.id === excludeId) continue;
      const sStart = parseHHmm(s.startTime);
      const sEnd = parseHHmm(s.endTime);
      const sSegs: [number, number][] = s.crossDay ? [[sStart, 1440], [0, sEnd]] : [[sStart, sEnd]];
      for (const [a1, a2] of segments) {
        for (const [b1, b2] of sSegs) {
          // 区间 [a1,a2) 与 [b1,b2) 相交（含头不含尾）
          if (a1 < b2 && b1 < a2) {
            throw new BusinessException(ErrorCode.CONFLICT, `班次时间与「${s.name}」（${s.startTime}-${s.endTime}）重叠`);
          }
        }
      }
    }
  }

  /**
   * 当前班次：at 作为参数传入（第 25 节检查项——可测性：不内部取 new Date()）。
   * 判定：工厂本地时间 minutesOfDay ∈ [start, end)（含头不含尾）；跨天班次拆两段；
   * 空档返回 null（调用方决定提示）。查询次数固定 1。
   */
  async getCurrentShift(at: Date) {
    const { minutesOfDay } = factoryLocal(at);
    const shifts = await this.prisma.shift.findMany();
    for (const s of shifts) {
      const start = parseHHmm(s.startTime);
      const end = parseHHmm(s.endTime);
      if (s.crossDay) {
        // 跨天：如 22:00-06:00 → [22:00,24:00) 或 [00:00,06:00)
        if (minutesOfDay >= start || minutesOfDay < end) return s;
      } else {
        if (minutesOfDay >= start && minutesOfDay < end) return s;
      }
    }
    return null;
  }

  async remove(id: number) {
    const shift = await this.prisma.shift.findUnique({ where: { id } });
    if (!shift) throw new BusinessException(ErrorCode.NOT_FOUND, '班次不存在');
    await this.prisma.shift.delete({ where: { id } });
  }
}
