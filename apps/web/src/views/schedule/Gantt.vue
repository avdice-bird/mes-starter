<template>
  <el-card>
    <div class="toolbar">
      <el-button @click="shiftWindow(-7)">← 上一周</el-button>
      <el-button @click="shiftWindow(7)">下一周 →</el-button>
      <el-button @click="resetWindow">回到本周</el-button>
      <el-button v-permission="'schedule:run'" type="primary" :loading="running" @click="runScheduleNow">一键排产</el-button>
      <span class="hint">拖动条：水平改日期 / 跨行改产线；拖左右把手：调整跨度天数；仅"已创建"状态可拖（<span class="legend legend-delayed">红边</span>=延误，<span class="legend legend-conflict">黄列</span>=超产能）</span>
    </div>

    <div class="gantt" v-loading="loading">
      <div class="grid" :style="gridStyle" ref="gridRef" @dragover.prevent @drop="onGridDrop">
        <!-- 表头行 -->
        <div class="cell head corner" :style="{ gridRow: 1, gridColumn: 1 }">产线 \ 日期</div>
        <div v-for="(d, i) in days" :key="d.iso" class="cell head date"
          :style="{ gridRow: 1, gridColumn: i + 2 }" :data-iso="d.iso"
          :class="{ weekend: d.isWeekend, conflict: conflictDates.has(d.iso) }">
          <div>{{ d.label }}</div>
          <div class="sub">{{ d.weekday }}</div>
        </div>

        <!-- 数据行：产线名 + 每日格子（条作为独立 grid 项叠加在上面） -->
        <template v-for="(row, ri) in rows" :key="row.wcId">
          <div class="cell rowhead" :style="{ gridRow: ri + 2, gridColumn: 1 }"
            :data-wc="row.wcId" :class="{ conflict: conflictByWc.get(row.wcId)?.size }">
            {{ row.wcName }}
            <div class="sub">产能 {{ row.capacity }}/天</div>
          </div>
          <div v-for="(d, ci) in days" :key="d.iso" class="cell slot"
            :style="{ gridRow: ri + 2, gridColumn: ci + 2 }"
            :class="{ weekend: d.isWeekend, conflict: (conflictByWc.get(row.wcId) ?? new Set()).has(d.iso) }" />
        </template>

        <!-- 工单条：跨多天直接作为 grid 项，grid-column: 起始列 / span 天数 -->
        <div v-for="b in allBars" :key="b.wo.id" class="bar"
          :class="barClass(b.wo)" :style="barStyle(b)"
          :draggable="canAdjust && b.wo.status === 'CREATED'"
          @dragstart="onDragStart($event, b.wo)"
          @dragend="dragging = null"
          :title="barTitle(b.wo)">
          <span class="bar-label">{{ b.wo.code }} · {{ b.wo.qty }}</span>
          <span v-if="canAdjust && b.wo.status === 'CREATED'" class="resize-handle left"
            draggable="false" title="拖动调整开始日"
            @pointerdown.stop.prevent="onResizeDown($event, b, 'left')"
            @dragstart.stop.prevent />
          <span v-if="canAdjust && b.wo.status === 'CREATED'" class="resize-handle right"
            draggable="false" title="拖动调整结束日（跨天）"
            @pointerdown.stop.prevent="onResizeDown($event, b, 'right')"
            @dragstart.stop.prevent />
        </div>
      </div>
      <el-alert
        v-if="!loading && !hasBars"
        class="no-bars-tip"
        type="info" :closable="false" show-icon
        title="当前时间窗内没有已排产工单：可用「← 上一周 / 下一周 →」切换，或到「生产订单」页运行一键排产"
      />
      <el-empty v-if="!rows.length && !loading" :description="`${days[0]?.iso} ~ ${days[DAYS - 1]?.iso} 内无产线数据`" />
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { listWorkCenters } from '@/api/routing';
import { getScheduleView, adjustWorkOrderPlan, runSchedule } from '@/api/schedule';
import { useUserStore } from '@/stores/user';
import type { WorkOrderRow } from '@mes/shared';

