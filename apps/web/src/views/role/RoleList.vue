<template>
  <el-card>
    <div class="toolbar">
      <el-button v-permission="'role:create'" type="primary" @click="openForm()">新增角色</el-button>
      <el-button @click="load">刷新</el-button>
    </div>
    <el-table v-loading="loading" :data="rows" stripe>
      <el-table-column prop="code" label="角色编码" min-width="120" />
      <el-table-column prop="name" label="角色名称" min-width="120" />
      <el-table-column prop="remark" label="备注" min-width="160" show-overflow-tooltip />
      <el-table-column label="用户数" width="90" prop="userCount" />
      <el-table-column label="权限数" width="90" prop="permissionCount" />
      <el-table-column label="内置" width="80">
        <template #default="{ row }">
          <el-tag v-if="row.isBuiltin" size="small" type="warning">内置</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{ row }">
          <el-button v-permission="'role:assign-permission'" link type="primary" @click="openPerms(row)">权限</el-button>
          <el-button v-permission="'role:update'" link type="primary" :disabled="row.isBuiltin" @click="openForm(row)">编辑</el-button>
          <el-button v-permission="'role:delete'" link type="danger" :disabled="row.isBuiltin" @click="onDelete(row)">删除</el-button>
        </template>
      </el-table-column>
      <template #empty><el-empty description="暂无数据" /></template>
    </el-table>
  </el-card>

  <!-- 新增/编辑 -->
  <el-dialog v-model="formVisible" :title="editing ? '编辑角色' : '新增角色'" width="420px" destroy-on-close>
    <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
      <el-form-item label="角色编码" prop="code">
        <el-input v-model="form.code" :disabled="editing" maxlength="32" placeholder="小写字母数字下划线" />
      </el-form-item>
      <el-form-item label="角色名称" prop="name">
        <el-input v-model="form.name" maxlength="32" />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.remark" type="textarea" maxlength="200" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="formVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>

  <!-- 权限勾选树 -->
  <el-dialog v-model="permsVisible" :title="`设置权限：${permTarget?.name ?? ''}`" width="460px" destroy-on-close>
    <el-alert v-if="permTarget?.isBuiltin" type="warning" :closable="false" class="perm-alert"
      title="内置角色拥有全部权限且不可修改" />
    <el-tree
      v-else
      ref="treeRef"
      :data="permTree"
      :props="{ label: 'label', children: 'children' }"
      node-key="id"
      show-checkbox
      default-expand-all
      :default-checked-keys="checkedIds"
    />
    <template #footer>
      <el-button @click="permsVisible = false">取消</el-button>
      <el-button v-if="!permTarget?.isBuiltin" type="primary" :loading="saving" @click="savePerms">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { listRoles, getRole, createRole, updateRole, deleteRole, assignRolePermissions } from '@/api/role';
import { listPermissions } from '@/api/permission';
import type { RoleRow, PermissionRow } from '@mes/shared';

const rows = ref<RoleRow[]>([]);
const loading = ref(false);
const saving = ref(false);

async function load() {
  loading.value = true;
  try { rows.value = await listRoles(); } finally { loading.value = false; }
}
onMounted(load);

// ---------- 新增 / 编辑 ----------
const formVisible = ref(false);
const editing = ref<RoleRow | null>(null);
const formRef = ref<FormInstance>();
const form = reactive({ code: '', name: '', remark: '' });
const rules: FormRules = {
  code: [
    { required: true, message: '请输入角色编码', trigger: 'blur' },
    { pattern: /^[a-z][a-z0-9_]{1,31}$/, message: '2-32 位小写字母开头的字母数字下划线', trigger: 'blur' },
  ],
  name: [{ required: true, message: '请输入角色名称', trigger: 'blur' }],
};

function openForm(row?: RoleRow) {
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
    if (editing.value) await updateRole(editing.value.id, { name: form.name, remark: form.remark });
    else await createRole({ code: form.code, name: form.name, remark: form.remark });
    ElMessage.success('已保存');
    formVisible.value = false;
    await load();
  } finally { saving.value = false; }
}

async function onDelete(row: RoleRow) {
  await ElMessageBox.confirm(`确定删除角色「${row.name}」吗？`, '删除确认', { type: 'warning' });
  await deleteRole(row.id);
  ElMessage.success('已删除');
  await load();
}

// ---------- 权限勾选树 ----------
const permsVisible = ref(false);
const permTarget = ref<RoleRow | null>(null);
const treeRef = ref();
const perms = ref<PermissionRow[]>([]);

onMounted(async () => {
  try { perms.value = await listPermissions(); } catch { /* 统一提示 */ }
});

/** 按模块分组的树：模块节点（不可勾选）→ 权限码叶子 */
const permTree = computed(() => {
  const byModule = new Map<string, PermissionRow[]>();
  for (const p of perms.value) {
    if (!byModule.has(p.module)) byModule.set(p.module, []);
    byModule.get(p.module)!.push(p);
  }
  return [...byModule.entries()].map(([module, list]) => ({
    id: `module:${module}`, label: module, children: list.map((p) => ({ id: p.id, label: `${p.name}（${p.code}）` })),
  }));
});

const checkedIds = ref<number[]>([]);

async function openPerms(row: RoleRow) {
  permTarget.value = row;
  // 先取角色已有权限，再打开弹窗渲染树，保证 default-checked-keys 回显生效
  try {
    const detail = await getRole(row.id);
    checkedIds.value = detail.permissionIds;
  } catch {
    checkedIds.value = []; // 错误由 http 层统一提示
  }
  permsVisible.value = true;
}

async function savePerms() {
  if (!permTarget.value || !treeRef.value) return;
  // 只取叶子（数字 id），模块节点的 id 是字符串
  const leafIds: number[] = treeRef.value.getCheckedKeys().filter((k: unknown) => typeof k === 'number');
  saving.value = true;
  try {
    await assignRolePermissions(permTarget.value.id, leafIds);
    ElMessage.success('权限已更新');
    permsVisible.value = false;
    await load();
  } finally { saving.value = false; }
}
</script>

<style scoped>
.toolbar { margin-bottom: 12px; display: flex; gap: 8px; }
.perm-alert { margin-bottom: 12px; }
</style>
