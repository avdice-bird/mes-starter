<template>
  <div>
    <el-tabs v-model="tab">
      <el-tab-pane label="班次" name="shifts">
        <div class="toolbar">
          <el-button v-permission="'shift:create'" type="primary" @click="openShiftForm()">新建班次</el-button>
          <el-card shadow="never" class="now-shift">
            <span>当前班次（工厂时区）：</span>
            <el-tag v-if="currentShift" type="success">{{ currentShift.name }}（{{ currentShift.startTime }}–{{ currentShift.endTime }}）</el-tag>
            <el-tag v-else type="info">无班次覆盖（空档）</el-tag>
          </el-card>
        </div>
        <el-table :data="shifts" v-loading="shiftLoading" size="small">
          <el-table-column prop="code" label="编码" width="110" />
          <el-table-column prop="name" label="名称" min-width="110" />
          <el-table-column label="时间" width="140">
            <template #default="{ row }">{{ row.startTime }} – {{ row.endTime }}</template>
          </el-table-column>
          <el-table-column label="跨天" width="80">
            <template #default="{ row }">
              <el-tag v-if="row.crossDay" type="warning" size="small">跨天</el-tag>
              <span v-else>—</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="140" fixed="right">
            <template #default="{ row }">
              <el-button v-permission="'shift:update'" link type="primary" @click="openShiftForm(row)">编辑</el-button>
              <el-button v-permission="'shift:delete'" link type="danger" @click="onDeleteShift(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="班组" name="teams">
        <div class="toolbar">
          <el-button v-permission="'team:create'" type="primary" @click="openTeamForm()">新建班组</el-button>
        </div>
        <el-table :data="teams" v-loading="teamLoading" size="small">
          <el-table-column prop="code" label="编码" width="110" />
          <el-table-column prop="name" label="名称" min-width="110" />
          <el-table-column label="工作中心" min-width="130">
            <template #default="{ row }">{{ row.workCenter.name }}</template>
          </el-table-column>
          <el-table-column label="组长" width="110">
            <template #default="{ row }">{{ row.leader?.name ?? '未指定' }}</template>
          </el-table-column>
          <el-table-column label="人数" width="80">
            <template #default="{ row }">{{ row._count?.employees ?? 0 }}</template>
          </el-table-column>
          <el-table-column label="操作" width="140" fixed="right">
            <template #default="{ row }">
              <el-button v-permission="'team:update'" link type="primary" @click="openTeamForm(row)">编辑</el-button>
              <el-button v-permission="'team:delete'" link type="danger" @click="onDeleteTeam(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="员工" name="employees">
        <div class="toolbar">
          <el-button v-permission="'employee:create'" type="primary" @click="openEmpForm()">新建员工</el-button>
          <el-select v-model="empStatus" style="width: 120px" @change="loadEmployees">
            <el-option label="在职" value="ACTIVE" />
            <el-option label="已离职" value="LEFT" />
            <el-option label="全部" value="" />
          </el-select>
        </div>
        <el-table :data="employees" v-loading="empLoading" size="small">
          <el-table-column prop="code" label="工号" width="100" />
          <el-table-column prop="name" label="姓名" min-width="100" />
          <el-table-column label="班组" min-width="110">
            <template #default="{ row }">{{ row.team.name }}</template>
          </el-table-column>
          <el-table-column label="关联用户" min-width="110">
            <template #default="{ row }">{{ row.user?.username ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="技能" min-width="150">
            <template #default="{ row }">
              <el-tag v-for="s in row.skills" :key="s.id" size="small" class="skill-tag">
                {{ s.opCode ?? `WC#${s.workCenterId}` }}·L{{ s.level }}
              </el-tag>
              <span v-if="!row.skills?.length" class="muted">无</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="row.status === 'ACTIVE' ? 'success' : 'info'" size="small">{{ row.status === 'ACTIVE' ? '在职' : '已离职' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="260" fixed="right">
            <template #default="{ row }">
              <el-button v-permission="'employee:update'" link type="primary" @click="openEmpForm(row)">编辑</el-button>
              <el-button v-permission="'employee:update'" link type="primary" @click="onTransfer(row)">调组</el-button>
              <el-button v-if="row.status === 'ACTIVE'" v-permission="'employee:update'" link type="warning" @click="onLeave(row)">离职</el-button>
              <el-button v-else v-permission="'employee:update'" link type="success" @click="onRehire(row)">再入职</el-button>
              <el-button v-permission="'employee:view'" link type="primary" @click="onTransfers(row)">调组历史</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <!-- 班次表单 -->
    <el-dialog v-model="shiftFormVisible" :title="shiftEditing ? '编辑班次' : '新建班次'" width="400px" destroy-on-close>
      <el-form ref="shiftFormRef" :model="shiftForm" :rules="shiftRules" label-width="80px">
        <el-form-item label="编码" prop="code">
          <el-input v-model="shiftForm.code" :disabled="!!shiftEditing" maxlength="32" />
        </el-form-item>
        <el-form-item label="名称" prop="name">
          <el-input v-model="shiftForm.name" maxlength="32" />
        </el-form-item>
        <el-form-item label="开始时间" prop="startTime">
          <el-time-select v-model="shiftForm.startTime" start="00:00" step="00:30" end="23:30" style="width: 100%" />
        </el-form-item>
        <el-form-item label="结束时间" prop="endTime">
          <el-time-select v-model="shiftForm.endTime" start="00:00" step="00:30" end="23:30" style="width: 100%" />
        </el-form-item>
        <div class="hint">跨天班次（结束 ≤ 开始，如 00:00–08:00 的晚班）自动识别；班次之间不允许时间重叠</div>
      </el-form>
      <template #footer>
        <el-button @click="shiftFormVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveShift">保存</el-button>
      </template>
    </el-dialog>

    <!-- 班组表单 -->
    <el-dialog v-model="teamFormVisible" :title="teamEditing ? '编辑班组' : '新建班组'" width="400px" destroy-on-close>
      <el-form ref="teamFormRef" :model="teamForm" :rules="teamRules" label-width="90px">
        <el-form-item label="编码" prop="code">
          <el-input v-model="teamForm.code" :disabled="!!teamEditing" maxlength="32" />
        </el-form-item>
        <el-form-item label="名称" prop="name">
          <el-input v-model="teamForm.name" maxlength="32" />
        </el-form-item>
        <el-form-item label="工作中心" prop="workCenterId">
          <el-select v-model="teamForm.workCenterId" style="width: 100%">
            <el-option v-for="w in wcs" :key="w.id" :label="`${w.code} ${w.name}`" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="组长">
          <el-select v-model="teamForm.leaderId" clearable style="width: 100%" placeholder="可空；必须属于本班组">
            <el-option v-for="e in activeEmployees" :key="e.id" :label="`${e.code} ${e.name}`" :value="e.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="teamFormVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveTeam">保存</el-button>
      </template>
    </el-dialog>

    <!-- 员工表单 -->
    <el-dialog v-model="empFormVisible" :title="empEditing ? '编辑员工' : '新建员工'" width="480px" destroy-on-close>
      <el-form ref="empFormRef" :model="empForm" :rules="empRules" label-width="90px">
        <el-form-item label="工号" prop="code">
          <el-input v-model="empForm.code" :disabled="!!empEditing" maxlength="32" />
        </el-form-item>
        <el-form-item label="姓名" prop="name">
          <el-input v-model="empForm.name" maxlength="32" />
        </el-form-item>
        <el-form-item label="班组" prop="teamId">
          <el-select v-model="empForm.teamId" style="width: 100%">
            <el-option v-for="t in teams" :key="t.id" :label="`${t.code} ${t.name}`" :value="t.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="关联用户">
          <el-select v-model="empForm.userId" clearable filterable style="width: 100%" placeholder="可选：不登录系统的操作工留空">
            <el-option v-for="u in users" :key="u.id" :label="u.username" :value="u.id" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="empEditing" label="技能">
          <div v-for="(s, i) in empSkills" :key="i" class="skill-row">
            <el-input v-model="s.opCode" placeholder="工序编码如 OP10" maxlength="32" style="width: 140px" />
            <el-input-number v-model="s.level" :min="1" :max="5" size="small" controls-position="right" />
            <el-button link type="danger" @click="empSkills.splice(i, 1)">删</el-button>
          </div>
          <el-button size="small" @click="empSkills.push({ opCode: '', level: 1 })">加技能</el-button>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="empFormVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveEmp">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import {
  listShifts, getCurrentShift, createShift, updateShift, deleteShift,
  listTeams, createTeam, updateTeam, deleteTeam,
  listEmployees, createEmployee, updateEmployee, transferEmployee, getTransfers,
  leaveEmployee, rehireEmployee, setSkills,
} from '@/api/team';
import { listWorkCenters } from '@/api/routing';
import { listUsers } from '@/api/user';
import type { ShiftRow, TeamRow, EmployeeRow } from '@mes/shared';

const tab = ref('shifts');
const saving = ref(false);

// ---- 班次 ----
const shifts = ref<ShiftRow[]>([]);
const shiftLoading = ref(false);
const currentShift = ref<ShiftRow | null>(null);
const shiftFormVisible = ref(false);
const shiftEditing = ref<ShiftRow | null>(null);
const shiftFormRef = ref<FormInstance>();
const shiftForm = reactive({ code: '', name: '', startTime: '08:00', endTime: '16:00' });
const shiftRules: FormRules = {
  code: [{ required: true, message: '请输入编码', trigger: 'blur' }],
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  startTime: [{ required: true, message: '请选择开始时间', trigger: 'change' }],
  endTime: [{ required: true, message: '请选择结束时间', trigger: 'change' }],
};

async function loadShifts() {
  shiftLoading.value = true;
  try {
    shifts.value = (await listShifts()).list;
    currentShift.value = (await getCurrentShift()).shift;
  } finally {
    shiftLoading.value = false;
  }
}

function openShiftForm(row?: ShiftRow) {
  shiftEditing.value = row ?? null;
  shiftForm.code = row?.code ?? '';
  shiftForm.name = row?.name ?? '';
  shiftForm.startTime = row?.startTime ?? '08:00';
  shiftForm.endTime = row?.endTime ?? '16:00';
  shiftFormVisible.value = true;
}

async function saveShift() {
  const valid = await shiftFormRef.value?.validate().catch(() => false);
  if (!valid) return;
  saving.value = true;
  try {
    if (shiftEditing.value) await updateShift(shiftEditing.value.id, { name: shiftForm.name, startTime: shiftForm.startTime, endTime: shiftForm.endTime });
    else await createShift({ ...shiftForm });
    ElMessage.success('已保存');
    shiftFormVisible.value = false;
    await loadShifts();
  } finally {
    saving.value = false;
  }
}

async function onDeleteShift(row: ShiftRow) {
  await ElMessageBox.confirm(`确定删除班次「${row.name}」吗？`, '删除确认', { type: 'warning' });
  await deleteShift(row.id);
  ElMessage.success('已删除');
  await loadShifts();
}

// ---- 班组 / 员工 ----
const teams = ref<TeamRow[]>([]);
const teamLoading = ref(false);
const wcs = ref<{ id: number; code: string; name: string }[]>([]);
const teamFormVisible = ref(false);
const teamEditing = ref<TeamRow | null>(null);
const teamFormRef = ref<FormInstance>();
const teamForm = reactive({ code: '', name: '', workCenterId: undefined as number | undefined, leaderId: undefined as number | undefined });
const teamRules: FormRules = {
  code: [{ required: true, message: '请输入编码', trigger: 'blur' }],
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  workCenterId: [{ required: true, message: '请选择工作中心', trigger: 'change' }],
};

const employees = ref<EmployeeRow[]>([]);
const empLoading = ref(false);
const empStatus = ref('ACTIVE');
const empFormVisible = ref(false);
const empEditing = ref<EmployeeRow | null>(null);
const empFormRef = ref<FormInstance>();
const empForm = reactive({ code: '', name: '', teamId: undefined as number | undefined, userId: undefined as number | undefined });
const empSkills = ref<{ opCode: string; level: number }[]>([]);
const empRules: FormRules = {
  code: [{ required: true, message: '请输入工号', trigger: 'blur' }],
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  teamId: [{ required: true, message: '请选择班组', trigger: 'change' }],
};
const users = ref<{ id: number; username: string }[]>([]);
const activeEmployees = ref<EmployeeRow[]>([]);

async function loadTeams() {
  teamLoading.value = true;
  try {
    teams.value = (await listTeams()).list;
  } finally {
    teamLoading.value = false;
  }
}

async function loadEmployees() {
  empLoading.value = true;
  try {
    employees.value = (await listEmployees({ status: empStatus.value || undefined, pageSize: 100 })).list;
  } finally {
    empLoading.value = false;
  }
}

function openTeamForm(row?: TeamRow) {
  teamEditing.value = row ?? null;
  teamForm.code = row?.code ?? '';
  teamForm.name = row?.name ?? '';
  teamForm.workCenterId = row?.workCenterId;
  teamForm.leaderId = row?.leaderId ?? undefined;
  teamFormVisible.value = true;
}

async function saveTeam() {
  const valid = await teamFormRef.value?.validate().catch(() => false);
  if (!valid) return;
  saving.value = true;
  try {
    if (teamEditing.value) await updateTeam(teamEditing.value.id, { name: teamForm.name, workCenterId: teamForm.workCenterId, leaderId: teamForm.leaderId });
    else await createTeam({ code: teamForm.code, name: teamForm.name, workCenterId: teamForm.workCenterId!, leaderId: teamForm.leaderId });
    ElMessage.success('已保存');
    teamFormVisible.value = false;
    await loadTeams();
  } finally {
    saving.value = false;
  }
}

async function onDeleteTeam(row: TeamRow) {
  await ElMessageBox.confirm(`确定删除班组「${row.name}」吗？`, '删除确认', { type: 'warning' });
  await deleteTeam(row.id);
  ElMessage.success('已删除');
  await loadTeams();
}

async function openEmpForm(row?: EmployeeRow) {
  empEditing.value = row ?? null;
  empForm.code = row?.code ?? '';
  empForm.name = row?.name ?? '';
  empForm.teamId = row?.teamId;
  empForm.userId = row?.userId ?? undefined;
  empSkills.value = row?.skills.map((s) => ({ opCode: s.opCode ?? '', level: s.level })) ?? [];
  const [u, e] = await Promise.all([listUsers({ page: 1, pageSize: 100 }), listEmployees({ status: 'ACTIVE', pageSize: 100 })]);
  users.value = u.list;
  activeEmployees.value = e.list;
  empFormVisible.value = true;
}

async function saveEmp() {
  const valid = await empFormRef.value?.validate().catch(() => false);
  if (!valid) return;
  saving.value = true;
  try {
    if (empEditing.value) {
      await updateEmployee(empEditing.value.id, { name: empForm.name, teamId: empForm.teamId, userId: empForm.userId ?? undefined });
      if (empSkills.value.length) {
        await setSkills(empEditing.value.id, empSkills.value.filter((s) => s.opCode).map((s) => ({ opCode: s.opCode, level: s.level })));
      }
    } else {
      await createEmployee({ code: empForm.code, name: empForm.name, teamId: empForm.teamId!, userId: empForm.userId ?? undefined });
    }
    ElMessage.success('已保存');
    empFormVisible.value = false;
    await loadEmployees();
  } finally {
    saving.value = false;
  }
}

async function onTransfer(row: EmployeeRow) {
  const { value } = await ElMessageBox.prompt('目标班组 id（从班组页查看）', '调组', { inputValue: String(row.teamId) });
  const toTeamId = Number(value);
  if (!toTeamId) return;
  await transferEmployee(row.id, toTeamId);
  ElMessage.success('已调组');
  await loadEmployees();
}

async function onTransfers(row: EmployeeRow) {
  const list = await getTransfers(row.id);
  ElMessageBox.alert(
    list.length
      ? list.map((t) => `${t.at.slice(0, 10)}：${t.fromTeam.name} → ${t.toTeam.name}`).join('<br/>')
      : '无调组记录',
    `${row.name} 的调组历史`,
    { dangerouslyUseHTMLString: true },
  );
}

async function onLeave(row: EmployeeRow) {
  await ElMessageBox.confirm(`确定给「${row.name}」办理离职吗？历史报工不受影响。`, '离职确认', { type: 'warning' });
  await leaveEmployee(row.id);
  ElMessage.success('已离职');
  await loadEmployees();
}

async function onRehire(row: EmployeeRow) {
  await rehireEmployee(row.id);
  ElMessage.success('已恢复在职（工号不变）');
  await loadEmployees();
}

onMounted(async () => {
  await Promise.all([loadShifts(), loadTeams(), loadEmployees()]);
  const r = await listWorkCenters({ page: 1, pageSize: 100 }).catch(() => ({ list: [] }));
  wcs.value = r.list;
});
</script>

<style scoped>
.toolbar { display: flex; gap: 10px; align-items: center; margin-bottom: 10px; }
.now-shift { flex: 1; }
.hint { font-size: 12px; color: #909399; line-height: 1.5; margin-left: 80px; }
.skill-tag { margin-right: 4px; }
.skill-row { display: flex; gap: 6px; align-items: center; margin-bottom: 4px; }
.muted { color: #909399; font-size: 12px; }
</style>
