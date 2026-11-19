<template>
  <div class="board" :class="{ compact: isCompact }">
    <header class="board-head">
      <div class="head-left">
        <h1>车间实时看板</h1>
        <el-button link class="back-btn" @click="goBack">‹ 返回管理</el-button>
      </div>
      <div class="head-right">
        <span class="clock">{{ clock }}</span>
        <el-select v-model="wcId" placeholder="全部产线" size="small" style="width: 140px" @change="onWcChange">
          <el-option label="全部产线" :value="undefined" />
          <el-option v-for="w in workCenters" :key="w.id" :label="w.name" :value="w.id" />
        </el-select>
      </div>
    </header>

    <div class="grid">
      <!-- 当前安灯（第 50 节）：有 OPEN 呼叫时红色闪烁；点击进安灯列表 -->
      <section v-if="openAndons.length" class="card andon-block" data-testid="andon-block">
        <h3 class="andon-title">⚠ 当前安灯呼叫（{{ openAndons.length }}）</h3>
        <div v-for="a in openAndons" :key="a.id" class="andon-item" :class="{ escalated: a.escalated }">
          <span class="andon-code">{{ a.code }}</span>
          <span class="andon-type">{{ andonTypeText[a.type] ?? a.type }}</span>
          <span class="andon-desc">{{ a.description.split('\n')[0] }}</span>
          <span v-if="a.escalated" class="andon-esc">已升级</span>
        </div>
      </section>

      <!-- 当日产量 / 良率大数字 -->
      <section class="card big-numbers">
        <div class="big">
          <div class="num" data-testid="today-qty">{{ summary?.todayGoodQty ?? 0 }}</div>
          <div class="label">当日产量</div>
        </div>
        <div class="big">
          <div class="num" data-testid="yield-rate">{{ summary?.yieldRate ?? '—' }}<span class="unit">%</span></div>
          <div class="label">良率</div>
        </div>
        <div class="big">
          <div class="num">{{ summary?.wipOrders ?? 0 }}</div>
          <div class="label">在制工单</div>
        </div>
      </section>

      <!-- 设备状态灯 -->
      <section class="card equipment">
        <h3>设备状态</h3>
        <div class="lights">
          <div v-for="(count, st) in summary?.equipmentStatus ?? {}" :key="st" class="light-group">
            <span class="dot" :class="st.toLowerCase()" />
            <span class="light-label">{{ statusText[st] ?? st }}</span>
            <span class="light-count">{{ count }}</span>
          </div>
        </div>
      </section>

      <!-- 最近报工滚动 -->
      <section class="card recent">
        <h3>最近报工</h3>
        <transition-group name="slide" tag="ul" class="recent-list">
          <li v-for="r in recentReports" :key="r.id" :data-testid="'report-' + r.id">
            <span class="time">{{ timeText(r.reportedAt) }}</span>
            <span class="emp">{{ r.employeeName }}</span>
            <span class="op">{{ r.operationName }}</span>
            <span class="qty">+{{ r.goodQty }}<span v-if="r.defectQty" class="defect"> / {{ r.defectQty }} 不良</span></span>
          </li>
        </transition-group>
      </section>
    </div>
    <Watermark />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { io, type Socket } from 'socket.io-client';
import { listWorkCenters } from '@/api/routing';
import { getBoardSummary, type BoardSummary } from '@/api/schedule';
import { listOpenAndon } from '@/api/andon';
import Watermark from '@/components/Watermark.vue';

/** 车间看板（第 48 节）：全屏深色；socket.io 实时推送事件，收到后重新拉 summary（拉状态简单可靠）；
 *  事件风暴节流（第 49 节用例 6）：500ms 合并窗口内的多次事件只触发一次刷新。
 *  房间：互斥（第 49 节）——默认 all，切筛选 emit watch-wc 只收该产线事件。 */

const router = useRouter();
function goBack() {
  void router.push('/');
}

