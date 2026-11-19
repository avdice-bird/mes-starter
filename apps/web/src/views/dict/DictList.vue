<template>
  <ProTable :fetch="fetch" ref="tableRef" @reset="Object.assign(query, { keyword: '' })">
    <template #search>
      <el-form-item label="关键字">
        <el-input v-model="query.keyword" placeholder="编码 / 名称" clearable maxlength="32" @keyup.enter="tableRef?.reload()" />
      </el-form-item>
    </template>
    <template #toolbar>
      <el-button v-permission="'dict:create'" type="primary" @click="openForm()">新增字典</el-button>
    </template>
    <el-table-column prop="code" label="编码" min-width="160" />
    <el-table-column prop="name" label="名称" min-width="140" />
    <el-table-column prop="remark" label="备注" min-width="180">
      <template #default="{ row }">{{ row.remark || '—' }}</template>
    </el-table-column>
    <el-table-column label="创建时间" width="180">
      <template #default="{ row }">{{ new Date(row.createdAt).toLocaleString() }}</template>
    </el-table-column>
    <el-table-column label="操作" width="230" fixed="right">
      <template #default="{ row }">
        <el-button link type="primary" @click="openItems(row)">字典项</el-button>
        <el-button v-permission="'dict:update'" link type="primary" @click="openForm(row)">编辑</el-button>
        <el-button v-permission="'dict:delete'" link type="danger" @click="onDelete(row)">删除</el-button>
      </template>
    </el-table-column>
  </ProTable>

  <!-- 新增/编辑字典 -->
  <el-dialog v-model="formVisible" :title="editing ? '编辑字典' : '新增字典'" width="440px" destroy-on-close>
    <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
      <el-form-item label="编码" prop="code">
        <el-input v-model="form.code" :disabled="!!editing" maxlength="32" placeholder="2-32 位小写字母数字下划线" />
        <div v-if="!editing" class="field-hint">编码被业务代码引用，创建后不可修改</div>
      </el-form-item>
      <el-form-item label="名称" prop="name">
        <el-input v-model="form.name" maxlength="32" />
      </el-form-item>
      <el-form-item label="备注" prop="remark">
        <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="200" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="formVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>

  <!-- 字典项维护 -->
  <el-drawer v-model="itemsVisible" :title="`字典项 · ${current?.name ?? ''}（${current?.code ?? ''}）`" size="560px" destroy-on-close>
    <div class="items-toolbar">
      <el-button v-permission="'dict:update'" type="primary" size="small" @click="openItemForm()">新增字典项</el-button>
    </div>
    <el-table :data="items" v-loading="itemsLoading" size="small">
      <el-table-column prop="label" label="显示文本" min-width="110" />
      <el-table-column prop="value" label="存储值" min-width="120" />
      <el-table-column prop="sort" label="排序" width="70" />
      <el-table-column label="状态" width="80">
        <template #default="{ row }">
          <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">{{ row.status === 1 ? '启用' : '停用' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button v-permission="'dict:update'" link type="primary" @click="openItemForm(row)">编辑</el-button>
          <el-button v-permission="'dict:update'" link type="danger" @click="onDeleteItem(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="itemFormVisible" :title="itemEditing ? '编辑字典项' : '新增字典项'" width="400px" append-to-body destroy-on-close>
      <el-form ref="itemFormRef" :model="itemForm" :rules="itemRules" label-width="80px">
        <el-form-item label="显示文本" prop="label">
          <el-input v-model="itemForm.label" maxlength="32" />
        </el-form-item>
        <el-form-item label="存储值" prop="value">
          <el-input v-model="itemForm.value" maxlength="64" />
        </el-form-item>
        <el-form-item label="排序" prop="sort">
          <el-input-number v-model="itemForm.sort" :min="0" :max="9999" />
        </el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="itemForm.status" :active-value="1" :inactive-value="0" active-text="启用" inactive-text="停用" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="itemFormVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveItem">保存</el-button>
      </template>
    </el-dialog>
  </el-drawer>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import ProTable from '@/components/ProTable.vue';
import {
  listDicts, getDict, createDict, updateDict, deleteDict,
  createDictItem, updateDictItem, deleteDictItem,
} from '@/api/dict';
import { invalidateDict } from '@/composables/useDict';
import type { DictRow, DictItemRow } from '@mes/shared';

