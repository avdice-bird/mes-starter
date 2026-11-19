<template>
  <div class="page">
    <van-pull-refresh v-model="refreshing" @refresh="load">
      <div class="hero">
        <div class="flex-between">
          <div>
            <div class="hero-title">{{ greeting }}，{{ user.displayName }}</div>
            <div class="hero-sub">{{ todayText }} · {{ roleText }}</div>
          </div>
          <van-badge v-if="can('notification:view')" :content="unread" :show-zero="false" :max="99">
            <van-icon
              name="bell"
              size="24"
              color="#fff"
              class="tappable tappable--flat"
              @click="router.push('/notifications')"
            />
          </van-badge>
        </div>
      </div>

      <!-- 指标卡（悬浮在头图上） -->
      <div class="metrics card">
        <template v-if="board">
          <div class="metric">
            <div class="metric-value text-success">{{ fmtQty(board.todayGoodQty) }}</div>
            <div class="metric-label">今日良品</div>
          </div>
          <div class="metric">
            <div class="metric-value text-danger">{{ fmtQty(board.todayDefectQty) }}</div>
            <div class="metric-label">今日不良</div>
          </div>
          <div class="metric">
            <div class="metric-value">{{ board.yieldRate == null ? '—' : board.yieldRate.toFixed(1) + '%' }}</div>
            <div class="metric-label">直通率</div>
          </div>
          <div class="metric">
            <div class="metric-value">{{ board.wipOrders }}</div>
            <div class="metric-label">在制工单</div>
          </div>
        </template>
        <template v-else-if="woStats">
          <div class="metric">
            <div class="metric-value text-primary">{{ woStats.inProgress }}</div>
            <div class="metric-label">进行中工单</div>
          </div>
          <div class="metric">
            <div class="metric-value">{{ woStats.released }}</div>
            <div class="metric-label">已下达</div>
          </div>
          <div class="metric">
            <div class="metric-value text-danger">{{ woStats.delayed }}</div>
            <div class="metric-label">延误工单</div>
          </div>
        </template>
        <template v-else-if="can('andon:view') || can('notification:view')">
          <div class="metric">
            <div class="metric-value text-danger">{{ openAndon.length }}</div>
            <div class="metric-label">待处理安灯</div>
          </div>
          <div class="metric">
            <div class="metric-value">{{ unread }}</div>
            <div class="metric-label">未读消息</div>
          </div>
        </template>
        <template v-else>
          <div class="metric metric--wide">
            <div class="metric-value">MES</div>
            <div class="metric-label">移动工作台</div>
          </div>
        </template>
      </div>

      <div class="content">
        <!-- 快捷入口 -->
        <div class="section-title">快捷操作</div>
        <div class="card quick-card">
          <van-grid :column-num="3" :border="false" :gutter="4">
            <van-grid-item
              v-for="q in quickActions"
              :key="q.name"
              :icon="q.icon"
              :text="q.name"
              :icon-color="q.color"
              @click="router.push(q.to)"
            />
          </van-grid>
          <van-empty v-if="!quickActions.length" image="search" description="当前账号暂无可操作的移动功能" />
        </div>

        <!-- 待处理安灯 -->
        <template v-if="can('andon:view')">
          <div class="section-title">
            <span>待处理安灯</span>
            <span class="more tappable tappable--flat" @click="router.push('/andon')">全部 ›</span>
          </div>
          <div v-if="openAndon.length" class="card andon-list">
            <div
              v-for="a in openAndon.slice(0, 3)"
              :key="a.id"
              class="andon-item tappable"
              @click="router.push('/andon')"
            >
              <div class="andon-icon" :class="`is-${ANDON_TYPE[a.type]?.type ?? 'default'}`">
                <van-icon name="bulb-o" size="18" />
              </div>
              <div class="andon-main">
                <div class="andon-desc">{{ a.description }}</div>
                <div class="muted">
                  {{ ANDON_TYPE[a.type]?.text ?? a.type }}
                  <span v-if="a.escalated" class="text-danger"> · 已升级</span>
                  · {{ timeAgo(a.calledAt) }}
                </div>
              </div>
              <van-icon name="arrow" color="#b6bfce" />
            </div>
          </div>
          <div v-else class="card empty-card">
            <van-icon name="passed" size="22" color="#18a058" />
            <span>当前没有待处理安灯</span>
          </div>
        </template>

        <!-- 最近报工 -->
        <template v-if="board?.recentReports?.length">
          <div class="section-title">
            <span>最近报工</span>
            <span class="more">今日</span>
          </div>
          <div class="card">
            <div v-for="r in board.recentReports.slice(0, 5)" :key="r.id" class="report-item">
              <div class="avatar">{{ (r.employeeName || '?').slice(0, 1) }}</div>
              <div class="report-main">
                <div class="report-title">
                  {{ r.employeeName }} · {{ r.operationName }}
                </div>
                <div class="muted">{{ timeAgo(r.reportedAt) }}</div>
              </div>
              <div class="report-qty">
                <span class="text-success">+{{ r.goodQty }}</span>
                <span v-if="r.defectQty" class="text-danger"> / {{ r.defectQty }}</span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </van-pull-refresh>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useUserStore } from '@/stores/user';
