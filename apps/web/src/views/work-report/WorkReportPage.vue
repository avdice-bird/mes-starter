<template>
  <div class="report-page">
    <el-card>
      <template v-if="!located">
        <h3>扫码 / 输入工单编码</h3>
        <el-form inline @submit.prevent="locate">
          <el-form-item>
            <el-input v-model="codeInput" placeholder="如 PO-2026-001-W01" clearable size="large" style="width: 260px" @keyup.enter="locate" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" size="large" :loading="locating" @click="locate">定位工单</el-button>
          </el-form-item>
        </el-form>
        <div v-if="error" class="error">{{ error }}</div>
      </template>

      <template v-else>
        <div class="wo-head">
          <div>
            <div class="wo-code">{{ wo?.code }}</div>
            <div class="wo-name">{{ wo?.material.name }} · 计划 {{ wo?.qty }}</div>
          </div>
          <div>
            <el-button link @click="reset">换工单</el-button>
            <!-- 拉灯（第 50 节）：大、红、显眼——发现异常第一时间呼叫 -->
            <el-button type="danger" size="large" class="andon-btn" :loading="andonLoading" @click="andonDialog = true">
              拉灯呼叫
            </el-button>
          </div>
        </div>

        <h4>可报任务</h4>
        <div v-for="op in operations" :key="op.id" class="op-card">
          <div class="op-line">
            <span class="op-name">{{ op.seq }}. {{ op.operationName }}</span>
            <el-button
              v-if="sopOf[op.id]?.length" link type="primary" size="small"
              data-testid="sop-btn" @click="openSop(op.id)"
            >查看 SOP（{{ sopOf[op.id]!.length }}）</el-button>
            <el-tag :type="op.status === 'IN_PROGRESS' ? 'primary' : 'warning'" size="small">
              {{ op.status === 'IN_PROGRESS' ? '进行中' : '待开工' }}
            </el-tag>
          </div>
          <div class="op-line qty-line">
            <span>完成 {{ op.completedQty }}/{{ op.plannedQty }}</span>
            <span v-if="op.defectQty" class="defect">不良 {{ op.defectQty }}</span>
          </div>
          <el-form v-if="op.status === 'IN_PROGRESS' && forms[op.id]" class="report-form">
            <div class="field-row">
              <label>员工</label>
              <el-select v-model="forms[op.id]!.employeeId" filterable placeholder="选择报工员工" size="large" style="width: 220px">
                <el-option v-for="e in employeesOf(op)" :key="e.id" :label="`${e.code} ${e.name}`" :value="e.id" />
              </el-select>
            </div>
            <div class="field-row">
              <label>良品</label>
              <el-input-number v-model="forms[op.id]!.goodQty" :min="0" :max="10000000" size="large" />
            </div>
            <div class="field-row">
              <label>不良</label>
              <el-input-number v-model="forms[op.id]!.defectQty" :min="0" :max="10000000" size="large" />
            </div>
            <div class="field-row">
              <label>工时(分)</label>
              <el-input-number v-model="forms[op.id]!.workMinutes" :min="0" :max="1440" size="large" />
            </div>
            <el-button type="primary" size="large" class="submit-btn" :loading="forms[op.id]?.loading" @click="submit(op)">
              提交报工
            </el-button>
          </el-form>
        </div>
        <el-empty v-if="!operations.length" description="该工单没有可报的任务" />
      </template>
    </el-card>

    <!-- 拉灯对话框（第 50 节）：类型 + 描述 → 创建安灯呼叫 -->
    <el-dialog v-model="andonDialog" title="安灯呼叫" width="420px">
      <el-form label-width="80px">
        <el-form-item label="呼叫类型">
          <el-select v-model="andonForm.type" style="width: 100%">
            <el-option label="缺料" value="MATERIAL" />
            <el-option label="设备异常" value="EQUIPMENT" />
            <el-option label="质量问题" value="QUALITY" />
            <el-option label="其他" value="OTHER" />
          </el-select>
        </el-form-item>
        <el-form-item label="问题描述">
          <el-input v-model="andonForm.description" type="textarea" :rows="3" maxlength="200" show-word-limit placeholder="发生了什么（必填）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="andonDialog = false">取消</el-button>
        <el-button type="danger" :loading="andonLoading" @click="submitAndon">立即呼叫</el-button>
      </template>
    </el-dialog>

    <!-- SOP 预览（第 55 节）：pdf 内嵌 / 图片直显；附件在路线工序上，任务按 routingId+operationCode 继承 -->
    <el-dialog v-model="sopVisible" :title="`SOP · ${sopTitle}`" width="720px" destroy-on-close>
      <div v-for="a in sopCurrent" :key="a.id" class="sop-attachment">
        <div class="sop-head">
          <span>{{ a.fileName }}（{{ Math.round(a.size / 1024) }}KB）</span>
          <el-button link type="primary" size="small" @click="windowOpen(attachmentDownloadUrl(a.id))">新窗口打开</el-button>
        </div>
        <iframe v-if="a.mimeType === 'application/pdf'" :src="attachmentDownloadUrl(a.id)" class="sop-frame" />
        <img v-else-if="a.mimeType.startsWith('image/')" :src="attachmentDownloadUrl(a.id)" class="sop-img" :alt="a.fileName" />
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useRoute } from 'vue-router';
import {
  getWorkOrderByCode, createWorkReport, type WorkOrderRow, type WorkOrderOperationRow,
} from '@/api/schedule';
import { listEmployees } from '@/api/team';
import { useUserStore } from '@/stores/user';

