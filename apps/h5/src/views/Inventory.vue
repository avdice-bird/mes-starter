<template>
  <div class="page">
    <van-nav-bar title="库存查询" left-arrow @click-left="back">
      <template #right>
        <van-icon name="replay" size="20" @click="reloadActive" />
      </template>
    </van-nav-bar>

    <div class="filter-bar">
      <van-tabs v-model:active="tab" shrink @change="onTabChange">
        <van-tab title="库存余额" name="balances" />
        <van-tab title="出入库流水" name="txs" />
      </van-tabs>
      <div class="warehouse-row tappable" @click="openWarehousePicker">
        <van-icon name="shop-o" />
        <span>{{ warehouseName }}</span>
        <van-icon name="arrow-down" size="12" />
      </div>
    </div>

    <div class="page-body">
      <!-- 余额 -->
      <van-pull-refresh v-if="tab === 'balances'" v-model="refreshB" @refresh="reloadB">
        <van-list v-model:loading="loadingB" :finished="finishedB" :finished-text="balances.length ? '没有更多了' : ''" @load="fetchB">
          <div v-for="b in balances" :key="b.id" class="card stock-card">
            <div class="flex-between">
              <span class="stock-name">{{ b.material.name }}</span>
              <span class="stock-qty">{{ fmtQty(b.qty) }}</span>
            </div>
            <div class="muted mono">{{ b.material.code }}</div>
            <div class="stock-meta">
              <span><van-icon name="shop-o" /> {{ b.warehouse.name }}</span>
              <span><van-icon name="label-o" /> {{ b.lot.lotNo }}</span>
            </div>
          </div>
          <van-empty v-if="!balances.length && finishedB" image="search" description="暂无库存数据" />
        </van-list>
      </van-pull-refresh>

      <!-- 流水 -->
      <van-pull-refresh v-else v-model="refreshT" @refresh="reloadT">
        <van-list v-model:loading="loadingT" :finished="finishedT" :finished-text="txs.length ? '没有更多了' : ''" @load="fetchT">
          <div v-for="t in txs" :key="t.id" class="card tx-card">
            <div class="flex-between">
              <div class="flex gap-8">
                <van-tag :type="TX_TYPE[t.type]?.type ?? 'default'" size="medium">
                  {{ TX_TYPE[t.type]?.text ?? t.type }}
                </van-tag>
                <span class="tx-material">{{ t.material.name }}</span>
              </div>
              <span class="tx-qty" :class="signedClass(t)">
                {{ signedQty(t) }}
              </span>
            </div>
            <div class="muted mono">{{ t.material.code }} · {{ t.lot.lotNo }}</div>
            <div class="stock-meta">
              <span>{{ t.warehouse.name }}</span>
              <span v-if="t.workOrderId">工单 #{{ t.workOrderId }}</span>
              <span>{{ timeAgo(t.createdAt) }}</span>
            </div>
            <div v-if="t.remark" class="tx-remark">{{ t.remark }}</div>
          </div>
          <van-empty v-if="!txs.length && finishedT" image="search" description="暂无流水记录" />
        </van-list>
      </van-pull-refresh>
    </div>

    <van-popup v-model:show="whPicker.show" position="bottom" round>
      <van-picker
        :key="whPicker.version"
        :columns="whPicker.columns"
        title="选择仓库"
        @confirm="onWarehouseConfirm"
        @cancel="whPicker.show = false"
      />
    </van-popup>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  listBalances,
  listInventoryTxs,
  listWarehouses,
  type InventoryBalanceRow,
  type InventoryTxRow,
  type WarehouseRow,
} from '@/api/inventory';
import { TX_TYPE, fmtQty, timeAgo } from '@/utils/format';

const router = useRouter();
const PAGE_SIZE = 15;

const tab = ref<'balances' | 'txs'>('balances');
const warehouseId = ref(0);
const warehouses = ref<WarehouseRow[]>([]);
const warehouseName = computed(() => {
  if (!warehouseId.value) return '全部仓库';
  return warehouses.value.find((w) => w.id === warehouseId.value)?.name ?? '全部仓库';
});

// 余额
const balances = ref<InventoryBalanceRow[]>([]);
const loadingB = ref(false);
const finishedB = ref(false);
const refreshB = ref(false);
const pageB = ref(1);
let fetchingB = false;

