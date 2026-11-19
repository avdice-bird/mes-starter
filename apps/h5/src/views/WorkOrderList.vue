<template>
  <div class="page">
    <van-nav-bar title="生产工单">
      <template #right>
        <van-icon name="replay" size="20" @click="reload" />
      </template>
    </van-nav-bar>

    <div class="filter-bar">
      <van-search
        v-model="keyword"
        placeholder="搜索工单号 / 物料编码"
        shape="round"
        @search="reload"
        @clear="reload"
      />
      <van-tabs v-model:active="statusTab" shrink @change="reload">
        <van-tab v-for="t in tabs" :key="t.name" :title="t.title" :name="t.name" />
      </van-tabs>
      <div class="delayed-row">
        <span class="muted">仅看延误工单</span>
        <van-switch v-model="onlyDelayed" size="20px" @change="reload" />
      </div>
    </div>

    <div class="page-body page-body--tabbar list-body">
      <van-pull-refresh v-model="refreshing" @refresh="reload">
        <van-list
          v-model:loading="loading"
          :finished="finished"
          :finished-text="list.length ? '没有更多了' : ''"
          @load="fetchPage"
        >
          <div
            v-for="wo in list"
            :key="wo.id"
            class="wo-card card tappable"
            :class="{ 'is-delayed': wo.isDelayed }"
            @click="router.push(`/work-orders/${wo.id}`)"
          >
            <div class="flex-between">
              <span class="wo-code mono">{{ wo.code }}</span>
              <van-tag :type="statusOf(wo).type" size="medium">{{ statusOf(wo).text }}</van-tag>
            </div>

            <div class="wo-material">{{ wo.material.name }}</div>
            <div class="muted mono">{{ wo.material.code }}</div>

            <div class="wo-meta">
              <span><van-icon name="cluster-o" /> {{ wo.workCenter?.name ?? '未排产' }}</span>
              <span><van-icon name="orders-o" /> 计划 {{ fmtQty(wo.qty) }}</span>
            </div>

            <van-progress
              :percentage="pct(wo.completedQty, wo.qty)"
              :show-pivot="false"
              :color="wo.isDelayed ? '#e5484d' : '#1f4e8c'"
              track-color="#eef1f6"
              stroke-width="6"
            />
            <div class="wo-foot">
              <span class="muted">完成 {{ fmtQty(wo.completedQty) }} / {{ fmtQty(wo.qty) }}</span>
              <span class="muted">交期 {{ formatDate(wo.productionOrder?.dueDate) }}</span>
            </div>

            <van-tag v-if="wo.isDelayed" type="danger" plain class="delay-tag">已延误</van-tag>
          </div>

          <van-empty v-if="!list.length && finished" image="search" description="没有符合条件的工单" />
        </van-list>
      </van-pull-refresh>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onActivated, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { WorkOrderRow } from '@mes/shared';
import { listWorkOrders } from '@/api/schedule';
import { WORK_ORDER_STATUS, fmtQty, formatDate, pct } from '@/utils/format';

const router = useRouter();

const tabs = [
  { title: '全部', name: '' },
  { title: '待开工', name: 'RELEASED' },
  { title: '进行中', name: 'IN_PROGRESS' },
  { title: '暂停', name: 'PAUSED' },
  { title: '已完成', name: 'COMPLETED' },
];

const PAGE_SIZE = 10;
const list = ref<WorkOrderRow[]>([]);
const loading = ref(false);
const finished = ref(false);
const refreshing = ref(false);
const page = ref(1);
const keyword = ref('');
const statusTab = ref('');
const onlyDelayed = ref(false);
let fetching = false;

function statusOf(wo: WorkOrderRow) {
  return WORK_ORDER_STATUS[wo.status] ?? { text: wo.status, type: 'default' as const };
}

function queryOf(pageNo: number) {
  return {
    page: pageNo,
    pageSize: PAGE_SIZE,
    keyword: keyword.value.trim() || undefined,
    status: statusTab.value || undefined,
    delayed: onlyDelayed.value ? '1' : undefined,
  };
}

async function fetchPage() {
  if (fetching || finished.value) return;
  fetching = true;
  loading.value = true;
  try {
    const r = await listWorkOrders(queryOf(page.value));
    list.value = page.value === 1 ? r.list : [...list.value, ...r.list];
    finished.value = r.list.length < PAGE_SIZE || list.value.length >= r.total;
    page.value += 1;
  } catch {
    finished.value = true;
  } finally {
    fetching = false;
    loading.value = false;
  }
}

/**
 * 从详情页返回：按已加载页数静默重取一次，让列表状态跟上详情里的操作。
 * 条数不变时列表复用同一批 DOM 节点，滚动位置不会跳。
 */
async function refreshLoaded() {
  if (fetching) return;
  const pages = Math.max(1, page.value - 1);
  try {
    const next: WorkOrderRow[] = [];
    let lastLen = PAGE_SIZE;
    let total = 0;
    for (let p = 1; p <= pages; p += 1) {
      const r = await listWorkOrders(queryOf(p), { silent: true });
      next.push(...r.list);
      lastLen = r.list.length;
      total = r.total;
      if (r.list.length < PAGE_SIZE) break;
    }
    list.value = next;
    finished.value = lastLen < PAGE_SIZE || next.length >= total;
  } catch {
    // 静默：保留原列表，用户可下拉刷新
  }
}

let activatedOnce = false;
onActivated(() => {
  if (!activatedOnce) {
    activatedOnce = true; // 首次进入由 van-list 的 @load 拉数据
    return;
  }
  void refreshLoaded();
});

async function reload() {
  page.value = 1;
  finished.value = false;
  list.value = [];
  refreshing.value = true;
  await fetchPage();
  refreshing.value = false;
  // 首屏内容不足一屏时，让 List 继续触发加载
  if (!finished.value && list.value.length < PAGE_SIZE) {
    await fetchPage();
  }
}
</script>

<style scoped>
.filter-bar {
  position: sticky;
  top: calc(46px + env(safe-area-inset-top));
  z-index: 15;
  background: #fff;
  padding-bottom: 4px;
  box-shadow: 0 4px 12px rgba(20, 33, 61, 0.04);
}

.filter-bar :deep(.van-search) {
  padding: 8px 12px;
}

.filter-bar :deep(.van-tabs__wrap) {
  height: 40px;
}

.delayed-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 4px 16px 8px;
}

.list-body {
  padding: 12px;
}

.wo-card {
  position: relative;
  margin-bottom: 12px;
  overflow: hidden;
}

.wo-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: #c8d3e4;
}

.wo-card.is-delayed::before {
  background: var(--van-danger-color);
}

.wo-code {
  font-size: 15px;
  font-weight: 700;
  color: #14213d;
}

.wo-material {
  margin-top: 8px;
  font-size: 14px;
  font-weight: 600;
}

.wo-meta {
  display: flex;
  gap: 16px;
  margin: 10px 0 12px;
  font-size: 12px;
  color: #5b6779;
}

.wo-meta .van-icon {
  margin-right: 3px;
  color: #8a95a8;
}

.wo-foot {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
}

.delay-tag {
  position: absolute;
  right: 12px;
  bottom: 12px;
  display: none;
}
</style>
