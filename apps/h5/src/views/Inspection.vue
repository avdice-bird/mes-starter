<template>
  <div class="page">
    <van-nav-bar title="质检任务" left-arrow @click-left="back">
      <template #right>
        <van-icon name="replay" size="20" @click="reload" />
      </template>
    </van-nav-bar>

    <div class="filter-bar">
      <van-tabs v-model:active="resultTab" shrink @change="reload">
        <van-tab title="全部" name="" />
        <van-tab title="待判" name="PENDING" />
        <van-tab title="合格" name="PASS" />
        <van-tab title="不合格" name="FAIL" />
      </van-tabs>
    </div>

    <div class="page-body">
      <van-pull-refresh v-model="refreshing" @refresh="reload">
        <van-list v-model:loading="loading" :finished="finished" :finished-text="list.length ? '没有更多了' : ''" @load="fetchPage">
          <div v-for="i in list" :key="i.id" class="card insp-card">
            <div class="flex-between">
              <span class="mono insp-code">{{ i.code }}</span>
              <van-tag :type="INSPECTION_RESULT[i.result]?.type ?? 'default'" effect="dark" size="medium">
                {{ INSPECTION_RESULT[i.result]?.text ?? i.result }}
              </van-tag>
            </div>

            <div class="insp-meta">
              <van-tag type="primary" plain size="medium">{{ INSPECTION_TYPE[i.type] ?? i.type }}</van-tag>
              <span class="muted">
                {{ refText(i.refType) }} #{{ i.refId }}
              </span>
            </div>

            <div class="insp-qty">
              <div class="qty-cell">
                <div class="qty-num">{{ i.sampleQty }}</div>
                <div class="muted">抽样</div>
              </div>
              <div class="qty-cell">
                <div class="qty-num text-success">{{ i.passQty }}</div>
                <div class="muted">合格</div>
              </div>
              <div class="qty-cell">
                <div class="qty-num text-danger">{{ i.failQty }}</div>
                <div class="muted">不合格</div>
              </div>
            </div>

            <div v-if="i.defects?.length" class="defect-list">
              <van-tag v-for="d in i.defects" :key="d.id" type="danger" plain>
                {{ d.defectCode?.name ?? d.defectCodeId }} × {{ d.qty }}
              </van-tag>
            </div>

            <div v-if="i.disposition" class="disposition">
              <span class="muted">处置：</span>{{ dispositionText(i.disposition) }}
              <template v-if="i.dispositionReason"> · {{ i.dispositionReason }}</template>
            </div>
            <div v-if="i.remark" class="muted insp-remark">{{ i.remark }}</div>
          </div>

          <van-empty v-if="!list.length && finished" image="search" description="暂无质检任务" />
        </van-list>
      </van-pull-refresh>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { listInspections, type InspectionRow } from '@/api/inspection';
import { INSPECTION_RESULT, INSPECTION_TYPE } from '@/utils/format';

const router = useRouter();
const PAGE_SIZE = 15;

const list = ref<InspectionRow[]>([]);
const loading = ref(false);
const finished = ref(false);
const refreshing = ref(false);
const page = ref(1);
const resultTab = ref('');
let fetching = false;

const DISPOSITION: Record<string, string> = { REWORK: '返工', SCRAP: '报废', CONCESSION: '让步接收' };
const REF_TYPE: Record<string, string> = { LOT: '批次', OPERATION: '工序', WORK_ORDER: '工单' };

function dispositionText(v: string): string {
  return DISPOSITION[v] ?? v;
}

function refText(v: string): string {
  return REF_TYPE[v] ?? v;
}

async function fetchPage() {
  if (fetching || finished.value) return;
  fetching = true;
  loading.value = true;
  try {
    const r = await listInspections({
      page: page.value,
      pageSize: PAGE_SIZE,
      result: resultTab.value || undefined,
    });
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

async function reload() {
  page.value = 1;
  finished.value = false;
  list.value = [];
  refreshing.value = true;
  await fetchPage();
  refreshing.value = false;
}

function back() {
  if (window.history.length > 1) router.back();
  else router.replace('/');
}
</script>

<style scoped>
.filter-bar {
  position: sticky;
  top: calc(46px + env(safe-area-inset-top));
  z-index: 15;
  background: #fff;
  box-shadow: 0 4px 12px rgba(20, 33, 61, 0.04);
}

.filter-bar :deep(.van-tabs__wrap) {
  height: 42px;
}

.insp-card {
  margin-bottom: 12px;
}

.insp-code {
  font-size: 14px;
  font-weight: 700;
  color: #14213d;
}

.insp-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.insp-qty {
  display: flex;
  margin-top: 12px;
  padding: 10px 0;
  border-radius: 10px;
  background: #f7f9fc;
}

.qty-cell {
  flex: 1;
  text-align: center;
}

.qty-cell + .qty-cell {
  border-left: 1px solid var(--line);
}

.qty-num {
  font-size: 18px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.defect-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.disposition {
  margin-top: 10px;
  font-size: 13px;
  color: #33405a;
}

.insp-remark {
  margin-top: 8px;
  font-size: 12px;
}
</style>