/**
 * 甘特图（第 29 节）：CSS Grid + 原生拖拽，不引图表库。
 * 结构：rows = 产线（含每格的条索引）；工单条作为独立 grid 项，用
 *       grid-column: 起始列 / span 天数 跨列显示（position:absolute 会退化成单日，已修正）。
 * 拖拽：拖条身 = 平移（保持天数）到 (产线, 日期)；拖左右把手 = 只改开始/结束日，从而手动调整天数。
 * 冲突：同产线同日"在制工单数 × 平均占用"没有日产能明细，用简化口径——
 *       同产线同日起止覆盖该日的工单数量之和（qty/天数均摊）超过 dailyCapacity 的 30% 容差 → 该列黄底。
 */
const loading = ref(false);
const userStore = useUserStore();
/** 只有 schedule:adjust 才能拖拽改计划；只读角色（如 operator）不显示可拖拽手柄 */
const canAdjust = computed(() => userStore.has('schedule:adjust'));
const DAYS = 14;
const from = ref(new Date().toISOString().slice(0, 10));
const workOrders = ref<WorkOrderRow[]>([]);
const capacities = ref<Record<number, number>>({});
/** 全部工作中心：甘特行以产线为准，空周也保留行（否则“回到本周”后连产线都没了） */
const workCenters = ref<{ id: number; name: string; dailyCapacity: number }[]>([]);

const gridRef = ref<HTMLElement>();
const dragging = ref<WorkOrderRow | null>(null);

interface Bar { wo: WorkOrderRow; span: number }
interface Row { wcId: number; wcName: string; capacity: number; bars: Record<string, Bar> }

interface BarItem {
  wo: WorkOrderRow;
  /** 行号（0-based，数据行从 grid 第 2 行起） */
  ri: number;
  /** 起始列下标（0-based，对应 days 数组） */
  startIdx: number;
  span: number;
}

const days = computed(() => {
  const list: { iso: string; label: string; weekday: string; isWeekend: boolean }[] = [];
  const start = new Date(`${from.value}T00:00:00.000Z`);
  const wd = ['日', '一', '二', '三', '四', '五', '六'];
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + i));
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    list.push({ iso, label: iso.slice(5).replace('-', '/'), weekday: `周${wd[dow]}`, isWeekend: dow === 0 || dow === 6 });
  }
  return list;
});

const rows = ref<Row[]>([]);
const DAY_MS = 86_400_000;

/** 工单 → 行 + 起始列 + 跨度（起止在窗口内的部分才显示；跨窗口边缘截断）。
 *  行以工作中心为准（空周也保留产线行与时间轴），条只填有排产的格子 */
function buildRows() {
  const map = new Map<number, Row>();
  const windowStart = new Date(`${from.value}T00:00:00.000Z`).getTime();
  const windowEnd = windowStart + DAYS * DAY_MS;
  for (const wc of workCenters.value) {
    map.set(wc.id, {
      wcId: wc.id, wcName: wc.name, capacity: wc.dailyCapacity ?? 0, bars: {},
    });
  }
  for (const wo of workOrders.value) {
    if (!wo.workCenterId || !wo.plannedStart || !wo.plannedEnd) continue;
    const s = new Date(wo.plannedStart.slice(0, 10) + 'T00:00:00.000Z').getTime();
    const e = new Date(wo.plannedEnd.slice(0, 10) + 'T00:00:00.000Z').getTime();
    if (e < windowStart || s > windowEnd - DAY_MS) continue; // 窗口外的工单不画条
    if (!map.has(wo.workCenterId)) {
      map.set(wo.workCenterId, {
        wcId: wo.workCenterId, wcName: wo.workCenter?.name ?? `#${wo.workCenterId}`,
        capacity: capacities.value[wo.workCenterId] ?? 0, bars: {},
      });
    }
    const row = map.get(wo.workCenterId)!;
    const startIdx = Math.max(0, Math.round((s - windowStart) / DAY_MS));
    const endIdx = Math.min(DAYS - 1, Math.round((e - windowStart) / DAY_MS));
    const key = days.value[startIdx].iso;
    // 同格已有条（重叠工单）不覆盖，冲突列会标黄提示
    if (!row.bars[key]) row.bars[key] = { wo, span: endIdx - startIdx + 1 };
  }
  rows.value = [...map.values()].sort((a, b) => a.wcId - b.wcId);
}

