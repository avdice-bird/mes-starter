<template>
  <div>
    <el-tabs v-model="tab">
      <el-tab-pane label="工艺路线" name="routings">
        <ProTable :fetch="fetchRoutings" ref="routingTableRef" @reset="Object.assign(rq, { keyword: '', status: '' })">
          <template #search>
            <el-form-item label="关键字">
              <el-input v-model="rq.keyword" placeholder="物料编码 / 名称 / 版本" clearable maxlength="64" @keyup.enter="routingTableRef?.reload()" />
            </el-form-item>
            <el-form-item label="状态">
              <el-select v-model="rq.status" placeholder="全部" clearable style="width: 130px">
                <el-option label="草稿" value="DRAFT" />
                <el-option label="生效" value="ACTIVE" />
                <el-option label="已废弃" value="OBSOLETE" />
              </el-select>
            </el-form-item>
          </template>
          <template #toolbar>
            <el-button v-permission="'routing:create'" type="primary" @click="openRoutingForm()">新建路线</el-button>
          </template>
          <el-table-column label="父物料" min-width="170">
            <template #default="{ row }">
              <span class="mono">{{ row.material.code }}</span><span class="muted">{{ row.material.name }}</span>
            </template>
          </el-table-column>
          <!-- 版本号最长 16 字符：170 宽足够完整显示，仍保留省略兜底 -->
          <el-table-column prop="version" label="版本" width="170" show-overflow-tooltip />
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag :type="statusTag(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="工序数" width="80">
            <template #default="{ row }">{{ row._count?.operations ?? row.operationCount ?? 0 }}</template>
          </el-table-column>
          <el-table-column label="操作" width="330" fixed="right">
            <template #default="{ row }">
              <el-button v-permission="'routing:update'" link type="primary" @click="openOps(row)">工序</el-button>
              <el-button v-if="row.status !== 'ACTIVE'" v-permission="'routing:activate'" link type="success" @click="onActivate(row)">激活</el-button>
              <el-button v-permission="'routing:create'" link type="primary" @click="onCopy(row)">复制新版本</el-button>
              <el-button v-if="row.status !== 'ACTIVE'" v-permission="'routing:delete'" link type="danger" @click="onDelete(row)">删除</el-button>
            </template>
          </el-table-column>
        </ProTable>
      </el-tab-pane>

      <el-tab-pane label="工作中心" name="wcs">
        <ProTable :fetch="fetchWcs">
          <template #toolbar>
            <el-button v-permission="'work-center:create'" type="primary" @click="wcFormVisible = true">新建工作中心</el-button>
          </template>
          <el-table-column prop="code" label="编码" min-width="110" />
          <el-table-column prop="name" label="名称" min-width="120" />
          <el-table-column label="类型" width="90">
            <template #default="{ row }">{{ row.type === 'LINE' ? '产线' : '工位' }}</template>
          </el-table-column>
          <el-table-column prop="dailyCapacity" label="日产能" width="90" />
          <el-table-column label="设备数" width="80">
            <template #default="{ row }">{{ row._count?.equipments ?? 0 }}</template>
          </el-table-column>
          <el-table-column label="操作" width="160" fixed="right">
            <template #default="{ row }">
              <el-button v-permission="'work-center:update'" link type="primary" @click="openWcEdit(row)">编辑</el-button>
              <el-button v-permission="'work-center:delete'" link type="danger" @click="onWcDelete(row)">删除</el-button>
            </template>
          </el-table-column>
        </ProTable>
      </el-tab-pane>

      <el-tab-pane label="设备管理" name="equipments">
        <ProTable :fetch="fetchEquipments" @reset="Object.assign(eqQuery, { workCenterId: undefined })">
          <template #search>
            <el-form-item label="工作中心">
              <el-select v-model="eqQuery.workCenterId" placeholder="全部" clearable style="width: 160px">
                <el-option v-for="w in allWcs" :key="w.id" :label="w.name" :value="w.id" />
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
          <el-table-column label="操作" width="170" fixed="right">
            <template #default="{ row }">
              <el-button v-permission="'equipment:update'" link type="primary" @click="openEqEdit(row)">编辑/转移</el-button>
              <el-button v-permission="'equipment:delete'" link type="danger" @click="onEqDelete(row)">删除</el-button>
            </template>
          </el-table-column>
        </ProTable>
      </el-tab-pane>
    </el-tabs>

    <!-- 新建路线 -->
    <el-dialog v-model="routingFormVisible" title="新建工艺路线" width="420px" destroy-on-close>
      <el-form ref="routingFormRef" :model="routingForm" :rules="routingRules" label-width="80px">
        <el-form-item label="父物料" prop="materialId">
          <el-select v-model="routingForm.materialId" filterable remote :remote-method="searchMaterial" :loading="materialLoading" placeholder="搜索物料" style="width: 100%">
            <el-option v-for="m in materialOptions" :key="m.id" :label="`${m.code} ${m.name}`" :value="m.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="版本" prop="version">
          <el-input v-model="routingForm.version" maxlength="16" placeholder="如 v1" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="routingFormVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveRouting">保存</el-button>
      </template>
    </el-dialog>

    <!-- 工序编辑 -->
    <el-drawer v-model="opsVisible" :title="`工序维护 · ${opsRouting?.material.name ?? ''} ${opsRouting?.version ?? ''}`" size="720px" destroy-on-close>
      <el-table :data="opsRows" size="small">
        <el-table-column label="seq" width="90">
          <template #default="{ row }"><el-input-number v-model="row.seq" :min="1" :max="999" size="small" controls-position="right" style="width: 100%" /></template>
        </el-table-column>
        <el-table-column label="编码" width="100">
          <template #default="{ row }"><el-input v-model="row.code" maxlength="32" size="small" /></template>
        </el-table-column>
        <el-table-column label="名称" min-width="110">
          <template #default="{ row }"><el-input v-model="row.name" maxlength="64" size="small" /></template>
        </el-table-column>
        <el-table-column label="工作中心" min-width="150">
          <template #default="{ row }">
            <el-select v-model="row.workCenterId" size="small" style="width: 100%">
              <el-option v-for="w in allWcs" :key="w.id" :label="`${w.code} ${w.name}`" :value="w.id" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="标准工时(分)" width="120">
          <template #default="{ row }"><el-input-number v-model="row.standardMinutes" :min="1" :max="100000" size="small" controls-position="right" style="width: 100%" /></template>
        </el-table-column>
        <el-table-column label="质检点" width="70">
          <template #default="{ row }"><el-switch v-model="row.isInspectionPoint" size="small" /></template>
        </el-table-column>
        <el-table-column label="SOP" width="120">
          <template #default="{ row }">
            <template v-if="row.id">
              <el-button v-permission="'attachment:upload'" link type="primary" size="small" @click="openSopUpload(row)">上传</el-button>
              <el-button v-if="(row._sopCount ?? 0) > 0" v-permission="'attachment:download'" link size="small" @click="openSopList(row)">SOP({{ row._sopCount }})</el-button>
            </template>
            <span v-else class="muted" style="font-size: 11px">先保存</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="60">
          <template #default="{ $index }">
            <el-button link type="danger" @click="opsRows.splice($index, 1)">删</el-button>
          </template>
        </el-table-column>
      </el-table>
      <!-- SOP 附件（第 55 节）：refType=ROUTING_OPERATION -->
      <el-dialog v-model="sopUploadVisible" title="上传 SOP（pdf/png/jpg，≤10MB）" width="420px">
        <input ref="sopFileRef" type="file" accept=".pdf,.png,.jpg,.jpeg" style="display:block" />
        <div v-if="sopError" class="muted" style="color:#f56c6c; margin-top:8px">{{ sopError }}</div>
        <template #footer>
          <el-button @click="sopUploadVisible = false">取消</el-button>
          <el-button type="primary" :loading="sopUploading" @click="submitSop">上传</el-button>
        </template>
      </el-dialog>
      <el-dialog v-model="sopListVisible" title="工序 SOP 附件" width="480px">
        <div v-for="a in sopList" :key="a.id" class="sop-item">
          <span class="sop-name">{{ a.fileName }}</span>
          <span class="muted" style="font-size:11px">{{ Math.round(a.size / 1024) }}KB · {{ a.uploadedBy }}</span>
          <el-button v-permission="'attachment:download'" link type="primary" size="small" @click="previewSop(a)">预览/下载</el-button>
        </div>
        <el-empty v-if="!sopList.length" description="暂无附件" :image-size="50" />
      </el-dialog>
      <div class="ops-toolbar">
        <el-button size="small" @click="addOpRow">加一行</el-button>
        <el-button size="small" @click="moveOp(-1)">上移</el-button>
        <el-button size="small" @click="moveOp(1)">下移</el-button>
        <el-button v-permission="'routing:update'" type="primary" size="small" :loading="saving" :disabled="opsRouting?.status === 'ACTIVE'" @click="saveOpsClick">保存工序</el-button>
        <span v-if="opsRouting?.status === 'ACTIVE'" class="muted">ACTIVE 版本只读，请复制新版本</span>
      </div>
    </el-drawer>

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
            <el-option v-for="w in allWcs" :key="w.id" :label="`${w.code} ${w.name}`" :value="w.id" />
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
      <template #footer>
        <el-button @click="eqFormVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveEq">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { listAttachments, uploadAttachment, attachmentDownloadUrl, type AttachmentRow } from '@/api/labels';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import ProTable from '@/components/ProTable.vue';
