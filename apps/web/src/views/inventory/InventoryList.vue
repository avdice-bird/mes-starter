<template>
  <div>
    <el-tabs v-model="tab" @tab-change="reloadCurrent">
      <el-tab-pane label="库存余额" name="balances">
        <ProTable :fetch="fetchBalances" ref="balTableRef" @reset="Object.assign(balQuery, { warehouseId: undefined })">
          <template #search>
            <el-form-item label="仓库">
              <el-select v-model="balQuery.warehouseId" placeholder="全部" clearable style="width: 150px" @change="balTableRef?.reload()">
                <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
              </el-select>
            </el-form-item>
          </template>
          <el-table-column label="仓库" min-width="110">
            <template #default="{ row }">{{ row.warehouse.name }}</template>
          </el-table-column>
          <el-table-column label="物料" min-width="150">
            <template #default="{ row }">{{ row.material.code }} {{ row.material.name }}</template>
          </el-table-column>
          <el-table-column label="批次" min-width="170">
            <template #default="{ row }">{{ row.lot.lotNo }}</template>
          </el-table-column>
          <el-table-column prop="qty" label="数量" width="110" />
        </ProTable>
      </el-tab-pane>

      <el-tab-pane label="库存流水（只读）" name="txs">
        <ProTable :fetch="fetchTxs" ref="txTableRef" @reset="Object.assign(txQuery, { type: '' })">
          <template #search>
            <el-form-item label="类型">
              <el-select v-model="txQuery.type" placeholder="全部" clearable style="width: 140px" @change="txTableRef?.reload()">
                <el-option label="领料 ISSUE" value="ISSUE" />
                <el-option label="退料 RETURN" value="RETURN" />
                <el-option label="入库 RECEIPT" value="RECEIPT" />
                <el-option label="调整 ADJUST" value="ADJUST" />
                <el-option label="期初 INIT" value="INIT" />
              </el-select>
            </el-form-item>
          </template>
          <el-table-column prop="id" label="#" width="70" />
          <el-table-column label="类型" width="120">
            <template #default="{ row }">
              <el-tag :type="txTag(row.type)" size="small">{{ txText[row.type] ?? row.type }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="物料" min-width="140">
            <template #default="{ row }">{{ row.material.code }}</template>
          </el-table-column>
          <el-table-column label="批次" min-width="160">
            <template #default="{ row }">{{ row.lot.lotNo }}</template>
          </el-table-column>
          <el-table-column prop="qty" label="数量(+/-)" width="100" />
          <el-table-column label="工单" width="110">
            <template #default="{ row }">{{ row.workOrderId ?? '—' }}</template>
          </el-table-column>
          <el-table-column prop="operatorName" label="操作人" width="90" />
          <el-table-column label="时间" width="160">
            <template #default="{ row }">{{ row.createdAt.slice(0, 16).replace('T', ' ') }}</template>
          </el-table-column>
        </ProTable>
      </el-tab-pane>

      <el-tab-pane label="批次追溯" name="trace">
        <el-form inline @submit.prevent>
          <el-form-item>
            <el-input v-model="traceLotNo" placeholder="输入批次号" clearable style="width: 240px" @keyup.enter="doTrace('back')" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="doTrace('back')">反向追溯</el-button>
            <el-button @click="doTrace('forward')">正向追溯</el-button>
          </el-form-item>
        </el-form>
        <el-tree
          v-if="traceData"
          :data="[traceData]"
          :props="{ label: 'label', children: 'children' }"
          default-expand-all
          node-key="lotNo">
          <template #default="{ data }">
            <span>{{ data.label }}</span>
          </template>
        </el-tree>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import ProTable from '@/components/ProTable.vue';
import { listWarehouses, listBalances, listInventoryTxs, traceBack, traceForward, type TraceNode } from '@/api/schedule';
import type { PageQuery } from '@mes/shared';

const tab = ref('balances');
const warehouses = ref<{ id: number; code: string; name: string }[]>([]);

const balTableRef = ref();
const balQuery = reactive({ warehouseId: undefined as number | undefined });
const fetchBalances = (q: PageQuery) => listBalances({ ...q, warehouseId: balQuery.warehouseId });

const txTableRef = ref();
const txQuery = reactive({ type: '' });
const fetchTxs = (q: PageQuery) => listInventoryTxs({ ...q, type: txQuery.type || undefined });
const txText: Record<string, string> = { ISSUE: '领料', RETURN: '退料', RECEIPT: '入库', ADJUST: '调整', INIT: '期初' };
const txTag = (t: string) => ({ ISSUE: 'warning', RETURN: 'primary', RECEIPT: 'success', ADJUST: 'info', INIT: 'info' }[t] ?? 'info');

// 追溯
const traceLotNo = ref('');
const traceData = ref<{ label: string; children: unknown[] } | null>(null);

async function doTrace(direction: 'back' | 'forward') {
  if (!traceLotNo.value.trim()) return;
  const r = direction === 'back' ? await traceBack(traceLotNo.value.trim()) : await traceForward(traceLotNo.value.trim());
  const toLabel = (n: TraceNode): { label: string; children: unknown[] } => ({
    label: `${n.lotNo}（${n.materialCode} ${n.materialName} × ${n.qty}${n.viaWorkOrder ? '，工单 ' + n.viaWorkOrder : ''}）`,
    children: n.children.map(toLabel),
  });
  traceData.value = toLabel(r.root);
}

function reloadCurrent() {
  if (tab.value === 'balances') balTableRef.value?.reload();
  else if (tab.value === 'txs') txTableRef.value?.reload();
}

onMounted(async () => {
  try {
    warehouses.value = await listWarehouses();
  } catch { /* 无权限时不阻塞 */ }
});
</script>
