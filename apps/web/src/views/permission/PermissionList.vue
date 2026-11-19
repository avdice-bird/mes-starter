<template>
  <el-card>
    <div class="toolbar">
      <el-input v-model="keyword" placeholder="按编码 / 名称 / 模块过滤" clearable style="width: 260px" />
      <el-button type="primary" @click="load">刷新</el-button>
    </div>
    <el-alert type="info" :closable="false" class="tip"
      title="权限码由后端种子表维护（代码里的 @Permissions 码必须先入表），因此这里只读。" />
    <el-table v-loading="loading" :data="filtered" stripe>
      <el-table-column prop="module" label="模块" width="140" />
      <el-table-column prop="code" label="权限码" min-width="180" />
      <el-table-column prop="name" label="名称" min-width="140" />
      <template #empty><el-empty description="暂无数据" /></template>
    </el-table>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { listPermissions } from '@/api/permission';
import type { PermissionRow } from '@mes/shared';

const rows = ref<PermissionRow[]>([]);
const loading = ref(false);
const keyword = ref('');

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase();
  if (!k) return rows.value;
  return rows.value.filter((r) => [r.code, r.name, r.module].some((v) => v.toLowerCase().includes(k)));
});

async function load() {
  loading.value = true;
  try { rows.value = await listPermissions(); } finally { loading.value = false; }
}
onMounted(load);
</script>

<style scoped>
.toolbar { margin-bottom: 12px; display: flex; gap: 8px; }
.tip { margin-bottom: 12px; }
</style>