/** 所有条拍平成 grid 项（含所在行与起始列），供模板直接渲染 */
const allBars = computed<BarItem[]>(() => {
  const out: BarItem[] = [];
  rows.value.forEach((row, ri) => {
    for (const key of Object.keys(row.bars)) {
      const b = row.bars[key];
      const startIdx = days.value.findIndex((d) => d.iso === key);
      if (startIdx >= 0) out.push({ wo: b.wo, ri, startIdx, span: b.span });
    }
  });
  return out;
});

/** 当前窗口是否有任何工单条（空周只显示产线骨架 + 提示） */
const hasBars = computed(() => rows.value.some((r) => Object.keys(r.bars).length > 0));

function barClass(wo: WorkOrderRow) {
  return {
    delayed: wo.isDelayed,
    frozen: wo.status !== 'CREATED',
    dragging: dragging.value?.id === wo.id,
    resizing: resizing.value?.woId === wo.id,
  };
}
function barTitle(wo: WorkOrderRow) {
  return `${wo.code} ${wo.material.name} ${wo.qty} 件 ${wo.plannedStart?.slice(0, 10)}~${wo.plannedEnd?.slice(0, 10)}${wo.isDelayed ? '（延误）' : ''}`;
}

/** 条的位置：行 + 起始列 + 跨度天数（拖动调整期间用实时预览值） */
function barStyle(b: BarItem) {
  const live = resizing.value && resizing.value.woId === b.wo.id ? resizing.value : null;
  const startIdx = live ? live.startIdx : b.startIdx;
  const endIdx = live ? live.endIdx : b.startIdx + b.span - 1;
  return {
    gridRow: String(b.ri + 2),
    gridColumn: `${startIdx + 2} / span ${Math.max(1, endIdx - startIdx + 1)}`,
  };
}

const gridStyle = computed(() => ({
  gridTemplateColumns: `140px repeat(${DAYS}, minmax(64px, 1fr))`,
}));

// ---- 冲突计算：同产线同日均摊量超产能 30% 容差 → 黄底 ----
const conflictByWc = ref(new Map<number, Set<string>>());
const conflictDates = ref(new Set<string>());

function buildConflicts() {
  const byWc = new Map<number, Map<string, number>>();
  for (const wo of workOrders.value) {
    if (!wo.workCenterId || !wo.plannedStart || !wo.plannedEnd) continue;
    if (wo.status === 'CANCELLED' || wo.status === 'COMPLETED') continue;
    const s = new Date(wo.plannedStart.slice(0, 10) + 'T00:00:00.000Z').getTime();
    const e = new Date(wo.plannedEnd.slice(0, 10) + 'T00:00:00.000Z').getTime();
    const spanDays = Math.max(1, Math.round((e - s) / DAY_MS) + 1);
    const perDay = wo.qty / spanDays;
    const m = byWc.get(wo.workCenterId) ?? new Map<string, number>();
    const windowStart = new Date(`${from.value}T00:00:00.000Z`).getTime();
    for (let t = s; t <= e; t += DAY_MS) {
      const iso = new Date(t).toISOString().slice(0, 10);
      if (t >= windowStart && t < windowStart + DAYS * DAY_MS) m.set(iso, (m.get(iso) ?? 0) + perDay);
    }
    byWc.set(wo.workCenterId, m);
  }
  const cellConflicts = new Map<number, Set<string>>();
  const anyDate = new Set<string>();
  for (const [wcId, m] of byWc) {
    const cap = capacities.value[wcId] ?? 0;
    if (cap <= 0) continue;
    for (const [iso, load] of m) {
      if (load > cap * 1.3) {
        (cellConflicts.get(wcId) ?? cellConflicts.set(wcId, new Set()).get(wcId)!).add(iso);
        anyDate.add(iso);
      }
    }
  }
  conflictByWc.value = cellConflicts;
  conflictDates.value = anyDate;
}

