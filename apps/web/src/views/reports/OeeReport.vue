<template>
  <div>
    <ReportFilter v-model="filter" :loading="loading" :exporting="exporting" show-work-center @query="load" @export="onExport">
      <el-form-item label="设备">
        <el-select v-model="equipmentId" clearable placeholder="全部设备" style="width: 160px">
          <el-option v-for="e in equipments" :key="e.id" :label="e.name" :value="e.id" />
        </el-select>
      </el-form-item>
    </ReportFilter>

    <el-row :gutter="12">
      <el-col :span="8"><div ref="availEl" class="gauge" /></el-col>
      <el-col :span="8"><div ref="perfEl" class="gauge" /></el-col>
      <el-col :span="8"><div ref="yieldEl" class="gauge" /></el-col>
    </el-row>

    <el-table :data="rows" v-loading="loading" size="small" max-height="300">
      <el-table-column prop="equipmentCode" label="设备" width="120" />
      <el-table-column prop="equipmentName" label="名称" min-width="120" />
      <el-table-column prop="plannedMinutes" label="计划(分)" width="90" />
      <el-table-column prop="downtimeMinutes" label="停机(分)" width="90" />
      <el-table-column prop="runningMinutes" label="运行(分)" width="90" />
      <el-table-column label="可用率" width="90">
        <template #default="{ row }">{{ row.availability === null ? '—' : `${row.availability}%` }}</template>
      </el-table-column>
      <el-table-column label="表现性" width="90">
        <template #default="{ row }">{{ row.performance === null ? '—' : `${row.performance}%` }}</template>
      </el-table-column>
      <el-table-column label="良率" width="90">
        <template #default="{ row }">{{ row.yieldRate === null ? '—' : `${row.yieldRate}%` }}</template>
      </el-table-column>
      <el-table-column label="OEE" width="90">
        <template #default="{ row }">
          <el-tag :type="oeeColor(row.oee)">{{ row.oee === null ? '—' : `${row.oee}%` }}</el-tag>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import ReportFilter, { type FilterValue } from './components/ReportFilter.vue';
import { useChart } from './components/useChart';
import { getOeeReport, exportReport, listEquipmentsForReport, type OeeRow } from '@/api/reports';

/** OEE 报表（第 53 节）：三仪表盘（口径见 docs/acceptance/reports.md §3） */
const monthStart = () => new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
const filter = ref<FilterValue>({ from: monthStart(), to: new Date().toISOString().slice(0, 10) });
const equipmentId = ref<number | undefined>(undefined);
const equipments = ref<{ id: number; name: string }[]>([]);
const rows = ref<OeeRow[]>([]);
const loading = ref(false);
const exporting = ref(false);

const oeeColor = (v: number | null) => (v === null ? 'info' : v >= 85 ? 'success' : v >= 60 ? 'warning' : 'danger');

async function load() {
  loading.value = true;
  try {
    rows.value = await getOeeReport({ ...filter.value, equipmentId: equipmentId.value });
  } finally {
    loading.value = false;
  }
}

async function onExport() {
  exporting.value = true;
  try {
    await exportReport('/reports/oee', { ...filter.value, equipmentId: equipmentId.value }, 'OEE报表.xlsx');
  } catch {
    ElMessage.error('导出失败');
  } finally {
    exporting.value = false;
  }
}

const gauge = (title: string, value: number | null) => ({
  title: { text: title, left: 'center', textStyle: { fontSize: 14 } },
  series: [{
    type: 'gauge' as const, min: 0, max: 150, startAngle: 210, endAngle: -30,
    progress: { show: true }, axisLine: { lineStyle: { width: 12 } },
    detail: { formatter: '{value}%', fontSize: 20, offsetCenter: [0, '60%'] },
    data: [{ value: value ?? 0, name: title }],
  }],
});

const primary = computed(() => rows.value.reduce((a, b) => (b.oee !== null && (a?.oee === null || (a.oee ?? 0) < b.oee) ? b : a), rows.value[0]));

const availEl = ref<HTMLElement>();
const availOption = computed(() => gauge('可用率', primary.value?.availability ?? null));
useChart(availEl, availOption);

const perfEl = ref<HTMLElement>();
const perfOption = computed(() => gauge('表现性', primary.value?.performance ?? null));
useChart(perfEl, perfOption);

const yieldEl = ref<HTMLElement>();
const yieldOption = computed(() => gauge('良率', primary.value?.yieldRate ?? null));
useChart(yieldEl, yieldOption);

onMounted(async () => {
  void load();
  try {
    equipments.value = await listEquipmentsForReport();
  } catch { /* 权限不足静默 */ }
});
</script>

<style scoped>
.gauge { height: 260px; }
</style>