const summary = ref<BoardSummary | null>(null);
const workCenters = ref<{ id: number; name: string }[]>([]);
const wcId = ref<number | undefined>(undefined);
const openAndons = ref<{ id: number; code: string; type: string; escalated: boolean; description: string }[]>([]);
const andonTypeText: Record<string, string> = { MATERIAL: '缺料', EQUIPMENT: '设备', QUALITY: '质量', OTHER: '其他' };
const clock = ref(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
/**
 * 报工时间显示：reportedAt 是 UTC ISO 字符串，直接 slice(11,16) 会显示 UTC 时间（比本地慢 8 小时）。
 * 这里按浏览器本地时区格式化，与右上角时钟口径一致；大屏机器需设置成工厂时区。
 */
const timeText = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const recentReports = computed(() => summary.value?.recentReports ?? []);
const isCompact = computed(() => window.innerWidth < 1600);

const statusText: Record<string, string> = { RUNNING: '运行', IDLE: '空闲', FAULT: '故障', MAINTENANCE: '维护' };

let socket: Socket | null = null;
let throttleTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

async function reload() {
  summary.value = await getBoardSummary(wcId.value);
  // 当前安灯（第 50 节）：OPEN 呼叫红块
  openAndons.value = await listOpenAndon(wcId.value).catch(() => []);
}

/** 切换产线筛选：重新拉 summary 并切换 socket 房间（服务端房间互斥，第 49 节用例 5） */
async function onWcChange() {
  await reload();
  socket?.emit('watch-wc', wcId.value ?? null);
}

/** 节流：500ms 内的多次事件合并为一次 summary 拉取（风暴不卡，用例 6/7） */
function scheduleReload() {
  dirty = true;
  if (throttleTimer) return;
  throttleTimer = setTimeout(async () => {
    throttleTimer = null;
    if (dirty) {
      dirty = false;
      await reload();
    }
  }, 500);
}

let clockTimer: ReturnType<typeof setInterval>;

onMounted(async () => {
  const wcs = await listWorkCenters({ pageSize: 50 }).catch(() => ({ list: [] }));
  workCenters.value = wcs.list;
  await reload();

  // socket.io：token 放 handshake.auth（第 49 节鉴权）；重连后重新拉 summary（用例 1）
  socket = io('/board', {
    path: '/board/socket.io',
    auth: { token: localStorage.getItem('accessToken') ?? '' },
    reconnection: true,
    reconnectionDelay: 1000,
  });
  socket.on('connect', () => {
    void reload();
    // 重连后恢复当前筛选的房间（服务端房间互斥：all 或 wc:<id>）
    socket?.emit('watch-wc', wcId.value ?? null);
  });
  socket.on('work-report.created', scheduleReload);
  socket.on('equipment.status-changed', scheduleReload);
  socket.on('work-order.status-changed', scheduleReload);
  // 安灯事件（第 50 节）：任何 andon.* 都刷新 OPEN 呼叫红块（出现/消失/升级标记）
  socket.on('andon.created', scheduleReload);
  socket.on('andon.responded', scheduleReload);
  socket.on('andon.escalated', scheduleReload);
  socket.on('andon.closed', scheduleReload);
  socket.on('connect_error', (e: Error) => {
    if (String(e.message).includes('rejected')) ElMessage.error('看板连接被拒绝，请重新登录');
  });

  // 页面切回时刷新（用例 7）
  document.addEventListener('visibilitychange', onVisibility);
  clockTimer = setInterval(() => (clock.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })), 1000);
});

function onVisibility() {
  if (document.visibilityState === 'visible') void reload();
}

onBeforeUnmount(() => {
  socket?.disconnect();
  socket = null;
  document.removeEventListener('visibilitychange', onVisibility);
  clearInterval(clockTimer);
  if (throttleTimer) clearTimeout(throttleTimer);
});

import { ElMessage } from 'element-plus';
</script>

<style scoped>
/* 车间看板：全屏大屏页（静态路由，无 AdminLayout）。
   视觉基线：深蓝渐变底 + 卡片描边高光 + 大号等宽数字；compact 阈值 <1600 单列 */