import {
  listRoutings, getRouting, createRouting, saveOperations, reorderOperations, activateRouting, copyRouting, deleteRouting,
  listWorkCenters, createWorkCenter, updateWorkCenter, deleteWorkCenter,
  listEquipments, createEquipment, updateEquipment, deleteEquipment,
} from '@/api/routing';
import type { WorkCenterRow, RoutingRow } from '@mes/shared';

const tab = ref('routings');
const saving = ref(false);
const statusTag = (s: string) => ({ DRAFT: 'info', ACTIVE: 'success', OBSOLETE: 'danger' }[s] ?? 'info');
const statusText = (s: string) => ({ DRAFT: '草稿', ACTIVE: '生效', OBSOLETE: '已废弃' }[s] ?? s);
const eqTag = (s: string) => ({ RUNNING: 'success', IDLE: 'info', FAULT: 'danger', MAINTENANCE: 'warning' }[s] ?? 'info');
const eqText = (s: string) => ({ RUNNING: '运行中', IDLE: '空闲', FAULT: '故障', MAINTENANCE: '维护中' }[s] ?? s);

// ---- 工艺路线 ----
const routingTableRef = ref<{ reload: () => void } | null>(null);
const rq = reactive({ keyword: '', status: '' });
const fetchRoutings = (q: any) => listRoutings({ ...q, keyword: rq.keyword || undefined, status: rq.status || undefined });

