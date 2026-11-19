<template>
  <el-card>
    <div class="toolbar">
      <el-button v-permission="'menu:create'" type="primary" @click="openForm()">新增菜单</el-button>
      <el-button @click="load">刷新</el-button>
    </div>
    <el-table v-loading="loading" :data="rows" row-key="id" :tree-props="{ children: 'children' }" default-expand-all stripe>
      <el-table-column prop="name" label="名称" min-width="160" />
      <el-table-column prop="path" label="路由路径" min-width="160" />
      <el-table-column prop="component" label="组件" min-width="160" />
      <el-table-column prop="icon" label="图标" width="100" />
      <el-table-column prop="permissionCode" label="权限码" min-width="140" />
      <el-table-column prop="sort" label="排序" width="80" />
      <el-table-column label="操作" width="240" fixed="right">
        <template #default="{ row }">
          <el-button v-permission="'menu:create'" link type="primary" @click="openForm(undefined, row)">加子菜单</el-button>
          <el-button v-permission="'menu:update'" link type="primary" @click="openForm(row)">编辑</el-button>
          <el-button v-permission="'menu:delete'" link type="danger" @click="onDelete(row)">删除</el-button>
        </template>
      </el-table-column>
      <template #empty><el-empty description="暂无数据" /></template>
    </el-table>
  </el-card>

  <el-dialog v-model="visible" :title="editing ? '编辑菜单' : '新增菜单'" width="520px" destroy-on-close>
    <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
      <el-form-item label="父菜单">
        <el-tree-select v-model="form.parentId" :data="parentOptions" check-strictly clearable
          :props="{ label: 'name', value: 'id', children: 'children' }" node-key="id" style="width: 100%"
          placeholder="不选则为顶级目录" />
      </el-form-item>
      <el-form-item label="名称" prop="name">
        <el-input v-model="form.name" maxlength="32" />
      </el-form-item>
      <el-form-item label="路由路径" prop="path">
        <el-input v-model="form.path" placeholder="/system/users" />
      </el-form-item>
      <el-form-item label="组件">
        <el-input v-model="form.component" placeholder="相对 src/views，如 user/UserList；目录留空" />
      </el-form-item>
      <el-form-item label="图标">
        <el-input v-model="form.icon" placeholder="Element Plus 图标名，如 Setting" />
      </el-form-item>
      <el-form-item label="权限码">
        <el-select v-model="form.permissionCode" clearable filterable style="width: 100%"
          placeholder="目录留空；叶子选择绑定的权限码">
          <el-option v-for="p in perms" :key="p.id" :label="`${p.name}（${p.code}）`" :value="p.code" />
        </el-select>
      </el-form-item>
      <el-form-item label="排序">
        <el-input-number v-model="form.sort" :min="0" :max="9999" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { listMenus, createMenu, updateMenu, deleteMenu } from '@/api/menu';
import { listPermissions } from '@/api/permission';
import type { MenuRow, PermissionRow } from '@mes/shared';

const rows = ref<MenuRow[]>([]);
const perms = ref<PermissionRow[]>([]);
const loading = ref(false);
const saving = ref(false);

async function load() {
  loading.value = true;
  try { rows.value = await listMenus(); } finally { loading.value = false; }
}
onMounted(async () => {
  await load();
  try { perms.value = await listPermissions(); } catch { /* 统一提示 */ }
});

// ---------- 表单 ----------
const visible = ref(false);
const editing = ref<MenuRow | null>(null);
const formRef = ref<FormInstance>();
const form = reactive<{
  parentId: number | null; path: string; name: string; icon: string;
  component: string; permissionCode: string; sort: number;
}>({ parentId: null, path: '', name: '', icon: '', component: '', permissionCode: '', sort: 0 });

const rules: FormRules = {
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  path: [
    { required: true, message: '请输入路由路径', trigger: 'blur' },
    { pattern: /^\/[a-zA-Z0-9\-/]{0,98}$/, message: '以 / 开头，只含字母数字-/', trigger: 'blur' },
  ],
};

/** 父菜单候选：排除自己（防自引用，后端还会查循环） */
const parentOptions = computed(() => {
  const selfId = editing.value?.id;
  const strip = (nodes: MenuRow[]): any[] =>
    nodes.filter((n) => n.id !== selfId).map((n) => ({ ...n, children: n.children ? strip(n.children) : [] }));
  return strip(rows.value);
});

function openForm(row?: MenuRow, parent?: MenuRow) {
  editing.value = row ?? null;
  form.parentId = row?.parentId ?? parent?.id ?? null;
  form.path = row?.path ?? '';
  form.name = row?.name ?? '';
  form.icon = row?.icon ?? '';
  form.component = row?.component ?? '';
  form.permissionCode = row?.permissionCode ?? '';
  form.sort = row?.sort ?? 0;
  visible.value = true;
}

async function save() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;
  saving.value = true;
  const data = {
    parentId: form.parentId,
    path: form.path,
    name: form.name,
    icon: form.icon || null,
    component: form.component || null,
    permissionCode: form.permissionCode || null,
    sort: form.sort,
  };
  try {
    if (editing.value) await updateMenu(editing.value.id, data);
    else await createMenu(data);
    ElMessage.success('已保存');
    visible.value = false;
    await load();
  } finally { saving.value = false; }
}

async function onDelete(row: MenuRow) {
  await ElMessageBox.confirm(`确定删除菜单「${row.name}」吗？`, '删除确认', { type: 'warning' });
  await deleteMenu(row.id);
  ElMessage.success('已删除');
  await load();
}
</script>

<style scoped>
.toolbar { margin-bottom: 12px; display: flex; gap: 8px; }
</style>
