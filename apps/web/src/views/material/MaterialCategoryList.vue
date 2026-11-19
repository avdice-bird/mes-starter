<template>
  <el-card>
    <div class="toolbar">
      <el-button v-permission="'material-category:create'" type="primary" @click="openForm(null)">新增根分类</el-button>
      <el-button @click="load">刷新</el-button>
    </div>
    <el-table :data="tree" v-loading="loading" row-key="id" default-expand-all
      :tree-props="{ children: 'children' }">
      <el-table-column prop="code" label="编码" min-width="160" />
      <el-table-column prop="name" label="名称" min-width="180" />
      <el-table-column prop="materialCount" label="物料数" width="90" />
      <el-table-column label="操作" width="230" fixed="right">
        <template #default="{ row }">
          <el-button v-permission="'material-category:create'" link type="primary" @click="openForm(null, row.id)">加子级</el-button>
          <el-button v-permission="'material-category:update'" link type="primary" @click="openForm(row)">编辑</el-button>
          <el-button v-permission="'material-category:delete'" link type="danger" @click="onDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="formVisible" :title="formTitle" width="440px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
        <el-form-item label="父分类">
          <el-tree-select v-model="form.parentId" :data="parentOptions" check-strictly clearable
            placeholder="不选则为根分类" style="width: 100%" />
        </el-form-item>
        <el-form-item label="编码" prop="code">
          <el-input v-model="form.code" :disabled="editingId != null" maxlength="32" />
          <div v-if="editingId == null" class="field-hint">编码创建后不可修改</div>
        </el-form-item>
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" maxlength="32" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { categoryTree, createCategory, updateCategory, deleteCategory } from '@/api/material-category';
import type { CategoryNode } from '@mes/shared';

const tree = ref<CategoryNode[]>([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    tree.value = await categoryTree();
  } finally {
    loading.value = false;
  }
}
onMounted(load);

// ---- 表单（新增 / 编辑 / 加子级共用） ----
const formVisible = ref(false);
const saving = ref(false);
const editingId = ref<number | null>(null);
const formRef = ref<FormInstance>();
const form = reactive({ parentId: null as number | null, code: '', name: '' });
const rules: FormRules = {
  code: [
    { required: true, message: '请输入编码', trigger: 'blur' },
    { pattern: /^[A-Za-z][A-Za-z0-9_]{1,31}$/, message: '2-32 位字母开头的字母数字下划线', trigger: 'blur' },
  ],
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
};

const formTitle = computed(() => (editingId.value != null ? '编辑分类' : '新增分类'));

/** 父分类候选：编辑时排除自己与自己的后代（防止成环），后端也有防线 */
const parentOptions = computed(() => {
  const exclude = new Set<number>();
  if (editingId.value != null) collectSelfAndChildren(tree.value, editingId.value, exclude);
  const map = (nodes: CategoryNode[]): any[] =>
    nodes
      .filter((n) => !exclude.has(n.id))
      .map((n) => ({ value: n.id, label: `${n.name}（${n.code}）`, children: n.children.length ? map(n.children) : undefined }));
  return map(tree.value);
});

function collectSelfAndChildren(nodes: CategoryNode[], id: number, out: Set<number>) {
  for (const n of nodes) {
    if (n.id === id) {
      out.add(n.id);
      const walk = (children: CategoryNode[]) => children.forEach((c) => { out.add(c.id); walk(c.children); });
      walk(n.children);
      return;
    }
    collectSelfAndChildren(n.children, id, out);
  }
}

function openForm(row: CategoryNode | null, parentFixedId?: number) {
  editingId.value = row?.id ?? null;
  form.parentId = row?.parentId ?? parentFixedId ?? null;
  form.code = row?.code ?? '';
  form.name = row?.name ?? '';
  formVisible.value = true;
}

async function save() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;
  saving.value = true;
  try {
    if (editingId.value != null) {
      await updateCategory(editingId.value, { parentId: form.parentId, name: form.name });
    } else {
      await createCategory({ parentId: form.parentId, code: form.code, name: form.name });
    }
    ElMessage.success('已保存');
    formVisible.value = false;
    await load();
  } finally {
    saving.value = false;
  }
}

async function onDelete(row: CategoryNode) {
  await ElMessageBox.confirm(
    `确定删除分类「${row.name}（${row.code}）」吗？有子分类或物料的分类无法删除。`,
    '删除确认', { type: 'warning' },
  );
  await deleteCategory(row.id);
  ElMessage.success('已删除');
  await load();
}
</script>

<style scoped>
.toolbar { margin-bottom: 8px; display: flex; gap: 8px; }
.field-hint { font-size: 12px; color: #909399; line-height: 1.4; margin-top: 2px; }
</style>