const routingFormVisible = ref(false);
const routingFormRef = ref<FormInstance>();
const routingForm = reactive({ materialId: undefined as number | undefined, version: 'v1' });
const routingRules: FormRules = {
  materialId: [{ required: true, message: '请选择父物料', trigger: 'change' }],
  version: [{ required: true, message: '请输入版本', trigger: 'blur' }],
};
const materialOptions = ref<{ id: number; code: string; name: string }[]>([]);
const materialLoading = ref(false);
async function searchMaterial(kw: string) {
  materialLoading.value = true;
  try {
    const { listMaterials } = await import('@/api/material');
    const r = await listMaterials({ page: 1, pageSize: 20, keyword: kw || undefined });
    materialOptions.value = r.list.map((m) => ({ id: m.id, code: m.code, name: m.name }));
  } finally {
    materialLoading.value = false;
  }
}

async function openRoutingForm() {
  routingForm.materialId = undefined;
  routingForm.version = 'v1';
  await searchMaterial('');
  routingFormVisible.value = true;
}

async function saveRouting() {
  const valid = await routingFormRef.value?.validate().catch(() => false);
  if (!valid) return;
  saving.value = true;
  try {
    const created = await createRouting({ materialId: routingForm.materialId!, version: routingForm.version });
    ElMessage.success('已创建，接下来维护工序');
    routingFormVisible.value = false;
    routingTableRef.value?.reload();
    await openOps(created as unknown as RoutingRow);
  } finally {
    saving.value = false;
  }
}

// ---- 工序编辑 ----
const opsVisible = ref(false);
const opsRouting = ref<RoutingRow | null>(null);
const opsRows = ref<any[]>([]);
const allWcs = ref<WorkCenterRow[]>([]);