// ---- 拖动整条：平移（天数不变）----
function onDragStart(e: DragEvent, wo: WorkOrderRow) {
  if (resizing.value) {
    e.preventDefault();
    return; // 正在调跨度时不触发平移
  }
  dragging.value = wo;
  e.dataTransfer?.setData('text/plain', String(wo.id));
  e.dataTransfer!.effectAllowed = 'move';
}

/** 从指针位置解析落点 (产线, 日期)：用表头日期列与行首的实测 rect，避免依赖被条遮住的格子 */
function resolveDropTarget(e: DragEvent): { wcId: number; iso: string } | null {
  const grid = gridRef.value;
  if (!grid) return null;
  const x = e.clientX;
  const y = e.clientY;
  let iso: string | null = null;
  for (const el of grid.querySelectorAll<HTMLElement>('.cell.head.date')) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right) {
      iso = el.dataset.iso ?? null;
      break;
    }
  }
  let wcId: number | null = null;
  for (const el of grid.querySelectorAll<HTMLElement>('.cell.rowhead')) {
    const r = el.getBoundingClientRect();
    if (y >= r.top && y <= r.bottom) {
      wcId = Number(el.dataset.wc);
      break;
    }
  }
  return iso && wcId != null ? { wcId, iso } : null;
}

/** 松手：新 start = 落点日；时长不变；产线 = 落点行。失败提示（服务端未变，reload 即回滚） */
async function onGridDrop(e: DragEvent) {
  const id = Number(e.dataTransfer?.getData('text/plain'));
  const wo = dragging.value ?? workOrders.value.find((w) => w.id === id);
  dragging.value = null;
  if (!wo || wo.id !== id) return;
  if (!canAdjust.value) {
    ElMessage.warning('当前账号无调整排产权限');
    return;
  }
  if (wo.status !== 'CREATED') {
    ElMessage.warning(`工单 ${wo.code} 状态为 ${wo.status}，不可拖动`);
    return;
  }
  const target = resolveDropTarget(e);
  if (!target) return; // 落在表头/行首等非格子区域：忽略
  const { wcId, iso } = target;
  const spanMs = new Date(wo.plannedEnd!.slice(0, 10)).getTime() - new Date(wo.plannedStart!.slice(0, 10)).getTime();
  const newStart = `${iso}T00:00:00.000Z`;
  const newEnd = new Date(new Date(newStart).getTime() + spanMs).toISOString().slice(0, 10);
  if (wo.workCenterId === wcId && wo.plannedStart!.slice(0, 10) === iso) return; // 没动
  try {
    await adjustWorkOrderPlan(wo.id, { plannedStart: iso, plannedEnd: newEnd, workCenterId: wcId });
    ElMessage.success(`${wo.code} → ${iso}${wo.workCenterId !== wcId ? '（换产线）' : ''}`);
    await load();
  } catch {
    ElMessage.error('调整失败：计划未保存');
    await load(); // 回滚显示
  }
}

// ---- 拖动左右把手：只改开始 / 结束日，从而手动增减天数 ----
interface ResizeState { woId: number; edge: 'left' | 'right'; startIdx: number; endIdx: number }
const resizing = ref<ResizeState | null>(null);
let resizeCtx: {
  edge: 'left' | 'right'; origStart: number; origEnd: number;
  startX: number; colWidth: number; wo: WorkOrderRow;
} | null = null;

