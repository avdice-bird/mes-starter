/**
 * 排产算法：纯函数，不碰 Prisma（第 28 节单测的被测对象）。
 *
 * 伪代码（第 26 节课堂产出，实现与其一一对应）：
 *
 *   schedule(工单列表, 产线列表, 已占用产能, 起始日):
 *     可排产线 = 产线.filter(启用 && 日产能 > 0)
 *     若 工单指定产线 且 不在可排产线（停用/产能0）→ 该工单跳过（原因"产线不可排"）
 *     排序：优先级 asc → 交期 asc → 创建时间 asc（稳定，结果可复现）
 *     已占用产能[产线][日期] ② 从 existingLoad 初始化（已开工工单占的坑）
 *     逐个工单：
 *       候选产线 = 指定产线 ? [该产线] : 可排产线
 *       从起始日（或该产线最后完工次日）逐日找连续 days 天：
 *         days = ceil(qty / 日产能)
 *         产能为 0 的日期（超出窗口）→ 窗口不足，跳过
 *       未指定产线的工单 → 选择"最早能开工"的产线（并列选最早完工）
 *       写 plannedStart/plannedEnd；end > 交期 → isDelayed
 *
 * 说明：
 * - 排产不考虑周末（第 27 节用例 13，ADR-003 扩展点：周末产能记 0 即可接入）
 * - 同产线顺序排：一张工单占满 [start, end] 整段，下一张从 end+1 天起（不做日内混线）
 * - "已开工不重排"由调用方保证：只把 status=CREATED 的工单传进来；已开工的产能通过 existingLoad 扣除
 */

/** 排产输入的工单（与 Prisma WorkOrder 解耦，便于单测） */
export interface SchedulableWorkOrder {
  id: number;
  qty: number;
  /** 指定产线；空 = 按最空闲挑 */
  workCenterId: number | null;
  /** 订单交期（用于延误判定） */
  dueDate: Date;
  /** 订单优先级 1-5，1 最高 */
  priority: number;
  /** 创建时间（同优先级同交期时稳定排序） */
  createdAt: Date;
  /** 创建时间同毫秒时的兜底序（第 27 节用例 12：结果可复现） */
  seq?: number;
}

/** 排产输入的产线 */
export interface SchedulableWorkCenter {
  id: number;
  dailyCapacity: number;
  status: number;
}

/** 单个工单的排产结果 */
export interface ScheduledItem {
  workOrderId: number;
  workCenterId: number;
  plannedStart: Date;
  plannedEnd: Date;
  isDelayed: boolean;
}

/** 跳过原因 */
export interface ScheduleSkip {
  workOrderId: number;
  reason: string;
}

export interface ScheduleResult {
  items: ScheduledItem[];
  skipped: ScheduleSkip[];
}

/** UTC 天数差（日历天，不含时区干扰）；b ≥ a */
export function diffDays(a: Date, b: Date): number {
  return Math.round((Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())
    - Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())) / 86_400_000);
}

/** 第 n 天（from + n 个日历天，UTC 0 点） */
export function addDays(from: Date, n: number): Date {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + n));
}

/**
 * 排产主入口。
 * @param workOrders 待排工单（调用方只传 status=CREATED 的）
 * @param workCenters 参与排产的产线（调用方可按 workCenterIds 过滤）
 * @param existingLoad 已开工工单占用的产能：{ [workCenterId]: { [fromDateIso]: 占用量 } }
 * @param from 排产起始日
 * @param windowDays 排产窗口（天）；窗口内排不下的工单跳过
 */
export function schedule(
  workOrders: SchedulableWorkOrder[],
  workCenters: SchedulableWorkCenter[],
  existingLoad: Record<number, Record<string, number>>,
  from: Date,
  windowDays = 365,
): ScheduleResult {
  const eligible = workCenters.filter((w) => w.status === 1 && w.dailyCapacity > 0);
  const eligibleIds = new Set(eligible.map((w) => w.id));

  // 排序：优先级 → 交期 → 创建时间 → seq（同毫秒兜底，保证可复现）
  const ordered = [...workOrders].sort((a, b) =>
    a.priority - b.priority
    || a.dueDate.getTime() - b.dueDate.getTime()
    || a.createdAt.getTime() - b.createdAt.getTime()
    || (a.seq ?? a.id) - (b.seq ?? b.id),
  );

  // 每条产线已占用量（含 existingLoad 与本次排产新增）
  const load = new Map<number, Map<number, number>>(); // wcId -> (dayIndex -> qty)
  for (const wc of eligible) {
    const dayMap = new Map<number, number>();
    const wcLoad = existingLoad[wc.id] ?? {};
    for (const [iso, qty] of Object.entries(wcLoad)) {
      dayMap.set(diffDays(from, new Date(iso)), qty);
    }
    load.set(wc.id, dayMap);
  }

  const items: ScheduledItem[] = [];
  const skipped: ScheduleSkip[] = [];

  for (const wo of ordered) {
    if (wo.qty <= 0) {
      skipped.push({ workOrderId: wo.id, reason: '数量必须大于 0' });
      continue;
    }
    if (wo.workCenterId !== null && !eligibleIds.has(wo.workCenterId)) {
      skipped.push({ workOrderId: wo.id, reason: '指定产线不可排（不存在/停用/日产能为 0）' });
      continue;
    }
    const candidates = wo.workCenterId !== null
      ? eligible.filter((w) => w.id === wo.workCenterId)
      : eligible;

    // 各候选产线的可行方案：从最早可开工日起连续占 days 天
    let best: { wc: SchedulableWorkCenter; startDay: number; endDay: number } | null = null;
    for (const wc of candidates) {
      const days = Math.ceil(wo.qty / wc.dailyCapacity);
      const dayMap = load.get(wc.id)!;
      const startDay = firstFreeRun(dayMap, days, 0, windowDays);
      if (startDay === null) continue; // 窗口内排不下
      const endDay = startDay + days - 1;
      // 未指定产线：最早开工优先（并列选最早完工）；指定产线：只有一条候选
      if (!best || startDay < best.startDay || (startDay === best.startDay && endDay < best.endDay)) {
        best = { wc, startDay, endDay };
      }
    }

    if (!best) {
      skipped.push({ workOrderId: wo.id, reason: '排产窗口内产能不足' });
      continue;
    }

    // 占产能
    const dayMap = load.get(best.wc.id)!;
    for (let d = best.startDay; d <= best.endDay; d++) {
      dayMap.set(d, (dayMap.get(d) ?? 0) + Math.min(wo.qty, best.wc.dailyCapacity));
    }

    const plannedStart = addDays(from, best.startDay);
    const plannedEnd = addDays(from, best.endDay);
    items.push({
      workOrderId: wo.id,
      workCenterId: best.wc.id,
      plannedStart,
      plannedEnd,
      isDelayed: plannedEnd > wo.dueDate,
    });
  }

  return { items, skipped };
}

/**
 * 从 fromDay 起找第一段连续 days 天、每天都不超过容量（即未被占用）的区间。
 * 占用即"该日产能已满"（口径：排产按整日产能分配，不拆半天）。
 * @returns 起始日序号；窗口内找不到返回 null
 */
export function firstFreeRun(
  dayLoad: Map<number, number>,
  days: number,
  fromDay: number,
  windowDays = 365,
): number | null {
  let runStart = fromDay;
  let runLen = 0;
  for (let d = fromDay; d < fromDay + windowDays; d++) {
    if ((dayLoad.get(d) ?? 0) === 0) {
      runLen += 1;
      if (runLen === days) return runStart;
    } else {
      runStart = d + 1;
      runLen = 0;
    }
  }
  return null;
}
