<template>
  <ProTable :fetch="fetch" ref="tableRef" @reset="Object.assign(query, { keyword: '' })">
    <template #search>
      <el-form-item label="关键字">
        <el-input v-model="query.keyword" placeholder="用户名 / 姓名" clearable @keyup.enter="tableRef?.reload()" />
      </el-form-item>
    </template>
    <template #toolbar>
      <el-button v-permission="'user:create'" type="primary" @click="openForm()">新增用户</el-button>
    </template>
    <el-table-column prop="username" label="用户名" min-width="120" />
    <el-table-column prop="name" label="姓名" min-width="120" />
    <el-table-column label="角色" min-width="180">
      <template #default="{ row }">
        <el-tag v-for="r in row.roles" :key="r.id" size="small" class="role-tag">{{ r.name }}</el-tag>
        <span v-if="!row.roles?.length" class="muted">未分配</span>
      </template>
    </el-table-column>
    <el-table-column label="状态" width="90">
      <template #default="{ row }">
        <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">{{ row.status === 1 ? '启用' : '停用' }}</el-tag>
      </template>
    </el-table-column>
    <el-table-column label="创建时间" width="180">
      <template #default="{ row }">{{ new Date(row.createdAt).toLocaleString() }}</template>
    </el-table-column>
    <el-table-column label="操作" width="230" fixed="right">
      <template #default="{ row }">
        <el-button v-permission="'user:update'" link type="primary" @click="openForm(row)">编辑</el-button>
        <el-button v-permission="'user:assign-role'" link type="primary" @click="openRoles(row)">分配角色</el-button>
        <el-button v-permission="'user:delete'" link type="danger" @click="onDelete(row)">删除</el-button>
      </template>
    </el-table-column>
  </ProTable>

  <!-- 新增/编辑 -->
  <el-dialog v-model="formVisible" :title="editing ? '编辑用户' : '新增用户'" width="420px" destroy-on-close>
    <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
      <el-form-item label="用户名" prop="username">
        <el-input v-model="form.username" :disabled="editing" maxlength="32" />
      </el-form-item>
      <el-form-item label="姓名" prop="name">
        <el-input v-model="form.name" maxlength="32" />
      </el-form-item>
      <el-form-item :label="editing ? '重置密码' : '密码'" prop="password">
        <el-input v-model="form.password" type="password" show-password maxlength="32"
          :placeholder="editing ? '留空则不修改密码' : '8-32 位'" />
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

  <!-- 分配角色 -->
  <el-dialog v-model="rolesVisible" title="分配角色" width="420px" destroy-on-close>
    <el-select v-model="selectedRoleIds" multiple style="width: 100%" placeholder="选择角色（可多选）">
      <el-option v-for="r in allRoles" :key="r.id" :label="r.name" :value="r.id" :disabled="r.isBuiltin && r.code !== 'admin'" />
    </el-select>
    <template #footer>
      <el-button @click="rolesVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="saveRoles">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import ProTable from '@/components/ProTable.vue';
import { listUsers, createUser, updateUser, deleteUser, assignUserRoles } from '@/api/user';
import { listRoles } from '@/api/role';
import type { UserRow, RoleRow } from '@mes/shared';

const tableRef = ref<{ reload: () => void } | null>(null);
const query = reactive({ keyword: '' });
const fetch = (q: any) => listUsers({ ...q, keyword: query.keyword || undefined });

// ---------- 新增 / 编辑 ----------
const formVisible = ref(false);
const saving = ref(false);
const editing = ref<UserRow | null>(null);
const formRef = ref<FormInstance>();
const form = reactive({ username: '', name: '', password: '', status: 1 });
const rules: FormRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { pattern: /^[a-zA-Z0-9_]{2,32}$/, message: '2-32 位字母数字下划线', trigger: 'blur' },
  ],
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 8, max: 32, message: '8-32 位', trigger: 'blur' },
  ],
};

function openForm(row?: UserRow) {
  editing.value = row ?? null;
  form.username = row?.username ?? '';
  form.name = row?.name ?? '';
  form.password = '';
  form.status = row?.status ?? 1;
  formVisible.value = true;
}

async function save() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;
  saving.value = true;
  try {
    if (editing.value) {
      const data: any = { name: form.name };
      if (form.password) data.password = form.password;
      data.status = form.status;
      await updateUser(editing.value.id, data);
    } else {
      await createUser({ username: form.username, password: form.password, name: form.name });
    }
    ElMessage.success('已保存');
    formVisible.value = false;
    tableRef.value?.reload();
  } finally {
    saving.value = false;
  }
}

// ---------- 分配角色 ----------
const rolesVisible = ref(false);
const roleTarget = ref<UserRow | null>(null);
const allRoles = ref<RoleRow[]>([]);
const selectedRoleIds = ref<number[]>([]);

onMounted(async () => {
  try { allRoles.value = await listRoles(); } catch { /* 错误提示由 http 层统一处理 */ }
});

function openRoles(row: UserRow) {
  roleTarget.value = row;
  selectedRoleIds.value = row.roles.map((r) => r.id);
  rolesVisible.value = true;
}

async function saveRoles() {
  if (!roleTarget.value) return;
  saving.value = true;
  try {
    await assignUserRoles(roleTarget.value.id, selectedRoleIds.value);
    ElMessage.success('角色已更新');
    rolesVisible.value = false;
    tableRef.value?.reload();
  } finally {
    saving.value = false;
  }
}

// ---------- 删除 ----------
async function onDelete(row: UserRow) {
  await ElMessageBox.confirm(`确定删除用户「${row.name}（${row.username}）」吗？`, '删除确认', { type: 'warning' });
  await deleteUser(row.id);
  ElMessage.success('已删除');
  tableRef.value?.reload();
}
</script>

<style scoped>
.role-tag { margin-right: 4px; }
.muted { color: #9ca3af; font-size: 12px; }
</style>