import { useAndonStore } from '@/stores/andon';
import { getBoardSummary, type BoardSummary } from '@/api/board';
import { listOpenAndon, unreadCount, type AndonOpen } from '@/api/andon';
import { listWorkOrders } from '@/api/schedule';
import { ANDON_TYPE, fmtQty, rolesText, timeAgo } from '@/utils/format';

const router = useRouter();
const user = useUserStore();
const andonStore = useAndonStore();
const can = (code: string) => user.has(code);

const refreshing = ref(false);
const board = ref<BoardSummary | null>(null);
const openAndon = ref<AndonOpen[]>([]);
const unread = ref(0);
const woStats = ref<{ inProgress: number; released: number; delayed: number } | null>(null);

const hour = new Date().getHours();
const greeting = hour < 6 ? '夜班辛苦了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
const todayText = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
  weekday: 'long',
}).format(new Date());
const roleText = computed(() => rolesText(user.roles));

interface QuickAction {
  name: string;
  icon: string;
  color: string;
  to: string;
}

const quickActions = computed<QuickAction[]>(() =>
  [
    { name: '扫码报工', icon: 'scan', color: '#1f4e8c', to: '/report', permission: 'work-report:create' },
    { name: '我的工单', icon: 'orders-o', color: '#f59e0b', to: '/work-orders', permission: 'work-order:view' },
    { name: '安灯呼叫', icon: 'bulb-o', color: '#e5484d', to: '/andon', permission: 'andon:view' },
    { name: '库存查询', icon: 'balance-o', color: '#18a058', to: '/inventory', permission: 'inventory:view' },
    { name: '质检任务', icon: 'completed', color: '#7c5cff', to: '/inspections', permission: 'inspection:view' },
    { name: '消息通知', icon: 'bell', color: '#0ea5b7', to: '/notifications', permission: 'notification:view' },
  ].filter((q) => can(q.permission)),
);

async function load() {
  refreshing.value = true;
  const tasks: Promise<unknown>[] = [];

  if (can('board:view')) {
    tasks.push(
      getBoardSummary()
        .then((r) => (board.value = r))
        .catch(() => (board.value = null)),
    );
  }
  if (can('notification:view')) {
    tasks.push(
      unreadCount()
        .then((r) => (unread.value = r.count))
        .catch(() => (unread.value = 0)),
    );
  }
  if (can('andon:view')) {
    tasks.push(
      listOpenAndon()
        .then((r) => {
          openAndon.value = r;
          andonStore.openCount = r.length;
        })
        .catch(() => (openAndon.value = [])),
    );
  }
  if (!can('board:view') && can('work-order:view')) {
    tasks.push(
      Promise.all([
        listWorkOrders({ page: 1, pageSize: 1, status: 'IN_PROGRESS' }),
        listWorkOrders({ page: 1, pageSize: 1, status: 'RELEASED' }),
        listWorkOrders({ page: 1, pageSize: 1, delayed: '1' }),
      ])
        .then(([a, b, c]) => {
          woStats.value = { inProgress: a.total, released: b.total, delayed: c.total };
        })
        .catch(() => (woStats.value = null)),
    );
  }

  await Promise.allSettled(tasks);
  refreshing.value = false;
}

onMounted(load);
</script>

<style scoped>
.hero {
  padding-bottom: 42px;
}

.metrics {
  position: relative;
  z-index: 1;
  margin: -30px 12px 0;
  display: flex;
  justify-content: space-around;
  text-align: center;
  padding: 16px 8px;
}

.metric {
  flex: 1;
  min-width: 0;
}

.metric--wide {
  flex: none;
  padding: 4px 0;
}

.metric-value {
  font-size: 22px;
}

.content {
  padding: 0 12px calc(12px + var(--van-tabbar-height) + env(safe-area-inset-bottom));
}

.quick-card {
  padding: 6px 2px;
}

.quick-card :deep(.van-grid-item__content) {
  padding: 12px 4px;
  background: transparent;
  border-radius: 12px;
  transition: background-color 0.14s ease;
}

.quick-card :deep(.van-grid-item__content:active) {
  background: var(--van-active-color);
}

.quick-card :deep(.van-grid-item__icon) {
  font-size: 26px;
}

.quick-card :deep(.van-grid-item__text) {
  margin-top: 6px;
  font-size: 12px;
  color: #46536b;
}

.andon-list {
  padding: 4px 14px;
}

.andon-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
}

.andon-item + .andon-item {
  border-top: 1px solid var(--line);
}

.andon-icon {
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f1f4f9;
  color: #64748b;
}

.andon-icon.is-danger {
  background: #fdecec;
  color: #e5484d;
}

.andon-icon.is-warning {
  background: #fff4e0;
  color: #f59e0b;
}

.andon-icon.is-primary {
  background: #e8f0fa;
  color: #1f4e8c;
}

.andon-main {
  flex: 1;
  min-width: 0;
}

.andon-desc {
  font-size: 14px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-card {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-sub);
  font-size: 13px;
}

.report-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
}

.report-item + .report-item {
  border-top: 1px solid var(--line);
}

.avatar {
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, #1f4e8c, #14213d);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
}

.report-main {
  flex: 1;
  min-width: 0;
}

.report-title {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.report-qty {
  flex: none;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
</style>
