<template>
  <el-card>
    <div v-if="$slots.search" class="search">
      <el-form inline @submit.prevent="reload">
        <slot name="search" />
        <el-form-item>
          <el-button type="primary" native-type="submit">查询</el-button>
          <el-button @click="$emit('reset'); reload()">重置</el-button>
        </el-form-item>
      </el-form>
    </div>
    <div v-if="$slots.toolbar" class="toolbar"><slot name="toolbar" /></div>
    <el-table v-loading="loading" :data="rows" stripe @sort-change="onSort">
      <slot />
      <template #empty><el-empty description="暂无数据" /></template>
    </el-table>
    <el-pagination
      class="pager"
      v-model:current-page="page"
      v-model:page-size="pageSize"
      :total="total"
      :page-sizes="[10, 20, 50, 100]"
      layout="total, sizes, prev, pager, next"
      @change="reload"
    />
  </el-card>
</template>

<script setup lang="ts" generic="T">
import { onMounted, ref } from 'vue';
import type { PageQuery, PageResult } from '@mes/shared';

/**
 * ProTable：搜索栏 + 表格 + 分页。传入 fetch(query) 返回 PageResult。
 * 用法见 docs/prompts/crud-module.md（第 10 节）。
 */
const props = defineProps<{ fetch: (q: PageQuery & Record<string, any>) => Promise<PageResult<T>>; params?: Record<string, any> }>();
defineEmits<{ reset: [] }>();

const rows = ref<T[]>([]) as any;
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const loading = ref(false);
const sort = ref<{ sortBy?: string; sortOrder?: 'asc' | 'desc' }>({});

async function reload() {
  loading.value = true;
  try {
    const r = await props.fetch({ page: page.value, pageSize: pageSize.value, ...sort.value, ...(props.params ?? {}) });
    rows.value = r.list; total.value = r.total;
  } catch {
    // 请求失败（无权限 403、网络错误等）：显示空表，不向上抛成 unhandled rejection；
    // 错误提示由 http 拦截器统一弹出
    rows.value = []; total.value = 0;
  } finally { loading.value = false; }
}
function onSort({ prop, order }: { prop: string; order: string | null }) {
  sort.value = order ? { sortBy: prop, sortOrder: order === 'ascending' ? 'asc' : 'desc' } : {};
  reload();
}
onMounted(reload);
defineExpose({ reload });
</script>

<style scoped>
/* 搜索区与工具栏留白统一；表格圆角裁切让条纹不出头 */
.search { margin-bottom: 12px; padding-bottom: 4px; }
.toolbar { margin-bottom: 12px; display: flex; gap: 8px; align-items: center; }
.pager { margin-top: 14px; justify-content: flex-end; }
:deep(.el-table) { border-radius: 8px; }
:deep(.el-table .el-table__row:hover > .el-table__cell) { background: #f5f8ff !important; }
</style>