.board {
  min-height: 100vh; color: #e6eaf2; padding: 20px; box-sizing: border-box; overflow-x: hidden;
  background:
    radial-gradient(1000px 400px at 80% -10%, rgba(56, 132, 255, 0.08), transparent 60%),
    radial-gradient(800px 300px at 10% 110%, rgba(55, 214, 122, 0.05), transparent 60%),
    linear-gradient(160deg, #0d1421 0%, #101a2c 100%);
}
.board-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
.head-left { display: flex; align-items: baseline; gap: 16px; }
.back-btn { color: #8fa3c0; font-size: 14px; }
.back-btn:hover { color: #7fd1ff; }
.board-head h1 {
  font-size: 28px; margin: 0; letter-spacing: 6px; white-space: nowrap;
  background: linear-gradient(90deg, #e6eaf2, #7fd1ff);
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
}
.head-right { display: flex; gap: 12px; align-items: center; }
.clock { font-size: 22px; font-variant-numeric: tabular-nums; color: #7fd1ff; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
.compact .grid { grid-template-columns: 1fr; }
.card {
  background: rgba(22, 32, 47, 0.85); border-radius: 12px; padding: 18px; overflow: hidden;
  border: 1px solid rgba(143, 163, 192, 0.12);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
}
.card h3 { margin: 0 0 14px; font-size: 15px; color: #8fa3c0; letter-spacing: 2px; display: flex; align-items: center; gap: 8px; }
.card h3::after { content: ''; flex: 1; height: 1px; background: linear-gradient(90deg, rgba(143, 163, 192, 0.25), transparent); }
/* 大数字区：三列并排，主数字发光 */
.big-numbers { display: flex; justify-content: space-around; align-items: center; grid-column: span 2; }
/* compact（窄屏）下也保持三列横排铺满，竖排会留大片空白 */
.compact .big-numbers { grid-column: span 1; flex-direction: row; gap: 8px; }
.big { text-align: center; }
.num { font-size: 60px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.15; }
.big:nth-child(1) .num { color: #37d67a; text-shadow: 0 0 24px rgba(55, 214, 122, 0.35); }
.big:nth-child(2) .num { color: #7fd1ff; text-shadow: 0 0 24px rgba(127, 209, 255, 0.35); }
.big:nth-child(3) .num { color: #ffb84d; text-shadow: 0 0 24px rgba(255, 184, 77, 0.3); }
.compact .num { font-size: 40px; }
.unit { font-size: 20px; }
.label { color: #8fa3c0; font-size: 14px; margin-top: 6px; letter-spacing: 2px; }
/* 设备状态灯：数量加大、卡片式灯组 */
.lights { display: flex; gap: 12px; flex-wrap: wrap; }
.light-group {
  display: flex; align-items: center; gap: 10px;
  background: rgba(13, 20, 33, 0.5); border-radius: 10px; padding: 10px 16px;
  border: 1px solid rgba(143, 163, 192, 0.08);
}
.dot { width: 14px; height: 14px; border-radius: 50%; display: inline-block; }
.dot.running { background: #37d67a; box-shadow: 0 0 10px #37d67a; animation: pulse 2s ease-in-out infinite; }
.dot.idle { background: #8fa3c0; }
.dot.fault { background: #ff5c5c; box-shadow: 0 0 10px #ff5c5c; }
.dot.maintenance { background: #ffb84d; box-shadow: 0 0 8px rgba(255, 184, 77, 0.6); }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
.light-label { color: #8fa3c0; font-size: 14px; }
.light-count { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; }
/* 最近报工：可滚动（原来的 overflow:hidden 把底部记录裁掉了，看不到也滚不动） */
.recent-list { list-style: none; margin: 0; padding: 0; max-height: 260px; overflow-y: auto; }
.recent-list::-webkit-scrollbar { width: 6px; }
.recent-list::-webkit-scrollbar-thumb { background: rgba(143, 163, 192, 0.3); border-radius: 3px; }
.recent-list li { display: flex; gap: 12px; padding: 8px 6px; border-bottom: 1px solid rgba(34, 48, 71, 0.7); font-size: 14px; border-radius: 6px; }
.recent-list li:hover { background: rgba(127, 209, 255, 0.05); }
.time { color: #7fd1ff; font-variant-numeric: tabular-nums; }
.emp { min-width: 70px; }
.op { flex: 1; color: #b8c4d9; }
.qty { color: #37d67a; font-weight: 600; font-variant-numeric: tabular-nums; }
.defect { color: #ff5c5c; font-weight: 400; }
/* 安灯红块（第 50 节）：呼吸闪烁，升级的加描边 */
.andon-block { grid-column: span 2; border: 2px solid #ff5c5c; animation: andon-blink 1.2s ease-in-out infinite; }
.compact .andon-block { grid-column: span 1; }
.andon-title { color: #ff5c5c !important; }
.andon-item { display: flex; gap: 12px; align-items: center; padding: 6px 0; font-size: 14px; }
.andon-code { color: #ffb84d; font-variant-numeric: tabular-nums; }
.andon-type { color: #ff9c9c; min-width: 40px; }
.andon-desc { flex: 1; color: #e6eaf2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.andon-esc { color: #fff; background: #ff5c5c; border-radius: 4px; padding: 0 6px; font-size: 12px; }
.andon-item.escalated .andon-code { color: #ff5c5c; font-weight: 700; }
@keyframes andon-blink { 0%, 100% { box-shadow: 0 0 4px rgba(255, 92, 92, 0.4); } 50% { box-shadow: 0 0 20px rgba(255, 92, 92, 0.9); } }
.slide-enter-active { transition: all 0.4s; }
.slide-enter-from { opacity: 0; transform: translateY(-12px); }
</style>
