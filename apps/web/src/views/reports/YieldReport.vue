<template>
  <div>
    <ReportFilter v-model="filter" :loading="loading" :exporting="exporting" show-work-center @query="load" @export="onExport">
      <el-form-item label="分组">
        <el-select v-model="groupBy" style="width: 120px" @change="load">
          <el-option label="物料" value="material" />
          <el-option label="工序" value="operation" />
          <el-option label="班次" value="shift" />
          <el-option label="班组" value="team" />
          <el-option label="日期" value="date" />
        </el-select>
      </el-form-item>
    </ReportFilter>

    <el-row :gutter="12">
      <el-col :span="14">
        <div ref="barEl" class="chart" />
      </el-col>
      <el-col :span="10">
        <div ref="pieEl" class="chart" />
      </el-col>
    </el-row>

    <el-table :data="rows" v-loading="loading" size="small" max-height="300">
      <el-table-column prop="label" label="分组" min-width="140" />
      <el-table-column prop="goodQty" label="良品" width="100" />
      <el-table-column prop="defectQty" label="不良" width="100" />
      <el-table-column label="良率" width="120">
        <template #default="{ row }">{{ row.yieldRate === null ? '—' : `${row.yieldRate}%` }}</template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import ReportFilter, { type FilterValue } from './components/ReportFilter.vue';
import { useChart } from './components/useChart';
import { getYieldReport, getDefectTop, exportReport, type YieldRow, type DefectTopRow } from '@/api/reports';

/** 良率报表（第 53 节）：柱（良/不良）+ 折线（良率）+ 缺陷 TOP5 饼图 */
const monthStart = () => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
const filter = ref<FilterValue>({ from: monthStart(), to: new Date().toISOString().slice(0, 10) });
const groupBy = ref('material');
const rows = ref<YieldRow[]>([]);
const defects = ref<DefectTopRow[]>([]);
const loading = ref(false);
const exporting = ref(false);

async function load() {
  loading.value = true;
  try {
    [rows.value, defects.value] = await Promise.all([
      getYieldReport({ ...filter.value, groupBy: groupBy.value }),
      getDefectTop(filter.value),
    ]);
  } finally {
    loading.value = false;
  }
}

async function onExport() {
  exporting.value = true;
  try {
    await exportReport('/reports/yield', { ...filter.value, groupBy: groupBy.value }, '良率报表.xlsx');
  } catch {
    ElMessage.error('导出失败');
  } finally {
    exporting.value = false;
  }
}

const barEl = ref<HTMLElement>();
const barOption = computed(() => ({
  title: { text: `良率（按${groupBy.value === 'material' ? '物料' : groupBy.value === 'operation' ? '工序' : groupBy.value === 'shift' ? '班次' : groupBy.value === 'team' ? '班组' : '日期'}）` },
  tooltip: { trigger: 'axis' },
  legend: { data: ['良品', '不良', '良率%'] },
  xAxis: { type: 'category' as const, data: rows.value.map((r) => r.label) },
  yAxis: [{ type: 'value' as const, name: '数量' }, { type: 'value' as const, name: '良率%', max: 100 }],
  series: [
    { name: '良品', type: 'bar' as const, stack: 'q', data: rows.value.map((r) => r.goodQty), itemStyle: { color: '#67c23a' } },
    { name: '不良', type: 'bar' as const, stack: 'q', data: rows.value.map((r) => r.defectQty), itemStyle: { color: '#f56c6c' } },
    { name: '良率%', type: 'line' as const, yAxisIndex: 1, data: rows.value.map((r) => r.yieldRate) },
  ],
}));
useChart(barEl, barOption);

const pieEl = ref<HTMLElement>();
const pieOption = computed(() => ({
  title: { text: '缺陷 TOP5', left: 'center' },
  tooltip: { trigger: 'item' },
  series: [{
    type: 'pie' as const,
    radius: ['30%', '60%'],
    data: defects.value.map((d) => ({ name: d.defectName, value: d.qty })),
  }],
}));
useChart(pieEl, pieOption);

onMounted(load);
</script>

<style scoped>
.chart { height: 360px; }
</style>
