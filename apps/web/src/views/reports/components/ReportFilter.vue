<template>
  <el-form inline class="filter-bar">
    <el-form-item label="日期">
      <el-date-picker
        v-model="range" type="daterange" value-format="YYYY-MM-DD"
        start-placeholder="开始" end-placeholder="结束" style="width: 240px"
        :clearable="false"
      />
    </el-form-item>
    <el-form-item label="产线" v-if="props.showWorkCenter">
      <el-select v-model="workCenterId" clearable placeholder="全部" style="width: 150px">
        <el-option v-for="w in workCenters" :key="w.id" :label="w.name" :value="w.id" />
      </el-select>
    </el-form-item>
    <slot />
    <el-form-item>
      <el-button type="primary" :loading="props.loading" @click="emit('query')">查询</el-button>
      <el-button :loading="props.exporting" @click="emit('export')">导出 xlsx</el-button>
    </el-form-item>
  </el-form>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { listWorkCenters } from '@/api/routing';

/** 报表共用筛选栏（第 53 节）：默认本月；日期为工厂时区口径 */
export interface FilterValue { from: string; to: string; workCenterId?: number }

const props = defineProps<{ loading?: boolean; exporting?: boolean; showWorkCenter?: boolean; modelValue: FilterValue }>();
const emit = defineEmits<{ query: []; export: []; 'update:modelValue': [FilterValue] }>();

const range = ref<[string, string]>([props.modelValue.from, props.modelValue.to]);
const workCenterId = ref<number | undefined>(props.modelValue.workCenterId);
const workCenters = ref<{ id: number; name: string }[]>([]);

watch([range, workCenterId], () => {
  emit('update:modelValue', { from: range.value[0], to: range.value[1], workCenterId: workCenterId.value });
});

onMounted(async () => {
  if (!props.showWorkCenter) return;
  try {
    workCenters.value = (await listWorkCenters({ pageSize: 50 })).list;
  } catch { /* 权限不足时静默 */ }
});
</script>

<style scoped>
.filter-bar { margin-bottom: 12px; }
</style>
