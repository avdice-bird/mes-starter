<template>
  <div>
    <ReportFilter v-model="filter" :loading="loading" :exporting="exporting" show-work-center @query="load" @export="onExport" />

    <el-row :gutter="12" class="stat-row">
      <el-col :span="6"><el-statistic title="工单数" :value="rows.length" /></el-col>
      <el-col :span="6"><el-statistic title="延误" :value="rows.filter(r => r.delayed).length" /></el-col>
      <el-col :span="6"><el-statistic title="平均进度%" :value="avgProgress" /></el-col>
      <el-col :span="6"><el-statistic title="完成工单" :value="rows.filter(r => ['COMPLETED','CLOSED'].includes(r.status)).length" /></el-col>
    </el-row>

    <el-table :data="rows" v-loading="loading" size="small" max-height="320" class="progress-table">
      <el-table-column prop="code" label="工单" width="190" />
      <el-table-column prop="workCenterName" label="产线" width="110" />
      <el-table-column label="进度" min-width="220">
        <template #default="{ row }">
          <el-progress :percentage="Math.min(row.progressPct, 100)" :status="row.delayed ? 'exception' : (row.progressPct >= 100 ? 'success' : undefined)" />
        </template>
      </el-table-column>
      <el-table-column label="计划/完成" width="110">
        <template #default="{ row }">{{ row.completedQty }}/{{ row.plannedQty }}</template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="110" />
      <el-table-column label="交期" width="110">
        <template #default="{ row }">{{ row.dueDate ?? '—' }}</template>
      </el-table-column>
      <el-table-column label="延误" width="70">
        <template #default="{ row }">
          <el-tag v-if="row.delayed" type="danger" size="small">延误</el-tag>
        </template>
      </el-table-column>
    </el-table>

    <div ref="barEl" class="chart" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import ReportFilter, { type FilterValue } from './components/ReportFilter.vue';
import { useChart } from './components/useChart';
import { getWorkOrderProgress, exportReport, type WorkOrderProgressRow } from '@/api/reports';

/** 工单进度报表（第 53 节）：表格 + 横向进度条图 + 延误统计 */
const monthStart = () => {
  const d = new Date(Date.now() - 30 * 86_400_000);
  return d.toISOString().slice(0, 10);
};
const filter = ref<FilterValue>({ from: monthStart(), to: new Date().toISOString().slice(0, 10) });
const rows = ref<WorkOrderProgressRow[]>([]);
const loading = ref(false);
const exporting = ref(false);

const avgProgress = computed(() =>
  rows.value.length ? Math.round(rows.value.reduce((s, r) => s + r.progressPct, 0) / rows.value.length * 10) / 10 : 0);

async function load() {
  loading.value = true;
  try {
    rows.value = await getWorkOrderProgress(filter.value);
  } finally {
    loading.value = false;
  }
}

async function onExport() {
  exporting.value = true;
  try {
    await exportReport('/reports/work-order-progress', filter.value, '工单进度.xlsx');
  } catch {
    ElMessage.error('导出失败');
  } finally {
    exporting.value = false;
  }
}

const barEl = ref<HTMLElement>();
const barOption = computed(() => ({
  title: { text: '工单进度（完成/计划）' },
  tooltip: {},
  grid: { left: 160 },
  xAxis: { type: 'value' as const, max: 100 },
  yAxis: { type: 'category' as const, data: rows.value.slice(0, 15).map((r) => r.code), inverse: true },
  series: [{
    type: 'bar' as const,
    data: rows.value.slice(0, 15).map((r) => ({
      value: Math.min(r.progressPct, 100),
      itemStyle: { color: r.delayed ? '#f56c6c' : '#67c23a' },
    })),
    label: { show: true, formatter: (p: { value: number }) => `${p.value}%` },
  }],
}));
useChart(barEl, barOption);

onMounted(load);
</script>

<style scoped>
.stat-row { margin-bottom: 12px; }
.progress-table { margin-bottom: 12px; }
.chart { height: 420px; }
</style>
