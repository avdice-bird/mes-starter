<template>
  <div class="page detail-page">
    <van-nav-bar title="工单详情" left-arrow @click-left="router.back()">
      <template #right>
        <van-icon name="replay" size="20" @click="load" />
      </template>
    </van-nav-bar>

    <div v-if="detail" class="page-body detail-body">
      <!-- 概览 -->
      <div class="card head-card">
        <div class="flex-between">
          <span class="wo-code mono">{{ detail.code }}</span>
          <van-tag :type="status.type" size="medium">{{ status.text }}</van-tag>
        </div>
        <div class="material">{{ detail.material.name }}</div>
        <div class="muted mono">{{ detail.material.code }}</div>

        <div class="progress-wrap">
          <div class="flex-between">
            <span class="muted">完成进度</span>
            <span class="strong">{{ fmtQty(detail.completedQty) }} / {{ fmtQty(detail.qty) }}</span>
          </div>
          <van-progress
            :percentage="pct(detail.completedQty, detail.qty)"
            :show-pivot="false"
            :color="detail.isDelayed ? '#e5484d' : '#1f4e8c'"
            track-color="#eef1f6"
            stroke-width="8"
          />
        </div>

        <div class="divider" />

        <div class="row">
          <span class="row-label">生产订单</span>
          <span class="row-value mono">{{ detail.productionOrder?.code ?? '—' }}</span>
        </div>
        <div class="row">
          <span class="row-label">工作中心</span>
          <span class="row-value">{{ detail.workCenter?.name ?? '未排产' }}</span>
        </div>
        <div class="row">
          <span class="row-label">计划开始</span>
          <span class="row-value">{{ formatDateTime(detail.plannedStart, true) }}</span>
        </div>
        <div class="row">
          <span class="row-label">计划结束</span>
          <span class="row-value">
            {{ formatDateTime(detail.plannedEnd, true) }}
            <van-tag v-if="detail.isDelayed" type="danger" class="ml-6">延误</van-tag>
          </span>
        </div>
        <div class="row">
          <span class="row-label">交期</span>
          <span class="row-value">{{ formatDate(detail.productionOrder?.dueDate) }}</span>
        </div>
      </div>

      <!-- 状态操作 -->
      <div v-if="actions.length" class="card">
        <div class="accent-bar strong">工单操作</div>
        <div class="action-grid">
          <van-button
            v-for="a in actions"
            :key="a.key"
            :type="a.meta.type"
            size="small"
            :plain="a.key === 'close' || a.key === 'cancel'"
            :loading="busyAction === a.key"
            @click="onAction(a.key)"
          >{{ a.meta.text }}</van-button>
        </div>
      </div>

      <!-- 工序任务 -->
      <div class="section-title">
        <span>工序任务</span>
        <span class="more">{{ operations.length }} 道</span>
      </div>
      <div v-if="operations.length" class="card op-card">
        <div v-for="op in operations" :key="op.id" class="op-item">
          <div class="op-seq" :class="`is-${OP_STATUS[op.status]?.type ?? 'default'}`">{{ op.seq }}</div>
          <div class="op-main">
            <div class="flex-between">
              <span class="op-name">{{ op.operationName }}</span>
              <van-tag :type="OP_STATUS[op.status]?.type ?? 'default'" size="medium">
                {{ OP_STATUS[op.status]?.text ?? op.status }}
              </van-tag>
            </div>
            <div class="muted op-sub">
              {{ op.workCenter?.name }}
              <template v-if="op.isInspectionPoint"> · <span class="text-warning">质检点</span></template>
              <template v-if="op.skipped"> · 已跳过</template>
            </div>
            <div class="muted op-sub">
              <van-icon name="friends-o" /> {{ op.team?.name ?? '未派班组' }}
              <van-icon name="user-o" class="ml-8" /> {{ op.employee?.name ?? '未派员工' }}
              <template v-if="op.equipment"> · {{ op.equipment.name }}</template>
            </div>
            <div class="flex-between op-qty">
              <span class="muted">完成 {{ fmtQty(op.completedQty) }} / {{ fmtQty(op.plannedQty) }}</span>
              <span v-if="op.defectQty" class="text-danger">不良 {{ fmtQty(op.defectQty) }}</span>
            </div>
            <van-button
              v-if="op.status === 'READY' && can('work-order-operation:start')"
              type="primary"
              size="small"
              plain
              class="op-start"
              :loading="startingOp === op.id"
              @click="onStartOp(op.id)"
            >开工</van-button>
          </div>
        </div>
      </div>
      <div v-else class="card muted">暂无工序任务，请在 Web 端完成工单下达与派工</div>

      <!-- 报工记录 -->
      <template v-if="can('work-report:view')">
        <div class="section-title">
          <span>报工记录</span>
          <span class="more">{{ reports.length }} 条</span>
        </div>
        <div v-if="reports.length" class="card">
          <div v-for="r in reports.slice(0, 10)" :key="r.id" class="report-item">
            <div class="avatar">{{ (r.employee?.name || '?').slice(0, 1) }}</div>
            <div class="report-main">
              <div class="report-title">
                {{ r.employee?.name }}
                <span class="muted">· {{ r.operation ? `${r.operation.seq}. ${r.operation.operationName}` : '报工' }}</span>
              </div>
              <div class="muted">
                {{ formatDateTime(r.reportedAt) }}
                <template v-if="r.reversedById"> · <span class="text-danger">已冲销</span></template>
              </div>
            </div>
            <div class="report-qty">
              <span class="text-success">+{{ r.goodQty }}</span>
              <span v-if="r.defectQty" class="text-danger"> / {{ r.defectQty }}</span>
            </div>
          </div>
        </div>
        <div v-else class="card muted">暂无报工记录</div>
      </template>

      <!-- 状态日志 -->
      <div v-if="detail.logs?.length" class="section-title">
        <span>状态流转</span>
      </div>
      <van-collapse v-if="detail.logs?.length" v-model="openLogs" class="log-collapse">
        <van-collapse-item title="展开查看状态变更记录" name="logs">
          <div v-for="log in detail.logs" :key="log.id" class="log-item">
            <div class="log-dot" />
            <div class="log-main">
              <div class="log-title">
                {{ log.action }}：{{ WORK_ORDER_STATUS[log.fromStatus]?.text ?? log.fromStatus }}
                → {{ WORK_ORDER_STATUS[log.toStatus]?.text ?? log.toStatus }}
              </div>
              <div class="muted">
                {{ log.operatorName }} · {{ formatDateTime(log.createdAt, true) }}
              </div>
              <div v-if="log.reason" class="log-reason">{{ log.reason }}</div>
            </div>
          </div>
        </van-collapse-item>
      </van-collapse>
    </div>

    <van-loading v-else class="page-loading" vertical>加载中…</van-loading>

    <!-- 底部操作条 -->
    <div v-if="detail" class="bottom-bar safe-bottom">
      <van-button
        v-if="can('andon:create')"
        type="danger"
        plain
        icon="bulb-o"
        class="bottom-btn"
        @click="goAndon"
      >拉灯</van-button>
      <van-button
        v-if="can('work-report:create')"
        type="primary"
        icon="edit"
        class="bottom-btn bottom-btn--main"
        @click="goReport"
      >去报工</van-button>
    </div>

    <!-- 需要填写原因的操作 -->
    <van-dialog
      v-model:show="reasonDialog.show"
      :title="reasonDialog.title"
      show-cancel-button
      confirm-button-text="确认"
      :before-close="beforeReasonClose"
    >
      <div class="reason-body">
        <van-field
          v-model="reasonDialog.text"
          type="textarea"
          rows="3"
          maxlength="200"
          show-word-limit
          :placeholder="reasonDialog.placeholder"
        />
      </div>
    </van-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showSuccessToast, showToast } from '@/utils/toast';