/** 报工页（第 37 节）：窄屏友好——大按钮、大输入；每张工单打开时生成一个幂等键前缀 */
const userStore = useUserStore();
const route = useRoute();
const locating = ref(false);
const located = ref(false);
const error = ref('');
const codeInput = ref('');
const wo = ref<WorkOrderRow | null>(null);
const operations = ref<WorkOrderOperationRow[]>([]);
const forms = reactive<Record<number, { employeeId?: number; goodQty: number; defectQty: number; workMinutes: number; loading: boolean; keys: string[] }>>({});
/** 员工候选（按任务派工班组过滤；后端校验员工必须属于派工班组） */
const employees = ref<{ id: number; code: string; name: string; teamId: number; status: string }[]>([]);
let keySeq = 0;

function employeesOf(op: WorkOrderOperationRow) {
  return employees.value.filter((e) => (op.teamId ? e.teamId === op.teamId : true) && e.status === 'ACTIVE');
}

function newKey(): string {
  keySeq += 1;
  return `pad-${Date.now()}-${keySeq}-${Math.random().toString(36).slice(2, 8)}`;
}

async function locate() {
  const code = codeInput.value.trim().replace(/^wo:/, '');
  if (!code) return;
  locating.value = true;
  error.value = '';
  try {
    const r = await getWorkOrderByCode(code);
    wo.value = r.workOrder;
    operations.value = r.operations;
    void loadSops(r.workOrder.routingId, r.operations);
    for (const op of r.operations) {
      forms[op.id] = { goodQty: 0, defectQty: 0, workMinutes: 0, loading: false, keys: [newKey()] };
    }
    if (employees.value.length === 0) {
      // 拉一次在职员工做报工候选（失败降级为空，提交时会被后端 404 拦下并提示）
      const emps = await listEmployees({ page: 1, pageSize: 200, status: 'ACTIVE' }).catch(() => ({ list: [] }));
      employees.value = emps.list;
    }
    located.value = true;
  } catch {
    error.value = `工单 ${code} 不存在或无法访问`;
  } finally {
    locating.value = false;
  }
}

function reset() {
  located.value = false;
  wo.value = null;
  operations.value = [];
  codeInput.value = '';
}

async function submit(op: WorkOrderOperationRow) {
  const f = forms[op.id];
  if (!f || f.goodQty + f.defectQty <= 0) {
    ElMessage.warning('良品 + 不良必须大于 0');
    return;
  }
  if (!f.employeeId) {
    ElMessage.warning('请选择报工员工');
    return;
  }
  f.loading = true;
  try {
    // 幂等键：打开表单时生成；提交失败保留同 key 重试，成功后换新 key（第 38 节用例 15）
    await createWorkReport({
      workOrderOperationId: op.id,
      employeeId: f.employeeId,
      goodQty: f.goodQty,
      defectQty: f.defectQty,
      workMinutes: f.workMinutes,
      idempotencyKey: f.keys[0],
    });
    ElMessage.success('报工成功');
    f.keys.shift();
    f.keys.push(newKey());
    f.goodQty = 0; f.defectQty = 0; f.workMinutes = 0;
    const r = await getWorkOrderByCode(wo.value!.code);
    operations.value = r.operations;
  } catch {
    /* 拦截器已提示；幂等 key 不换、数量不清零，可直接原样重试 */
  } finally {
    f.loading = false;
  }
}

