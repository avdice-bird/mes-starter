<template>
  <div>
    <el-tabs v-model="tab" @tab-change="reloadCurrent">
      <el-tab-pane label="工作中心" name="wcs">
        <ProTable :fetch="fetchWcs" ref="wcTableRef" @reset="Object.assign(wcQuery, { keyword: '' })">
          <template #search>
            <el-form-item label="关键字">
              <el-input v-model="wcQuery.keyword" placeholder="编码 / 名称" clearable maxlength="32" @keyup.enter="wcTableRef?.reload()" />
            </el-form-item>
          </template>
          <template #toolbar>
            <el-button v-permission="'work-center:create'" type="primary" @click="openWcForm()">新建工作中心</el-button>
          </template>
          <el-table-column prop="code" label="编码" min-width="110" />
          <el-table-column prop="name" label="名称" min-width="120" />
          <el-table-column label="类型" width="90">
            <template #default="{ row }">
              <el-tag :type="row.type === 'LINE' ? 'primary' : 'info'" size="small">{{ row.type === 'LINE' ? '产线' : '工位' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="dailyCapacity" label="日产能" width="90" />
          <el-table-column prop="status" label="状态" width="80">
            <template #default="{ row }">
              <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">{{ row.status === 1 ? '启用' : '停用' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="设备数" width="80">
            <template #default="{ row }">{{ row._count?.equipments ?? 0 }}</template>
          </el-table-column>
          <el-table-column label="操作" width="140" fixed="right">
            <template #default="{ row }">
              <el-button v-permission="'work-center:update'" link type="primary" @click="openWcForm(row)">编辑</el-button>
              <el-button v-permission="'work-center:delete'" link type="danger" @click="onWcDelete(row)">删除</el-button>
            </template>
          </el-table-column>
        </ProTable>
      </el-tab-pane>

      <el-tab-pane label="设备管理" name="equipments">
        <ProTable :fetch="fetchEquipments" ref="eqTableRef" @reset="Object.assign(eqQuery, { keyword: '', workCenterId: undefined })">
          <template #search>
            <el-form-item label="关键字">
              <el-input v-model="eqQuery.keyword" placeholder="编码 / 名称" clearable maxlength="32" @keyup.enter="eqTableRef?.reload()" />
            </el-form-item>
            <el-form-item label="工作中心">
              <el-select v-model="eqQuery.workCenterId" placeholder="全部" clearable style="width: 160px" @change="eqTableRef?.reload()">
                <el-option v-for="w in wcs" :key="w.id" :label="w.name" :value="w.id" />
              </el-select>
            </el-form-item>
          </template>
          <template #toolbar>
            <el-button v-permission="'equipment:create'" type="primary" @click="openEqForm()">新建设备</el-button>
          </template>
          <el-table-column prop="code" label="编码" min-width="110" />
          <el-table-column prop="name" label="名称" min-width="110" />
          <el-table-column label="所属工作中心" min-width="130">
            <template #default="{ row }">{{ row.workCenter.name }}</template>
          </el-table-column>
          <el-table-column prop="model" label="型号" min-width="100" />
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag :type="eqTag(row.status)" size="small">{{ eqText(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="140" fixed="right">
            <template #default="{ row }">
              <el-button v-permission="'equipment:update'" link type="primary" @click="openEqForm(row)">编辑/转移</el-button>
              <el-button v-permission="'equipment:delete'" link type="danger" @click="onEqDelete(row)">删除</el-button>
            </template>
          </el-table-column>
        </ProTable>
      </el-tab-pane>
    </el-tabs>

    <!-- 工作中心表单 -->
    <el-dialog v-model="wcFormVisible" :title="wcEditing ? '编辑工作中心' : '新建工作中心'" width="400px" destroy-on-close>
      <el-form ref="wcFormRef" :model="wcForm" :rules="wcRules" label-width="80px">
        <el-form-item label="编码" prop="code">
          <el-input v-model="wcForm.code" :disabled="!!wcEditing" maxlength="32" />
        </el-form-item>
        <el-form-item label="名称" prop="name">
          <el-input v-model="wcForm.name" maxlength="32" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="wcForm.type" style="width: 100%">
            <el-option label="产线" value="LINE" />
            <el-option label="工位" value="CELL" />
          </el-select>
        </el-form-item>
        <el-form-item label="日产能">
          <el-input-number v-model="wcForm.dailyCapacity" :min="0" :max="1000000" style="width: 100%" />
        </el-form-item>
        <el-form-item v-if="wcEditing" label="状态">
          <el-switch v-model="wcForm.status" :active-value="1" :inactive-value="0" active-text="启用" inactive-text="停用" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="wcFormVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveWc">保存</el-button>
      </template>
    </el-dialog>

    <!-- 设备表单 -->
    <el-dialog v-model="eqFormVisible" :title="eqEditing ? '编辑设备' : '新建设备'" width="400px" destroy-on-close>
      <el-form ref="eqFormRef" :model="eqForm" :rules="eqRules" label-width="90px">
        <el-form-item label="编码" prop="code">
          <el-input v-model="eqForm.code" :disabled="!!eqEditing" maxlength="32" />
        </el-form-item>
        <el-form-item label="名称" prop="name">
          <el-input v-model="eqForm.name" maxlength="32" />
        </el-form-item>
        <el-form-item label="工作中心" prop="workCenterId">
          <el-select v-model="eqForm.workCenterId" style="width: 100%">
            <el-option v-for="w in wcs" :key="w.id" :label="`${w.code} ${w.name}`" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="型号">
          <el-input v-model="eqForm.model" maxlength="64" />
        </el-form-item>
        <el-form-item v-if="eqEditing" label="状态">
          <el-select v-model="eqForm.status" style="width: 100%">
            <el-option label="运行中" value="RUNNING" />
            <el-option label="空闲" value="IDLE" />
            <el-option label="故障" value="FAULT" />
            <el-option label="维护中" value="MAINTENANCE" />
          </el-select>
        </el-form-item>
      </el-form>
      <div class="hint" v-if="eqEditing">转移到其他工作中心后，审计日志会记录本次变更。</div>
      <template #footer>
        <el-button @click="eqFormVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveEq">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import ProTable from '@/components/ProTable.vue';
import {
  listWorkCenters, createWorkCenter, updateWorkCenter, deleteWorkCenter,
  listEquipments, createEquipment, updateEquipment, deleteEquipment,
} from '@/api/routing';
import type { WorkCenterRow } from '@mes/shared';

const tab = ref('wcs');
const saving = ref(false);
const eqTag = (s: string) => ({ RUNNING: 'success', IDLE: 'info', FAULT: 'danger', MAINTENANCE: 'warning' }[s] ?? 'info');
const eqText = (s: string) => ({ RUNNING: '运行中', IDLE: '空闲', FAULT: '故障', MAINTENANCE: '维护中' }[s] ?? s);

// ---- 工作中心 ----
const wcTableRef = ref<{ reload: () => void } | null>(null);
const wcQuery = reactive({ keyword: '' });
const fetchWcs = (q: any) => listWorkCenters({ ...q, keyword: wcQuery.keyword || undefined });

const wcFormVisible = ref(false);
const wcEditing = ref<WorkCenterRow | null>(null);
const wcFormRef = ref<FormInstance>();
const wcForm = reactive({ code: '', name: '', type: 'LINE', dailyCapacity: 0, status: 1 });
const wcRules: FormRules = {
  code: [{ required: true, message: '请输入编码', trigger: 'blur' }],
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
};

function openWcForm(row?: WorkCenterRow) {
  wcEditing.value = row ?? null;
  wcForm.code = row?.code ?? '';
  wcForm.name = row?.name ?? '';
  wcForm.type = row?.type ?? 'LINE';
  wcForm.dailyCapacity = row?.dailyCapacity ?? 0;
  wcForm.status = row?.status ?? 1;
  wcFormVisible.value = true;
}

async function saveWc() {
  const valid = await wcFormRef.value?.validate().catch(() => false);
  if (!valid) return;
  saving.value = true;
  try {
    if (wcEditing.value) {
      await updateWorkCenter(wcEditing.value.id, { name: wcForm.name, type: wcForm.type, dailyCapacity: wcForm.dailyCapacity, status: wcForm.status });
    } else {
      await createWorkCenter({ code: wcForm.code, name: wcForm.name, type: wcForm.type, dailyCapacity: wcForm.dailyCapacity });
    }
    ElMessage.success('已保存');
    wcFormVisible.value = false;
    wcTableRef.value?.reload();
  } finally {
    saving.value = false;
  }
}

async function onWcDelete(row: WorkCenterRow) {
  await ElMessageBox.confirm(`确定删除工作中心「${row.name}」吗？有设备或被工序引用时会被拒绝。`, '删除确认', { type: 'warning' });
  await deleteWorkCenter(row.id);
  ElMessage.success('已删除');
  wcTableRef.value?.reload();
}

// ---- 设备 ----
const eqTableRef = ref<{ reload: () => void } | null>(null);
const eqQuery = reactive({ keyword: '', workCenterId: undefined as number | undefined });
const fetchEquipments = (q: any) => listEquipments({ ...q, keyword: eqQuery.keyword || undefined, workCenterId: eqQuery.workCenterId || undefined });

const eqFormVisible = ref(false);
const eqEditing = ref<any | null>(null);
const eqFormRef = ref<FormInstance>();
const eqForm = reactive({ code: '', name: '', workCenterId: undefined as number | undefined, model: '', status: 'IDLE' });
const eqRules: FormRules = {
  code: [{ required: true, message: '请输入编码', trigger: 'blur' }],
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  workCenterId: [{ required: true, message: '请选择工作中心', trigger: 'change' }],
};
const wcs = ref<WorkCenterRow[]>([]);

async function openEqForm(row?: any) {
  eqEditing.value = row ?? null;
  eqForm.code = row?.code ?? '';
  eqForm.name = row?.name ?? '';
  eqForm.workCenterId = row?.workCenterId ?? wcs.value[0]?.id;
  eqForm.model = row?.model ?? '';
  eqForm.status = row?.status ?? 'IDLE';
  eqFormVisible.value = true;
}

async function saveEq() {
  const valid = await eqFormRef.value?.validate().catch(() => false);
  if (!valid) return;
  saving.value = true;
  try {
    if (eqEditing.value) {
      await updateEquipment(eqEditing.value.id, { name: eqForm.name, workCenterId: eqForm.workCenterId, model: eqForm.model, status: eqForm.status });
    } else {
      await createEquipment({ code: eqForm.code, name: eqForm.name, workCenterId: eqForm.workCenterId!, model: eqForm.model || undefined });
    }
    ElMessage.success('已保存');
    eqFormVisible.value = false;
    eqTableRef.value?.reload();
  } finally {
    saving.value = false;
  }
}

async function onEqDelete(row: any) {
  await ElMessageBox.confirm(`确定删除设备「${row.name}」吗？`, '删除确认', { type: 'warning' });
  await deleteEquipment(row.id);
  ElMessage.success('已删除');
  eqTableRef.value?.reload();
}

function reloadCurrent() {
  if (tab.value === 'wcs') wcTableRef.value?.reload();
  else eqTableRef.value?.reload();
}

onMounted(async () => {
  const r = await listWorkCenters({ page: 1, pageSize: 100 }).catch(() => ({ list: [] }));
  wcs.value = r.list;
});
</script>

<style scoped>
.hint { font-size: 12px; color: #909399; margin-top: 6px; }
</style>