import {
  getWorkOrderDetail,
  listWorkOrderOperations,
  listWorkReports,
  startOperation,
  transitionWorkOrder,
  type WorkOrderDetail,
  type WorkOrderOperationRow,
  type WorkReportRow,
} from '@/api/schedule';
import { useUserStore } from '@/stores/user';
import { WORK_ORDER_ACTIONS, WORK_ORDER_STATUS, OP_STATUS, fmtQty, formatDate, formatDateTime, pct } from '@/utils/format';
import { confirmAction } from '@/api/http';

const route = useRoute();
const router = useRouter();
const user = useUserStore();
const can = (code: string) => user.has(code);

const id = Number(route.params.id);
const detail = ref<WorkOrderDetail | null>(null);
const operations = ref<WorkOrderOperationRow[]>([]);
const reports = ref<WorkReportRow[]>([]);
const openLogs = ref<string[]>([]);
const busyAction = ref('');
const startingOp = ref(0);

const status = computed(() => WORK_ORDER_STATUS[detail.value?.status ?? ''] ?? { text: detail.value?.status ?? '—', type: 'default' as const });

/** allowedActions ∩ 当前用户权限 */
const actions = computed(() =>
  (detail.value?.allowedActions ?? [])
    .filter((key: string) => WORK_ORDER_ACTIONS[key] && can(WORK_ORDER_ACTIONS[key].permission))
    .map((key: string) => ({ key, meta: WORK_ORDER_ACTIONS[key] })),
);