async function loadWcs() {
  const r = await listWorkCenters({ page: 1, pageSize: 100 });
  allWcs.value = r.list;
}

async function openOps(row: RoutingRow) {
  opsRouting.value = row;
  opsVisible.value = true;
  const detail = await getRouting(row.id);
  opsRows.value = detail.operations.map((o) => ({ ...o }));
  await loadWcs();
  await refreshSopCounts();
}

// ---- SOP 附件（第 55 节）：refType=ROUTING_OPERATION；已保存工序才有 id 可挂 ----
const sopUploadVisible = ref(false);
const sopUploading = ref(false);
const sopFileRef = ref<HTMLInputElement>();
const sopError = ref('');
const sopListVisible = ref(false);
const sopList = ref<AttachmentRow[]>([]);
let sopTarget: { id: number; label: string } | null = null;

async function refreshSopCounts() {
  for (const row of opsRows.value) {
    if (!row.id) { row._sopCount = 0; continue; }
    try {
      row._sopCount = (await listAttachments('ROUTING_OPERATION', row.id)).length;
    } catch { row._sopCount = 0; }
  }
}

function openSopUpload(row: { id?: number; name?: string }) {
  if (!row.id) return;
  sopTarget = { id: row.id, label: row.name ?? '' };
  sopError.value = '';
  if (sopFileRef.value) sopFileRef.value.value = '';
  sopUploadVisible.value = true;
}

async function submitSop() {
  const file = sopFileRef.value?.files?.[0];
  if (!file || !sopTarget) return;
  sopUploading.value = true;
  sopError.value = '';
  try {
    await uploadAttachment(file, 'ROUTING_OPERATION', sopTarget.id);
    ElMessage.success('SOP 已上传');
    sopUploadVisible.value = false;
    await refreshSopCounts();
  } catch (e) {
    const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
    sopError.value = msg ?? '上传失败（限 pdf/png/jpg，≤10MB）';
  } finally {
    sopUploading.value = false;
  }
}

async function openSopList(row: { id?: number; name?: string }) {
  if (!row.id) return;
  sopList.value = await listAttachments('ROUTING_OPERATION', row.id);
  sopListVisible.value = true;
}

function previewSop(a: AttachmentRow) {
  window.open(attachmentDownloadUrl(a.id), '_blank');
}

function addOpRow() {
  const maxSeq = Math.max(0, ...opsRows.value.map((r) => r.seq));
  opsRows.value.push({ seq: maxSeq + 10, code: `OP${maxSeq + 10}`, name: '', workCenterId: allWcs.value[0]?.id, standardMinutes: 1, isInspectionPoint: false, allowSkip: false });
}

function moveOp(dir: number) {
  // 简化：对选中最后一行做上移/下移占位——实际用行索引；这里用最近编辑行不可行，改为整表按 seq 排序保存
  opsRows.value.sort((a, b) => (a.seq - b.seq) * dir);
}

async function saveOpsClick() {
  if (!opsRouting.value) return;
  const payload = opsRows.value
    .filter((r) => r.code && r.name && r.workCenterId)
    .sort((a, b) => a.seq - b.seq);
  if (!payload.length) return ElMessage.warning('至少一行有效工序');
  saving.value = true;
  try {
    await saveOperations(opsRouting.value.id, payload.map((r) => ({
      seq: r.seq, code: r.code, name: r.name, workCenterId: r.workCenterId,
      standardMinutes: r.standardMinutes, isInspectionPoint: r.isInspectionPoint, allowSkip: r.allowSkip,
    })));
    // 保存后按返回顺序做一次连续重排（把 seq 重写成 10/20/30），同时验证重排接口
    const detail = await getRouting(opsRouting.value.id);
    if (detail.operations.length > 1) {
      await reorderOperations(opsRouting.value.id, detail.operations.map((o) => o.id));
    }
    ElMessage.success('工序已保存');
    routingTableRef.value?.reload();
  } finally {
    saving.value = false;
  }
}