/** 取单日列宽：用任一日期格子实测（列宽随窗口自适应，不能写死） */
function dayColumnWidth(): number {
  const cell = gridRef.value?.querySelector<HTMLElement>('.cell.slot');
  return cell ? cell.getBoundingClientRect().width + 1 : 64; // +1 为 grid gap
}

function onResizeDown(e: PointerEvent, b: BarItem, edge: 'left' | 'right') {
  if (!canAdjust.value || b.wo.status !== 'CREATED') return;
  const endIdx = b.startIdx + b.span - 1;
  resizeCtx = {
    edge, origStart: b.startIdx, origEnd: endIdx,
    startX: e.clientX, colWidth: dayColumnWidth(), wo: b.wo,
  };
  resizing.value = { woId: b.wo.id, edge, startIdx: b.startIdx, endIdx };
  window.addEventListener('pointermove', onResizeMove);
  window.addEventListener('pointerup', onResizeUp, { once: true });
}

function onResizeMove(e: PointerEvent) {
  const ctx = resizeCtx;
  const state = resizing.value;
  if (!ctx || !state) return;
  const delta = Math.round((e.clientX - ctx.startX) / ctx.colWidth);
  if (ctx.edge === 'left') {
    // 开始日：不能晚于结束日，且不能早于窗口首日
    state.startIdx = Math.min(ctx.origEnd, Math.max(0, ctx.origStart + delta));
  } else {
    // 结束日：不能早于开始日，且不能超出窗口末日
    state.endIdx = Math.max(ctx.origStart, Math.min(DAYS - 1, ctx.origEnd + delta));
  }
}

async function onResizeUp() {
  window.removeEventListener('pointermove', onResizeMove);
  const ctx = resizeCtx;
  const state = resizing.value;
  resizeCtx = null;
  resizing.value = null;
  if (!ctx || !state) return;
  if (state.startIdx === ctx.origStart && state.endIdx === ctx.origEnd) return; // 没变

  const plannedStart = days.value[state.startIdx].iso;
  const plannedEnd = days.value[state.endIdx].iso;
  const workCenterId = ctx.wo.workCenterId;
  if (!workCenterId) return;
  try {
    await adjustWorkOrderPlan(ctx.wo.id, { plannedStart, plannedEnd, workCenterId });
    ElMessage.success(`${ctx.wo.code} 计划改为 ${plannedStart} ~ ${plannedEnd}（${state.endIdx - state.startIdx + 1} 天）`);
    await load();
  } catch {
    ElMessage.error('调整失败：计划未保存');
    await load(); // 回滚显示
  }
}