async function load() {
  try {
    const [d, ops] = await Promise.all([
      getWorkOrderDetail(id),
      listWorkOrderOperations(id).catch(() => [] as WorkOrderOperationRow[]),
    ]);
    detail.value = d;
    operations.value = ops;
    if (can('work-report:view')) {
      reports.value = await listWorkReports(id).catch(() => []);
    }
  } catch {
    // 拦截器已提示
  }
}

const reasonDialog = reactive({
  show: false,
  title: '',
  placeholder: '',
  text: '',
  action: '',
  required: true,
});

function onAction(action: string) {
  const meta = WORK_ORDER_ACTIONS[action];
  if (!meta) return;
  // 完工前置：所有工序完工前不能完工（服务端同样校验，这里提前拦住并给出准确原因）
  if (action === 'complete') {
    const unfinished = operations.value.filter((o) => o.status !== 'COMPLETED' && o.status !== 'CANCELLED').length;
    if (unfinished > 0) {
      showToast(`还有 ${unfinished} 道工序未完工，不能完工`);
      return;
    }
  }
  if (meta.needReason) {
    const completed = detail.value?.completedQty ?? 0;
    const planned = detail.value?.qty ?? 0;
    // 完工：未达计划数量属于"部分完工"，必须填原因；全部完工才可留空
    const partial = action === 'complete' && completed < planned;
    reasonDialog.title = `${meta.text}工单`;
    reasonDialog.placeholder = action === 'complete'
      ? (partial ? `当前完工 ${completed}/${planned}，部分完工须填写原因（必填）` : '全部完工，原因可留空')
      : '请填写原因（必填）';
    reasonDialog.text = '';
    reasonDialog.action = action;
    reasonDialog.required = action !== 'complete' || partial;
    reasonDialog.show = true;
    return;
  }
  void (async () => {
    if (!(await confirmAction(meta.confirm))) return;
    const ok = await doAction(action);
    if (ok) showSuccessToast(`${meta.text}成功`);
  })();
}

async function beforeReasonClose(action: string | 'confirm' | 'cancel'): Promise<boolean> {
  if (action !== 'confirm') return true;
  const text = reasonDialog.text.trim();
  if (reasonDialog.required && !text) {
    showToast('请填写原因');
    return false;
  }
  const ok = await doAction(reasonDialog.action, text || undefined);
  if (ok) showSuccessToast(`${WORK_ORDER_ACTIONS[reasonDialog.action]?.text ?? ''}成功`);
  return ok;
}