const tableRef = ref<{ reload: () => void } | null>(null);
const query = reactive({ keyword: '' });
const fetch = (q: any) => listDicts({ ...q, keyword: query.keyword });

// ---- 字典表单 ----
const formVisible = ref(false);
const saving = ref(false);
const editing = ref<DictRow | null>(null);
const formRef = ref<FormInstance>();
const form = reactive({ code: '', name: '', remark: '' });
const rules: FormRules = {
  code: [
    { required: true, message: '请输入编码', trigger: 'blur' },
    { pattern: /^[a-z][a-z0-9_]{1,31}$/, message: '2-32 位小写字母开头的字母数字下划线', trigger: 'blur' },
  ],
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
};

function openForm(row?: DictRow) {
  editing.value = row ?? null;
  form.code = row?.code ?? '';
  form.name = row?.name ?? '';
  form.remark = row?.remark ?? '';
  formVisible.value = true;
}

async function save() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;
  saving.value = true;
  try {
    if (editing.value) {
      await updateDict(editing.value.id, { name: form.name, remark: form.remark || undefined });
      ElMessage.success('已保存');
    } else {
      await createDict({ code: form.code, name: form.name, remark: form.remark || undefined });
      ElMessage.success('已创建');
    }
    formVisible.value = false;
    tableRef.value?.reload();
  } finally {
    saving.value = false;
  }
}

async function onDelete(row: DictRow) {
  await ElMessageBox.confirm(`确定删除字典「${row.name}」吗？`, '删除确认', { type: 'warning' });
  await deleteDict(row.id);
  ElMessage.success('已删除');
  tableRef.value?.reload();
}

// ---- 字典项维护 ----
const itemsVisible = ref(false);
const itemsLoading = ref(false);
const current = ref<DictRow | null>(null);
const items = ref<DictItemRow[]>([]);
const itemFormVisible = ref(false);
const itemEditing = ref<DictItemRow | null>(null);
const itemFormRef = ref<FormInstance>();
const itemForm = reactive({ label: '', value: '', sort: 0, status: 1 });
const itemRules: FormRules = {
  label: [{ required: true, message: '请输入显示文本', trigger: 'blur' }],
  value: [{ required: true, message: '请输入存储值', trigger: 'blur' }],
};

async function openItems(row: DictRow) {
  current.value = row;
  itemsVisible.value = true;
  await loadItems();
}

async function loadItems() {
  if (!current.value) return;
  itemsLoading.value = true;
  try {
    const detail = await getDict(current.value.id);
    items.value = detail.items;
  } finally {
    itemsLoading.value = false;
  }
}

function openItemForm(row?: DictItemRow) {
  itemEditing.value = row ?? null;
  itemForm.label = row?.label ?? '';
  itemForm.value = row?.value ?? '';
  itemForm.sort = row?.sort ?? 0;
  itemForm.status = row?.status ?? 1;
  itemFormVisible.value = true;
}

async function saveItem() {
  const valid = await itemFormRef.value?.validate().catch(() => false);
  if (!valid || !current.value) return;
  saving.value = true;
  try {
    if (itemEditing.value) {
      await updateDictItem(itemEditing.value.id, {
        label: itemForm.label, value: itemForm.value, sort: itemForm.sort, status: itemForm.status,
      });
      ElMessage.success('已保存');
    } else {
      await createDictItem(current.value.id, {
        label: itemForm.label, value: itemForm.value, sort: itemForm.sort, status: itemForm.status,
      });
      ElMessage.success('已创建');
    }
    // 字典项变了：useDict 的缓存对这个编码失效（第 11 节清单项）
    invalidateDict(current.value.code);
    itemFormVisible.value = false;
    await loadItems();
  } finally {
    saving.value = false;
  }
}

async function onDeleteItem(row: DictItemRow) {
  await ElMessageBox.confirm(`确定删除字典项「${row.label}」吗？`, '删除确认', { type: 'warning' });
  await deleteDictItem(row.id);
  if (current.value) invalidateDict(current.value.code);
  ElMessage.success('已删除');
  await loadItems();
}
</script>

<style scoped>
.field-hint { font-size: 12px; color: #909399; line-height: 1.4; margin-top: 2px; }
.items-toolbar { margin-bottom: 8px; }
</style>
