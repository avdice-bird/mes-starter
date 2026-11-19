<template>
  <ProTable :fetch="fetch" ref="tableRef" @reset="Object.assign(query, { module: '', result: '' })">
    <template #search>
      <el-form-item label="模块">
        <el-input v-model="query.module" placeholder="如 dicts / auth" clearable maxlength="32" @keyup.enter="tableRef?.reload()" />
      </el-form-item>
      <el-form-item label="结果">
        <el-select v-model="query.result" placeholder="全部" clearable style="width: 120px">
          <el-option label="成功" value="success" />
          <el-option label="未登录(1002)" value="1002" />
          <el-option label="无权限(1003)" value="1003" />
          <el-option label="冲突(1005)" value="1005" />
        </el-select>
      </el-form-item>
    </template>
    <el-table-column prop="id" label="ID" width="70" />
    <el-table-column prop="username" label="用户" width="100">
      <template #default="{ row }">{{ row.username || `#${row.userId ?? '匿名'}` }}</template>
    </el-table-column>
    <el-table-column label="操作" min-width="160">
      <template #default="{ row }">
        <el-tag size="small" :type="methodTag(row.method)" class="method-tag">{{ row.method }}</el-tag>
        <span class="mono">{{ row.path }}</span>
      </template>
    </el-table-column>
    <el-table-column prop="module" label="模块" width="90" />
    <el-table-column label="结果" width="90">
      <template #default="{ row }">
        <el-tag :type="row.result === 'success' ? 'success' : 'danger'" size="small">{{ row.result }}</el-tag>
      </template>
    </el-table-column>
    <el-table-column prop="durationMs" label="耗时" width="90">
      <template #default="{ row }">{{ row.durationMs }} ms</template>
    </el-table-column>
    <el-table-column prop="ip" label="IP" width="120" />
    <el-table-column label="时间" width="180">
      <template #default="{ row }">{{ new Date(row.createdAt).toLocaleString() }}</template>
    </el-table-column>
    <el-table-column label="参数" width="80" fixed="right">
      <template #default="{ row }">
        <el-button link type="primary" @click="showParams(row)">查看</el-button>
      </template>
    </el-table-column>
  </ProTable>

  <el-dialog v-model="paramsVisible" title="参数摘要（已脱敏）" width="560px">
    <pre class="params-pre">{{ paramsShown }}</pre>
  </el-dialog>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import ProTable from '@/components/ProTable.vue';
import { listAuditLogs } from '@/api/audit';
import type { AuditLogRow } from '@mes/shared';

const tableRef = ref<{ reload: () => void } | null>(null);
const query = reactive({ module: '', result: '' });

/** result 筛选：后端 result 存 success 或错误码（1002/1003/1005…），按值精确匹配 */
const fetch = (q: any) =>
  listAuditLogs({
    ...q,
    module: query.module || undefined,
    result: query.result || undefined,
  });

const paramsVisible = ref(false);
const paramsShown = ref('');
function showParams(row: AuditLogRow) {
  try {
    paramsShown.value = JSON.stringify(JSON.parse(row.params), null, 2);
  } catch {
    paramsShown.value = row.params;
  }
  paramsVisible.value = true;
}

function methodTag(method: string) {
  return { POST: 'primary', PUT: 'warning', PATCH: 'warning', DELETE: 'danger' }[method] ?? 'info';
}
</script>

<style scoped>
.mono { font-family: Consolas, monospace; font-size: 12px; }
.params-pre { background: #f5f7fa; padding: 12px; border-radius: 4px; max-height: 400px; overflow: auto; font-size: 12px; }
.method-tag { margin-right: 6px; }
</style>