async function fetchB() {
  if (fetchingB || finishedB.value) return;
  fetchingB = true;
  loadingB.value = true;
  try {
    const r = await listBalances({
      page: pageB.value,
      pageSize: PAGE_SIZE,
      warehouseId: warehouseId.value || undefined,
    });
    balances.value = pageB.value === 1 ? r.list : [...balances.value, ...r.list];
    finishedB.value = r.list.length < PAGE_SIZE || balances.value.length >= r.total;
    pageB.value += 1;
  } catch {
    finishedB.value = true;
  } finally {
    fetchingB = false;
    loadingB.value = false;
  }
}

async function reloadB() {
  pageB.value = 1;
  finishedB.value = false;
  balances.value = [];
  refreshB.value = true;
  await fetchB();
  refreshB.value = false;
}

// 流水
const txs = ref<InventoryTxRow[]>([]);
const loadingT = ref(false);
const finishedT = ref(false);
const refreshT = ref(false);
const pageT = ref(1);
let fetchingT = false;

async function fetchT() {
  if (fetchingT || finishedT.value) return;
  fetchingT = true;
  loadingT.value = true;
  try {
    const r = await listInventoryTxs({
      page: pageT.value,
      pageSize: PAGE_SIZE,
      warehouseId: warehouseId.value || undefined,
    });
    txs.value = pageT.value === 1 ? r.list : [...txs.value, ...r.list];
    finishedT.value = r.list.length < PAGE_SIZE || txs.value.length >= r.total;
    pageT.value += 1;
  } catch {
    finishedT.value = true;
  } finally {
    fetchingT = false;
    loadingT.value = false;
  }
}

async function reloadT() {
  pageT.value = 1;
  finishedT.value = false;
  txs.value = [];
  refreshT.value = true;
  await fetchT();
  refreshT.value = false;
}

function onTabChange(name: string | number) {
  if (name === 'txs' && !txs.value.length && !fetchingT) void reloadT();
}

function reloadActive() {
  if (tab.value === 'balances') void reloadB();
  else void reloadT();
}

/* 仓库选择 */
const whPicker = reactive({ show: false, version: 0, columns: [] as { text: string; value: number }[] });

async function loadWarehouses() {
  try {
    warehouses.value = await listWarehouses();
  } catch {
    warehouses.value = [];
  }
}

function openWarehousePicker() {
  const all = [
    { text: '全部仓库', value: 0 },
    ...warehouses.value.map((w) => ({ text: `${w.code} ${w.name}`, value: w.id })),
  ];
  // 当前选中项放首位：重新打开选择器后直接确认不会把已选仓库重置
  whPicker.columns = [
    ...all.filter((o) => o.value === warehouseId.value),
    ...all.filter((o) => o.value !== warehouseId.value),
  ];
  whPicker.version += 1;
  whPicker.show = true;
}

// Vant 3 单列 Picker 的 confirm 回调是 (选中项, 索引)
function onWarehouseConfirm(picked: any) {
  const opt = Array.isArray(picked) ? picked[0] : picked;
  if (opt && opt.value != null) {
    warehouseId.value = Number(opt.value);
    if (tab.value === 'balances') void reloadB();
    else void reloadT();
  }
  whPicker.show = false;
}

function signedQty(t: InventoryTxRow): string {
  const sign = t.type === 'ISSUE' ? '-' : t.qty >= 0 ? '+' : '-';
  return `${sign}${fmtQty(Math.abs(t.qty))}`;
}

function signedClass(t: InventoryTxRow): string {
  if (t.type === 'ISSUE') return 'text-danger';
  if (t.type === 'RETURN' || t.type === 'RECEIPT') return 'text-success';
  return '';
}

function back() {
  if (window.history.length > 1) router.back();
  else router.replace('/');
}

onMounted(() => {
  void loadWarehouses();
});
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

.warehouse-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px 10px;
  font-size: 13px;
  color: #46536b;
}

.stock-card,
.tx-card {
  margin-bottom: 12px;
}

.stock-name,
.tx-material {
  font-size: 14px;
  font-weight: 600;
}

.stock-qty {
  font-size: 20px;
  font-weight: 800;
  color: #1f4e8c;
  font-variant-numeric: tabular-nums;
}

.tx-qty {
  font-size: 16px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.stock-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 8px;
  font-size: 12px;
  color: #7c8698;
}

.stock-meta .van-icon {
  margin-right: 2px;
}

.tx-remark {
  margin-top: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  background: #f6f8fc;
  font-size: 12px;
  color: #5b6779;
}
</style>