async function doAction(action: string, reason?: string): Promise<boolean> {
  busyAction.value = action;
  try {
    await transitionWorkOrder(id, action, reason);
    await load();
    return true;
  } catch {
    return false;
  } finally {
    busyAction.value = '';
  }
}

async function onStartOp(opId: number) {
  if (!(await confirmAction('确认该工序开工？'))) return;
  startingOp.value = opId;
  try {
    await startOperation(opId);
    showSuccessToast('已开工');
    await load();
  } catch {
    // 拦截器已提示
  } finally {
    startingOp.value = 0;
  }
}

function goReport() {
  router.push({ path: '/report', query: { wo: detail.value?.code } });
}

function goAndon() {
  router.push({
    path: '/andon',
    query: {
      create: '1',
      wo: String(detail.value?.id ?? ''),
      wc: detail.value?.workCenterId ? String(detail.value.workCenterId) : '',
      desc: `${detail.value?.code ?? ''} ${detail.value?.material?.name ?? ''}`,
    },
  });
}

onMounted(load);
</script>

<style scoped>
.detail-page {
  padding-bottom: 0;
}

.detail-body {
  padding-bottom: calc(84px + env(safe-area-inset-bottom));
}

.wo-code {
  font-size: 17px;
  font-weight: 800;
  color: #14213d;
}

.material {
  margin-top: 8px;
  font-size: 15px;
  font-weight: 600;
}

.progress-wrap {
  margin-top: 14px;
}

.progress-wrap .flex-between {
  margin-bottom: 6px;
}

.ml-6 {
  margin-left: 6px;
}

.ml-8 {
  margin-left: 8px;
}

.action-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 12px;
}

.op-card {
  padding: 4px 14px;
}

.op-item {
  display: flex;
  gap: 12px;
  padding: 14px 0;
}

.op-item + .op-item {
  border-top: 1px solid var(--line);
}

.op-seq {
  flex: none;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 13px;
  background: #f1f4f9;
  color: #64748b;
}

.op-seq.is-primary {
  background: #e8f0fa;
  color: #1f4e8c;
}

.op-seq.is-warning {
  background: #fff4e0;
  color: #d97706;
}

.op-seq.is-success {
  background: #e7f6ee;
  color: #18a058;
}

.op-main {
  flex: 1;
  min-width: 0;
}

.op-name {
  font-size: 14px;
  font-weight: 600;
}

.op-sub {
  margin-top: 4px;
}

.op-qty {
  margin-top: 6px;
}

.op-start {
  margin-top: 8px;
}

.report-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
}

.report-item + .report-item {
  border-top: 1px solid var(--line);
}

.avatar {
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: linear-gradient(135deg, #1f4e8c, #14213d);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
}

.report-main {
  flex: 1;
  min-width: 0;
}

.report-title {
  font-size: 13px;
  font-weight: 500;
}

.report-qty {
  flex: none;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.log-collapse {
  margin-bottom: 12px;
  border-radius: 14px;
  overflow: hidden;
}

.log-item {
  position: relative;
  display: flex;
  gap: 10px;
  padding: 8px 0 8px 4px;
}

.log-dot {
  flex: none;
  width: 8px;
  height: 8px;
  margin-top: 6px;
  border-radius: 50%;
  background: #1f4e8c;
}

.log-title {
  font-size: 13px;
  font-weight: 500;
}

.log-reason {
  margin-top: 4px;
  padding: 6px 8px;
  border-radius: 8px;
  background: #f6f8fc;
  font-size: 12px;
  color: #5b6779;
}

.bottom-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 30;
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(8px);
  box-shadow: 0 -4px 16px rgba(20, 33, 61, 0.08);
}

.bottom-btn {
  flex: none;
  width: 110px;
  height: 44px;
}

.bottom-btn--main {
  flex: 1;
  width: auto;
}

.reason-body {
  padding: 8px 16px 16px;
}

.page-loading {
  padding: 80px 0;
}
</style>
