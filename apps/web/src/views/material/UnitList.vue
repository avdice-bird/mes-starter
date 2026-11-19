<template>
  <ProTable :fetch="fetch" ref="tableRef" @reset="Object.assign(query, { keyword: '' })">
    <template #search>
      <el-form-item label="关键字">
        <el-input v-model="query.keyword" placeholder="编码 / 名称" clearable maxlength="32" @keyup.enter="tableRef?.reload()" />
      </el-form-item>
    </template>
    <template #toolbar>
      <el-button v-permission="'unit:create'" type="primary" @click="openForm()">新增单位</el-button>
    </template>
    <el-table-column prop="code" label="编码" min-width="120" />
    <el-table-column prop="name" label="名称" min-width="120" />
    <el-table-column prop="materialCount" label="物料数" width="90" />
    <el-table-column label="状态" width="90">
      <template #default="{ row }">
        <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">{{ row.status === 1 ? '启用' : '停用' }}</el-tag>
      </template>
    </el-table-column>
    <el-table-column label="创建时间" width="180">
      <template #default="{ row }">{{ new Date(row.createdAt).toLocaleString() }}</template>
    </el-table-column>
    <el-table-column label="操作" width="140" fixed="right">
      <template #default="{ row }">
        <el-button v-permission="'unit:update'" link type="primary" @click="openForm(row)">编辑</el-button>
        <el-button v-permission="'unit:delete'" link type="danger" @click="onDelete(row)">删除</el-button>
      </template>
    </el-table-column>
  </ProTable>

  <el-dialog v-model="formVisible" :title="editing ? '编辑单位' : '新增单位'" width="440px" destroy-on-close>
    <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
      <el-form-item label="编码" prop="code">
        <el-input v-model="form.code" :disabled="!!editing" maxlength="16" placeholder="如 PCS / M / KG" />
        <div v-if="!editing" class="field-hint">编码创建后不可修改</div>
      </el-form-item>
      <el-form-item label="名称" prop="name">
        <el-input v-model="form.name" maxlength="32" />
      </el-form-item>
      <el-form-item v-if="editing" label="状态">
        <el-switch v-model="form.status" :active-value="1" :inactive-value="0" active-text="启用" inactive-text="停用" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="formVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import ProTable from '@/components/ProTable.vue';
import { listUnits, createUnit, updateUnit, deleteUnit } from '@/api/unit';
import type { UnitRow } from '@mes/shared';

const tableRef = ref<{ reload: () => void } | null>(null);
const query = reactive({ keyword: '' });
const fetch = (q: any) => listUnits({ ...q, keyword: query.keyword || undefined });

const formVisible = ref(false);
const saving = ref(false);
const editing = ref<UnitRow | null>(null);
const formRef = ref<FormInstance>();
const form = reactive({ code: '', name: '', status: 1 });
const rules: FormRules = {
  code: [
    { required: true, message: '请输入编码', trigger: 'blur' },
    { pattern: /^[A-Za-z][A-Za-z0-9_]{1,15}$/, message: '2-16 位字母开头的字母数字下划线', trigger: 'blur' },
  ],
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
};

function openForm(row?: UnitRow) {
  editing.value = row ?? null;
  form.code = row?.code ?? '';
  form.name = row?.name ?? '';
  form.status = row?.status ?? 1;
  formVisible.value = true;
}

async function save() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;
  saving.value = true;
  try {
    if (editing.value) {
      await updateUnit(editing.value.id, { name: form.name, status: form.status });
    } else {
      await createUnit({ code: form.code, name: form.name });
    }
    ElMessage.success('已保存');
    formVisible.value = false;
    tableRef.value?.reload();
  } finally {
    saving.value = false;
  }
}

async function onDelete(row: UnitRow) {
  await ElMessageBox.confirm(`确定删除单位「${row.name}（${row.code}）」吗？被物料引用的单位无法删除。`, '删除确认', { type: 'warning' });
  await deleteUnit(row.id);
  ElMessage.success('已删除');
  tableRef.value?.reload();
}
</script>

<style scoped>
.field-hint { font-size: 12px; color: #909399; line-height: 1.4; margin-top: 2px; }
</style>