// 扫码进入：/report?wo=code
if (route.query.wo) {
  codeInput.value = String(route.query.wo);
  void locate();
}

/** SOP 查看（第 55 节）：任务继承路线工序附件（routingId + operationCode 定位 RoutingOperation） */
const sopOf = reactive<Record<number, AttachmentRow[]>>({});
const sopVisible = ref(false);
const sopCurrent = ref<AttachmentRow[]>([]);
const sopTitle = ref('');

async function loadSops(routingId: number | null | undefined, ops: WorkOrderOperationRow[]) {
  if (!routingId) return;
  // SOP 是可选能力：没有路线/附件权限的角色直接跳过，避免 403 提示
  if (!userStore.has('routing:view') || !userStore.has('attachment:download')) return;
  try {
    const { getRouting } = await import('@/api/routing');
    const detail = await getRouting(routingId);
    for (const op of ops) {
      const ro = (detail.operations ?? []).find((x: { code: string }) => x.code === op.operationCode);
      if (ro) sopOf[op.id] = await listAttachments('ROUTING_OPERATION', ro.id);
    }
  } catch { /* 无权限/无附件静默 */ }
}

const windowOpen = (url: string) => window.open(url, '_blank');

function openSop(opId: number) {
  sopCurrent.value = sopOf[opId] ?? [];
  const op = operations.value.find((o) => o.id === opId);
  sopTitle.value = op ? `${op.seq}. ${op.operationName}` : '';
  sopVisible.value = true;
}

/** 拉灯（第 50 节）：定位的工单 → 默认带工单上下文创建安灯呼叫 */
import { createAndonCall } from '@/api/andon';
import { listAttachments, attachmentDownloadUrl, type AttachmentRow } from '@/api/labels';
const andonDialog = ref(false);
const andonLoading = ref(false);
const andonForm = reactive({ type: 'EQUIPMENT', description: '' });

async function submitAndon() {
  if (!wo.value) return;
  if (andonForm.description.trim().length < 2) {
    ElMessage.warning('请填写问题描述');
    return;
  }
  andonLoading.value = true;
  try {
    const op = operations.value.find((o) => o.status === 'IN_PROGRESS');
    const r = await createAndonCall({
      type: andonForm.type,
      workCenterId: op?.workCenterId ?? 0,
      workOrderId: wo.value.id,
      workOrderOperationId: op?.id,
      description: andonForm.description.trim(),
    });
    ElMessage.success(r.merged ? `已合并到未关闭呼叫 ${r.code}（不重复通知）` : `呼叫成功 ${r.code}，责任角色已收到通知`);
    andonDialog.value = false;
    andonForm.description = '';
  } catch {
    /* 拦截器已提示；弹窗保持打开，描述不丢 */
  } finally {
    andonLoading.value = false;
  }
}
</script>

<style scoped>
.report-page { max-width: 560px; margin: 0 auto; }
.error { color: #f56c6c; margin-top: 8px; }
.wo-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.wo-code { font-size: 20px; font-weight: 600; }
.wo-name { color: #666; font-size: 13px; }
.op-card { border: 1px solid #eee; border-radius: 8px; padding: 12px; margin-bottom: 12px; }
.op-line { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.op-name { font-weight: 600; }
.qty-line { color: #666; font-size: 13px; }
.defect { color: #f56c6c; }
.report-form { margin-top: 8px; }
.field-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.field-row label { width: 64px; text-align: right; color: #666; }
.submit-btn { width: 100%; height: 48px; font-size: 16px; }
.andon-btn { height: 48px; font-size: 18px; font-weight: 700; letter-spacing: 2px; }
.sop-attachment { margin-bottom: 12px; }
.sop-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; font-size: 13px; }
.sop-frame { width: 100%; height: 480px; border: 1px solid #eee; }
.sop-img { max-width: 100%; max-height: 480px; display: block; margin: 0 auto; }
h4 { margin: 14px 0 8px; }
</style>
