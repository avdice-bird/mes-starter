<template>
  <div>
    <el-tabs v-model="tab" @tab-change="reloadCurrent">
      <el-tab-pane label="检验单" name="inspections">
        <ProTable :fetch="fetchInspections" ref="inspTableRef" @reset="Object.assign(inspQuery, { result: '' })">
          <template #search>
            <el-form-item label="结论">
              <el-select v-model="inspQuery.result" placeholder="全部" clearable style="width: 140px" @change="inspTableRef?.reload()">
                <el-option label="待检" value="PENDING" />
                <el-option label="合格" value="PASS" />
                <el-option label="不合格" value="FAIL" />
                <el-option label="让步接收" value="CONCESSION" />
              </el-select>
            </el-form-item>
          </template>
          <template #toolbar>
            <el-button v-permission="'inspection:create'" type="primary" @click="createVisible = true">新建检验单</el-button>
          </template>
          <el-table-column prop="code" label="检验单号" min-width="120" />
          <el-table-column label="类型" width="90">
            <template #default="{ row }">
              <el-tag :type="({ IQC: 'info', IPQC: 'primary', FQC: 'success' } as Record<string, any>)[row.type]" size="small">{{ row.type }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="关联对象" min-width="130">
            <template #default="{ row }">{{ row.refType }}#{{ row.refId }}</template>
          </el-table-column>
          <el-table-column label="抽样/合格/不良" width="140">
            <template #default="{ row }">{{ row.sampleQty }} / {{ row.passQty }} / {{ row.failQty }}</template>
          </el-table-column>
          <el-table-column label="结论" width="100">
            <template #default="{ row }">
              <el-tag :type="resultTag(row.result)" size="small">{{ resultText[row.result] ?? row.result }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="处理" width="100">
            <template #default="{ row }">{{ dispositionText[row.disposition] ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="操作" width="110" fixed="right">
            <template #default="{ row }">
              <el-button v-permission="'inspection:submit'" link type="primary" :disabled="row.result !== 'PENDING'" @click="openSubmit(row)">检验</el-button>
              <el-button v-permission="'inspection:disposition'" link type="warning" :disabled="row.result !== 'FAIL' || !!row.disposition" @click="openDisposition(row)">处理</el-button>
            </template>
          </el-table-column>
        </ProTable>
      </el-tab-pane>

      <el-tab-pane label="缺陷代码" name="defects">
        <ProTable :fetch="fetchDefects" ref="dcTableRef">
          <template #toolbar>
            <el-button v-permission="'defect-code:create'" type="primary" @click="dcVisible = true">新建缺陷代码</el-button>
          </template>
          <el-table-column prop="code" label="代码" min-width="110" />
          <el-table-column prop="name" label="名称" min-width="120" />
          <el-table-column prop="category" label="分类" width="90" />
          <el-table-column label="严重度" width="100">
            <template #default="{ row }">
              <el-tag :type="({ CRITICAL: 'danger', MAJOR: 'warning', MINOR: 'info' } as Record<string, any>)[row.severity]" size="small">{{ row.severity }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="80">
            <template #default="{ row }">
              <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">{{ row.status === 1 ? '启用' : '停用' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="140" fixed="right">
            <template #default="{ row }">
              <el-button v-permission="'defect-code:create'" link type="primary" @click="toggleDc(row)">{{ row.status === 1 ? '停用' : '启用' }}</el-button>
            </template>
          </el-table-column>
        </ProTable>
      </el-tab-pane>
    </el-tabs>

    <!-- 新建检验单 -->
    <el-dialog v-model="createVisible" title="新建检验单" width="420px" destroy-on-close>
      <el-form label-width="90px">
        <el-form-item label="类型">
          <el-select v-model="createForm.type" style="width: 100%">
            <el-option label="IQC 来料" value="IQC" />
            <el-option label="IPQC 过程" value="IPQC" />
            <el-option label="FQC 成品" value="FQC" />
          </el-select>
        </el-form-item>
        <el-form-item label="关联对象">
          <el-select v-model="createForm.refType" style="width: 120px">
            <el-option label="批次" value="LOT" />
            <el-option label="工序任务" value="OPERATION" />
            <el-option label="工单" value="WORK_ORDER" />
          </el-select>
          <el-input-number v-model="createForm.refId" :min="1" style="width: 130px; margin-left: 8px" placeholder="id" />
        </el-form-item>
        <el-form-item label="抽样数量">
          <el-input-number v-model="createForm.sampleQty" :min="0" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" @click="saveCreate">创建</el-button>
      </template>
    </el-dialog>

    <!-- 检验表单（缺陷多行录入） -->
    <el-dialog v-model="submitVisible" :title="`检验：${editing?.code ?? ''}`" width="560px" destroy-on-close>
      <el-form label-width="90px">
        <el-form-item label="合格 / 不良">
          <el-input-number v-model="submitForm.passQty" :min="0" style="width: 130px" />
          <span class="sep">/</span>
          <el-input-number v-model="submitForm.failQty" :min="0" style="width: 130px" />
          <span class="sep">抽样 {{ editing?.sampleQty }}</span>
        </el-form-item>
        <el-form-item v-for="(d, i) in submitForm.defects" :key="i" :label="`缺陷 ${i + 1}`">
          <el-select v-model="d.defectCodeId" filterable placeholder="缺陷代码" style="width: 200px">
            <el-option v-for="dc in activeDefectCodes" :key="dc.id" :label="`${dc.code} ${dc.name}`" :value="dc.id" />
          </el-select>
          <el-input-number v-model="d.qty" :min="1" style="width: 120px; margin-left: 8px" />
          <el-button link type="danger" @click="submitForm.defects.splice(i, 1)">移除</el-button>
        </el-form-item>
        <el-form-item>
          <el-button link type="primary" @click="submitForm.defects.push({ defectCodeId: 0, qty: 1 })">+ 加缺陷</el-button>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="submitVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="doSubmit">提交结论</el-button>
      </template>
    </el-dialog>

    <!-- 不合格处理 -->
    <el-dialog v-model="dispVisible" :title="`不合格处理：${editing?.code ?? ''}`" width="400px" destroy-on-close>
      <el-form label-width="90px">
        <el-form-item label="处理方式">
          <el-select v-model="dispForm.disposition" style="width: 100%">
            <el-option label="返工" value="REWORK" />
            <el-option label="报废" value="SCRAP" />
            <el-option v-permission="'inspection:concession'" label="让步接收" value="CONCESSION" />
          </el-select>
        </el-form-item>
        <el-form-item label="原因">
          <el-input v-model="dispForm.reason" type="textarea" maxlength="200" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dispVisible = false">取消</el-button>
        <el-button type="primary" @click="doDisposition">确认</el-button>
      </template>
    </el-dialog>

    <!-- 新建缺陷代码 -->
    <el-dialog v-model="dcVisible" title="新建缺陷代码" width="420px" destroy-on-close>
      <el-form label-width="80px">
        <el-form-item label="代码" required>
          <el-input v-model="dcForm.code" maxlength="30" placeholder="如 WELD" />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="dcForm.name" maxlength="50" placeholder="如 焊接不良" />
        </el-form-item>
        <el-form-item label="分类">
          <el-input v-model="dcForm.category" maxlength="20" placeholder="外观 / 尺寸 / 功能" />
        </el-form-item>
        <el-form-item label="严重度">
          <el-select v-model="dcForm.severity" style="width: 100%">
            <el-option label="轻微" value="MINOR" />
            <el-option label="严重" value="MAJOR" />
            <el-option label="致命" value="CRITICAL" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dcVisible = false">取消</el-button>
        <el-button type="primary" :loading="dcSaving" @click="submitDefectCode">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import ProTable from '@/components/ProTable.vue';
import {
  listInspections, createInspection, submitInspection, dispositionInspection,
  listDefectCodes, createDefectCode, updateDefectCode, type InspectionRow, type DefectCodeRow,
} from '@/api/schedule';
import type { PageQuery } from '@mes/shared';

const tab = ref('inspections');
const saving = ref(false);
const inspTableRef = ref();
const dcTableRef = ref();
const inspQuery = reactive({ result: '' });
const fetchInspections = (q: PageQuery) => listInspections({ ...q, result: inspQuery.result || undefined });
const fetchDefects = (q: PageQuery) => listDefectCodes({ ...q, pageSize: 100 });
const activeDefectCodes = ref<DefectCodeRow[]>([]);

const resultText: Record<string, string> = { PENDING: '待检', PASS: '合格', FAIL: '不合格', CONCESSION: '让步接收' };
const resultTag = (r: string) => ({ PENDING: 'info', PASS: 'success', FAIL: 'danger', CONCESSION: 'warning' }[r] ?? 'info');
const dispositionText: Record<string, string> = { REWORK: '返工', SCRAP: '报废', CONCESSION: '让步接收' };

// 新建
const createVisible = ref(false);
const createForm = reactive({ type: 'FQC', refType: 'LOT', refId: 1, sampleQty: 10 });

async function saveCreate() {
  await createInspection({ ...createForm });
  ElMessage.success('已创建');
  createVisible.value = false;
  inspTableRef.value?.reload();
}

// 检验
const submitVisible = ref(false);
const editing = ref<InspectionRow | null>(null);
const submitForm = reactive<{ passQty: number; failQty: number; defects: { defectCodeId: number; qty: number }[] }>({ passQty: 0, failQty: 0, defects: [] });

function openSubmit(row: InspectionRow) {
  editing.value = row;
  submitForm.passQty = 0;
  submitForm.failQty = 0;
  submitForm.defects = [];
  submitVisible.value = true;
}

async function doSubmit() {
  if (!editing.value) return;
  saving.value = true;
  try {
    const defects = submitForm.defects.filter((d) => d.defectCodeId > 0);
    await submitInspection(editing.value.id, {
      passQty: submitForm.passQty, failQty: submitForm.failQty, defects,
    });
    ElMessage.success('已提交');
    submitVisible.value = false;
    inspTableRef.value?.reload();
  } finally { saving.value = false; }
}

// 处理
const dispVisible = ref(false);
const dispForm = reactive({ disposition: 'REWORK', reason: '' });

function openDisposition(row: InspectionRow) {
  editing.value = row;
  dispForm.disposition = 'REWORK';
  dispForm.reason = '';
  dispVisible.value = true;
}

async function doDisposition() {
  if (!editing.value) return;
  await dispositionInspection(editing.value.id, { ...dispForm });
  ElMessage.success('已处理');
  dispVisible.value = false;
  inspTableRef.value?.reload();
}

// 缺陷代码
const dcVisible = ref(false);
const dcSaving = ref(false);
const dcForm = reactive({ code: '', name: '', category: '外观', severity: 'MINOR' });

async function submitDefectCode() {
  if (!dcForm.code.trim() || !dcForm.name.trim()) {
    ElMessage.warning('代码和名称必填');
    return;
  }
  dcSaving.value = true;
  try {
    await createDefectCode({
      code: dcForm.code.trim(),
      name: dcForm.name.trim(),
      category: dcForm.category.trim() || '其他',
      severity: dcForm.severity,
    });
    ElMessage.success('已创建');
    dcVisible.value = false;
    dcForm.code = '';
    dcForm.name = '';
    dcForm.category = '外观';
    dcForm.severity = 'MINOR';
    dcTableRef.value?.reload();
  } catch {
    /* 拦截器已提示；弹窗保持打开，输入不丢 */
  } finally {
    dcSaving.value = false;
  }
}

async function toggleDc(row: DefectCodeRow) {
  await updateDefectCode(row.id, { status: row.status === 1 ? 0 : 1 });
  dcTableRef.value?.reload();
}

function reloadCurrent() {
  if (tab.value === 'inspections') inspTableRef.value?.reload();
  else dcTableRef.value?.reload();
}

onMounted(async () => {
  const r = await listDefectCodes({ status: 1, pageSize: 100 }).catch(() => null);
  if (r) activeDefectCodes.value = r.list;
});
</script>

<style scoped>
.sep { margin: 0 8px; color: #999; }
</style>