function shiftWindow(days: number) {
  const d = new Date(`${from.value}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  from.value = d.toISOString().slice(0, 10);
  load();
}
function resetWindow() {
  from.value = new Date().toISOString().slice(0, 10);
  load();
}

/** 一键排产：给「已创建」与「已下达但未排期」的工单填产线/计划日期，然后回到本周展示 */
const running = ref(false);
async function runScheduleNow() {
  try {
    await ElMessageBox.confirm(
      `从今天（${isoDay(0)}）开始排产？将为「已创建」及「已下达未排期」的工单分配产线与计划起止日期。`,
      '一键排产', { type: 'warning' },
    );
  } catch {
    return; // 用户取消
  }
  running.value = true;
  try {
    const r = await runSchedule({ from: isoDay(0) });
    ElMessage.success(`排产完成：${r.scheduled} 张${r.delayed ? `，延误 ${r.delayed} 张` : ''}${r.skipped.length ? `，跳过 ${r.skipped.length} 张` : ''}`);
    from.value = isoDay(0);
    await load();
  } finally {
    running.value = false;
  }
}

async function load(autoLocate = false) {
  loading.value = true;
  try {
    await fetchWindow();
    // 首次进入当前窗口为空（演示数据排产在过去很常见）：向前翻窗口定位最近有排产的区间，最多半年
    if (autoLocate && !workOrders.value.length) {
      for (let i = 1; i <= 12; i++) {
        from.value = isoDay(-i * DAYS);
        await fetchWindow();
        if (workOrders.value.length) break;
      }
      if (!workOrders.value.length) from.value = new Date().toISOString().slice(0, 10); // 全空则回到本周
    }
  } finally {
    loading.value = false;
  }
}

async function fetchWindow() {
  const windowEnd = new Date(new Date(`${from.value}T00:00:00.000Z`).getTime() + DAYS * DAY_MS).toISOString().slice(0, 10);
  const [view, wcs] = await Promise.all([
    getScheduleView({ from: from.value, to: windowEnd }),
    listWorkCenters({ pageSize: 100 }),
  ]);
  capacities.value = Object.fromEntries(wcs.list.map((w) => [w.id, w.dailyCapacity]));
  workCenters.value = wcs.list.map((w) => ({ id: w.id, name: w.name, dailyCapacity: w.dailyCapacity }));
  workOrders.value = view.groups.flatMap((g) => g.items);
  buildRows();
  buildConflicts();
}

/** 今天回退 n 天的 ISO 日期（UTC 口径，与 days 计算一致） */
function isoDay(offsetDays: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

onMounted(() => void load(true));
onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onResizeMove);
  window.removeEventListener('pointerup', onResizeUp);
});
</script>

<style scoped>
.toolbar { margin-bottom: 12px; display: flex; gap: 8px; align-items: center; }
.hint { color: #999; font-size: 12px; margin-left: 12px; }
.legend { padding: 0 6px; border-radius: 3px; }
.legend-delayed { border: 1.5px solid #f56c6c; }
.legend-conflict { background: #faecd8; }
.gantt { overflow-x: auto; }
.no-bars-tip { margin-bottom: 10px; }
.grid { display: grid; gap: 1px; background: #eee; min-width: 1100px; }
.cell { background: #fff; padding: 4px 6px; min-height: 44px; position: relative; }
.cell.head { background: #f5f7fa; font-size: 12px; text-align: center; }
.cell.head .sub { color: #999; font-size: 11px; }
.cell.head.corner { text-align: left; }
.cell.date.weekend { background: #fafafa; color: #bbb; }
.cell.slot.weekend { background: #fafafa; }
.cell.slot { cursor: default; }
.cell.rowhead { background: #f5f7fa; font-size: 13px; }
.cell.rowhead .sub { color: #999; font-size: 11px; }
/* 冲突黄底：日期列头与该行格子 */
.cell.conflict { background: #faecd8; }
/* 工单条是 grid 项，跨天由 grid-column span 决定 */
.bar {
  position: relative;
  margin: 6px 2px 0;
  height: 28px;
  background: #409eff; color: #fff; font-size: 12px; line-height: 28px;
  border-radius: 4px; padding: 0 10px; overflow: hidden; white-space: nowrap;
  text-overflow: ellipsis; cursor: grab; z-index: 2;
  align-self: start;
}
.bar-label { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar.frozen { background: #c0c4cc; cursor: not-allowed; }
.bar.delayed { border: 2px solid #f56c6c; }
.bar.dragging { opacity: 0.5; }
.bar.resizing { opacity: 0.85; cursor: ew-resize; }
.resize-handle {
  position: absolute; top: 0; bottom: 0; width: 10px;
  cursor: ew-resize; z-index: 3; touch-action: none;
}
.resize-handle.left { left: 0; }
.resize-handle.right { right: 0; }
.resize-handle::after {
  content: ''; position: absolute; top: 8px; bottom: 8px; left: 4px; width: 2px;
  background: rgba(255, 255, 255, 0.7); border-radius: 1px;
}
</style>