async function onActivate(row: RoutingRow) {
  await ElMessageBox.confirm(`激活 ${row.version} 后，该物料其他生效路线将自动废弃。确定吗？`, '激活确认', { type: 'warning' });
  await activateRouting(row.id);
  ElMessage.success('已激活');
  routingTableRef.value?.reload();
}

async function onCopy(row: RoutingRow) {
  const { value } = await ElMessageBox.prompt('新版本号', '复制为新版本', { inputValue: `${row.version}-copy` });
  await copyRouting(row.id, value);
  ElMessage.success('已复制（DRAFT）');
  routingTableRef.value?.reload();
}

async function onDelete(row: RoutingRow) {
  await ElMessageBox.confirm(`确定删除路线 ${row.version} 吗？`, '删除确认', { type: 'warning' });
  await deleteRouting(row.id);
  ElMessage.success('已删除');
  routingTableRef.value?.reload();
}

// ---- 工作中心 ----
const wcFormVisible = ref(false);
const wcEditing = ref<WorkCenterRow | null>(null);
const wcFormRef = ref<FormInstance>();
const wcForm = reactive({ code: '', name: '', type: 'LINE', dailyCapacity: 0 });
const wcRules: FormRules = {
  code: [{ required: true, message: '请输入编码', trigger: 'blur' }],
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
};
const fetchWcs = (q: any) => listWorkCenters(q);

function openWcEdit(row: WorkCenterRow) {
  wcEditing.value = row;
  wcForm.code = row.code;
  wcForm.name = row.name;
  wcForm.type = row.type;
  wcForm.dailyCapacity = row.dailyCapacity;
  wcFormVisible.value = true;
}

async function saveWc() {
  const valid = await wcFormRef.value?.validate().catch(() => false);
  if (!valid) return;
  saving.value = true;
  try {
    if (wcEditing.value) {
      await updateWorkCenter(wcEditing.value.id, { name: wcForm.name, type: wcForm.type, dailyCapacity: wcForm.dailyCapacity });
    } else {
      await createWorkCenter({ ...wcForm });
    }
    ElMessage.success('已保存');
    wcFormVisible.value = false;
  } finally {
    saving.value = false;
  }
}

async function onWcDelete(row: WorkCenterRow) {
  await ElMessageBox.confirm(`确定删除工作中心「${row.name}」吗？`, '删除确认', { type: 'warning' });
  await deleteWorkCenter(row.id);
  ElMessage.success('已删除');
}

// ---- 设备 ----
const eqQuery = reactive({ workCenterId: undefined as number | undefined });
const eqFormVisible = ref(false);
const eqEditing = ref<any | null>(null);
const eqFormRef = ref<FormInstance>();
const eqForm = reactive({ code: '', name: '', workCenterId: undefined as number | undefined, model: '', status: 'IDLE' });
const eqRules: FormRules = {
  code: [{ required: true, message: '请输入编码', trigger: 'blur' }],
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  workCenterId: [{ required: true, message: '请选择工作中心', trigger: 'change' }],
};
const fetchEquipments = (q: any) => listEquipments({ ...q, workCenterId: eqQuery.workCenterId || undefined });

async function openEqForm() {
  eqEditing.value = null;
  eqForm.code = ''; eqForm.name = ''; eqForm.workCenterId = allWcs.value[0]?.id; eqForm.model = ''; eqForm.status = 'IDLE';
  await loadWcs();
  eqFormVisible.value = true;
}

async function openEqEdit(row: any) {
  eqEditing.value = row;
  eqForm.code = row.code; eqForm.name = row.name; eqForm.workCenterId = row.workCenterId;
  eqForm.model = row.model ?? ''; eqForm.status = row.status;
  await loadWcs();
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
  } finally {
    saving.value = false;
  }
}

async function onEqDelete(row: any) {
  await ElMessageBox.confirm(`确定删除设备「${row.name}」吗？`, '删除确认', { type: 'warning' });
  await deleteEquipment(row.id);
  ElMessage.success('已删除');
}

onMounted(() => loadWcs());
</script>

<style scoped>
.mono { font-family: Consolas, monospace; font-size: 12px; margin-right: 6px; }
.muted { color: #909399; font-size: 12px; margin-left: 6px; }
.ops-toolbar { margin-top: 10px; display: flex; gap: 8px; align-items: center; }
</style>
