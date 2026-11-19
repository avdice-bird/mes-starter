/**
 * 停机时长按天切分纯函数（第 47 节单测对象）。
 *
 * 用例 1：22:00–次日 02:00 → 两天各 120 分钟（不是把 240 全算给结束那天）。
 * 用例 10：日报的"天"按工厂时区（Asia/Shanghai，固定偏移 +8，复用第 24 节口径）。
 */

/** 工厂时区偏移（分钟）：Asia/Shanghai 固定 +8（与 shift.service.factoryLocal 同口径） */
export const FACTORY_TZ_OFFSET_MIN = 480;

export interface DaySplit {
  date: string;       // yyyy-MM-dd（工厂时区）
  minutes: number;    // 该天占用的停机分钟
}

/** 把一个 UTC 时间点换算成工厂时区的日期字符串 */
export function factoryDateOf(at: Date): string {
  return new Date(at.getTime() + FACTORY_TZ_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

/**
 * 按天切分停机区间 [startedAt, endedAt)（左闭右开）。
 * endedAt 为 null（停机未结束）时切到"当天 24:00"由调用方传入 nowOrDayEnd。
 * 粒度：分钟（不足 1 分钟的部分不计）。
 */
export function splitByDay(startedAt: Date, endedAt: Date): DaySplit[] {
  const startMs = startedAt.getTime();
  const endMs = endedAt.getTime();
  if (endMs <= startMs) return [];

  const result: DaySplit[] = [];
  // 用工厂时区的"天边界"推进：先算 startedAt 的工厂日期，然后逐天切
  let cursor = startMs;
  while (cursor < endMs) {
    const date = factoryDateOf(new Date(cursor));
    // 该工厂日的结束时刻（UTC）：工厂时区次日 00:00 = UTC 当日 16:00
    const dayEndUtc = Date.parse(`${date}T00:00:00.000Z`) - FACTORY_TZ_OFFSET_MIN * 60_000 + 24 * 3600_000;
    const segEnd = Math.min(endMs, dayEndUtc);
    const minutes = Math.floor((segEnd - cursor) / 60_000);
    if (minutes > 0) result.push({ date, minutes });
    cursor = segEnd;
    // 防御：若分钟为 0 且没推进（跨分钟边界），强制推进
    if (cursor < endMs && minutes === 0 && segEnd <= startMs) cursor = startMs + 60_000;
  }
  return result;
}

/** 开放停机（未结束）的截止：算到"当前"或指定时刻（日报生成时传当天 24:00） */
export function openEndedOr(now: Date, dayEndDate?: Date): Date {
  return dayEndDate ?? now;
}
