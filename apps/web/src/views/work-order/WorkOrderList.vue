<template>
  <ProTable :fetch="fetch" ref="tableRef" @reset="Object.assign(query, { keyword: '', workCenterId: undefined, status: '', delayed: false })">
      <template #search>
        <el-form-item label="关键字">
          <el-input v-model="query.keyword" placeholder="工单编码 / 物料名称" clearable maxlength="32" @keyup.enter="tableRef?.reload()" />
        </el-form-item>
        <el-form-item label="工作中心">
          <el-select v-model="query.workCenterId" placeholder="全部" clearable style="width: 160px" @change="tableRef?.reload()">
            <el-option v-for="w in workCenters" :key="w.id" :label="w.name" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="query.status" placeholder="全部" clearable style="width: 140px" @change="tableRef?.reload()">
            <el-option v-for="o in statusDict" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="仅看延误">
          <el-switch v-model="query.delayed" @change="tableRef?.reload()" />
        </el-form-item>
      </template>
      <el-table-column prop="code" label="工单编码" min-width="130" />
      <el-table-column label="所属订单" min-width="120">
        <template #default="{ row }">{{ row.productionOrder.code }}</template>
      </el-table-column>
      <el-table-column label="物料" min-width="140">
        <template #default="{ row }">{{ row.material.name }}</template>
      </el-table-column>
      <el-table-column prop="qty" label="数量" width="80" />
      <el-table-column label="产线" min-width="110">
        <template #default="{ row }">{{ row.workCenter?.name ?? '—' }}</template>
      </el-table-column>
      <el-table-column label="计划起止" min-width="180">
        <template #default="{ row }">
          <span v-if="row.plannedStart">{{ row.plannedStart.slice(0, 10) }} ~ {{ row.plannedEnd.slice(0, 10) }}</span>
          <span v-else>未排产</span>
        </template>
      </el-table-column>
      <el-table-column label="延误" width="80">
        <template #default="{ row }">
          <el-tag v-if="row.isDelayed" type="danger" size="small">延误</el-tag>
          <span v-else>—</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="statusTag(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="80" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row)">详情</el-button>
        </template>
      </el-table-column>
    </ProTable>

    <!-- 详情抽屉：状态条 + 动作按钮（按 allowedActions 显隐）+ 状态日志 -->
    <el-drawer v-model="detailVisible" :title="detail?.code ?? '工单详情'" size="480px" destroy-on-close>
      <template v-if="detail">
        <div class="status-bar">
          <el-tag :type="statusTag(detail.status)" size="large">{{ statusLabel(detail.status) }}</el-tag>
          <span v-if="detail.isDelayed" class="delayed-badge">延误</span>
          <div class="actions">
            <el-button
              v-for="a in detail.allowedActions" :key="a"
              :type="a === 'cancel' ? 'danger' : a === 'complete' ? 'success' : 'primary'"
              size="small"
              :disabled="transitioning"
              @click="onAction(a)">
              {{ actionText[a] ?? a }}
            </el-button>
          </div>
        </div>
        <el-descriptions :column="2" border size="small" class="desc">
          <el-descriptions-item label="所属订单">{{ detail.productionOrder.code }}</el-descriptions-item>
          <el-descriptions-item label="数量">{{ detail.qty }}</el-descriptions-item>
          <el-descriptions-item label="物料" :span="2">{{ detail.material.code }} {{ detail.material.name }}</el-descriptions-item>
          <el-descriptions-item label="产线">{{ detail.workCenter?.name ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="路线">{{ detail.routingId ?? '下达时确定' }}</el-descriptions-item>
          <el-descriptions-item label="计划起止" :span="2">
            <template v-if="detail.plannedStart && detail.plannedEnd">{{ detail.plannedStart.slice(0, 10) }} ~ {{ detail.plannedEnd.slice(0, 10) }}</template>
            <template v-else>未排产</template>
          </el-descriptions-item>
        </el-descriptions>

        <h4>工序任务</h4>
        <el-table :data="operations" size="small" border v-loading="opsLoading">
          <el-table-column prop="seq" label="#" width="50" />
          <el-table-column label="工序" min-width="110">
            <template #default="{ row }">{{ row.operationName }}<span v-if="row.skipped" class="reason">（跳过）</span></template>
          </el-table-column>
          <el-table-column label="工作中心" min-width="90">
            <template #default="{ row }">{{ row.workCenter.name }}</template>
          </el-table-column>
          <el-table-column label="数量" width="90">
            <template #default="{ row }">{{ row.completedQty }}/{{ row.plannedQty }}<span v-if="row.defectQty" class="reason">（不良{{ row.defectQty }}）</span></template>
          </el-table-column>
          <el-table-column label="派工" min-width="110">
            <template #default="{ row }">
              <span v-if="row.team || row.employee || row.equipment">
                {{ row.team?.name ?? '' }}{{ row.employee ? ' ' + row.employee.name : '' }}{{ row.equipment ? ' ' + row.equipment.name : '' }}
              </span>
              <span v-else>未派工</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="opStatusTag(row.status)" size="small">{{ opStatusText[row.status] ?? row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="{ row }">
              <el-button v-permission="'work-order-operation:assign'" link type="primary" :disabled="row.status === 'COMPLETED' || row.status === 'CANCELLED'" @click="openAssign(row)">派工</el-button>
              <el-button v-permission="'work-order-operation:start'" link type="primary" :disabled="row.status !== 'READY'" @click="onStartOp(row)">开工</el-button>
            </template>
          </el-table-column>
        </el-table>

        <div class="inv-actions">
          <el-button v-permission="'material-issue:create'" size="small" @click="onGenerateIssue">生成领料单</el-button>
          <el-button v-permission="'receipt:create'" size="small" type="success" :disabled="(detail?.completedQty ?? 0) <= 0" @click="openReceipt">完工入库</el-button>
        </div>
        <h4>工单二维码</h4>
        <div class="qr-box">
          <img v-if="qrUrl" :src="qrUrl" alt="工单二维码" class="qr-img" />
          <span class="reason">扫码进入报工页（内容 wo:{{ detail?.code }}）</span>
        </div>

        <h4>状态变更记录</h4>
        <el-timeline v-if="detail.logs.length">
          <el-timeline-item
            v-for="log in detail.logs" :key="log.id"
            :timestamp="`${log.createdAt.slice(0, 16).replace('T', ' ')} · ${log.operatorName}`"
            :type="log.toStatus === 'CANCELLED' ? 'danger' : log.toStatus === 'CLOSED' || log.toStatus === 'COMPLETED' ? 'success' : 'primary'">
            <b>{{ actionText[log.action] ?? log.action }}</b>：{{ statusLabel(log.fromStatus) }} → {{ statusLabel(log.toStatus) }}
            <div v-if="log.reason" class="reason">原因：{{ log.reason }}</div>
          </el-timeline-item>
        </el-timeline>
        <el-empty v-else description="暂无状态变更" :image-size="60" />
        <el-dialog v-model="receiptVisible" title="完工入库" width="380px" append-to-body destroy-on-close>
          <el-form label-width="90px">
            <el-form-item label="数量">
              <el-input-number v-model="receiptQty" :min="1" :max="Math.max(1, detail?.completedQty ?? 0)" style="width: 100%" />
              <div class="reason">可入库：完工 {{ detail?.completedQty ?? 0 }} 件</div>
            </el-form-item>
            <el-form-item label="仓库">
              <el-select v-model="receiptWarehouseId" style="width: 100%">
                <el-option v-for="w in warehouses" :key="w.id" :label="`${w.code} ${w.name}`" :value="w.id" />
              </el-select>
            </el-form-item>
          </el-form>
          <template #footer>
            <el-button @click="receiptVisible = false">取消</el-button>
            <el-button type="primary" :loading="receipting" @click="doReceipt">入库</el-button>
          </template>
        </el-dialog>
      </template>
    </el-drawer>

    <!-- 派工对话框 -->
    <el-dialog v-model="assignVisible" :title="`派工：${assignOp?.operationName ?? ''}`" width="420px" destroy-on-close>
      <el-form label-width="80px">
        <el-form-item label="班组">
          <el-select v-model="assignForm.teamId" clearable style="width: 100%">
            <el-option v-for="t in teamOptions.filter((t) => t.workCenterId === assignOp?.workCenterId)" :key="t.id" :label="t.name" :value="t.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="员工">
          <el-select v-model="assignForm.employeeId" clearable filterable style="width: 100%">
            <el-option v-for="e in employeeOptions" :key="e.id" :label="e.name" :value="e.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="设备">
          <el-select v-model="assignForm.equipmentId" clearable style="width: 100%">
            <el-option v-for="e in equipmentOptions.filter((e) => e.workCenterId === assignOp?.workCenterId)" :key="e.id" :label="e.name" :value="e.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="assignVisible = false">取消</el-button>
        <el-button type="primary" @click="saveAssign">保存</el-button>
      </template>
    </el-dialog>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import ProTable from '@/components/ProTable.vue';
import { useDict } from '@/composables/useDict';
import { useUserStore } from '@/stores/user';
import { listWorkCenters, listEquipments } from '@/api/routing';
import { listTeams, listEmployees } from '@/api/team';
import {
  listWorkOrders, getWorkOrderDetail, getWorkOrderQrcode, transitionWorkOrder, type WorkOrderDetail,
  listWorkOrderOperations, assignOperation, startOperation, type WorkOrderOperationRow,
  generateMaterialIssue, createReceipt, listWarehouses,
} from '@/api/schedule';
import type { DictOption, PageQuery, WorkOrderRow } from '@mes/shared';

const tableRef = ref();
const userStore = useUserStore();
const query = reactive({ keyword: '', workCenterId: undefined as number | undefined, status: '', delayed: false });
const workCenters = ref<{ id: number; code: string; name: string }[]>([]);
const { options: statusDict } = useDict('work_order_status');

/** 字典 label；字典未就绪时回退到本地映射（页面不空转） */
const fallback: Record<string, string> = {
  CREATED: '已创建', RELEASED: '已下达', IN_PROGRESS: '进行中', PAUSED: '已暂停',
  COMPLETED: '已完工', CLOSED: '已关闭', CANCELLED: '已取消',
};
const statusLabel = (s: string) => statusDict.value.find((o: DictOption) => o.value === s)?.label ?? fallback[s] ?? s;
/** 状态色约定：草稿灰 / 进行中蓝 / 完成绿 / 异常红 / 取消灰 */
const statusTag = (s: string) => ({
  CREATED: 'info', RELEASED: 'primary', IN_PROGRESS: 'primary', PAUSED: 'warning',
  COMPLETED: 'success', CLOSED: 'success', CANCELLED: 'info',
}[s] ?? 'info');

const actionText: Record<string, string> = {
  release: '下达', start: '开工', pause: '暂停', resume: '继续',
  complete: '完工', close: '关闭', cancel: '取消',
};

const fetch = (q: PageQuery) => listWorkOrders({
  ...q,
  keyword: query.keyword || undefined,
  workCenterId: query.workCenterId,
  status: query.status || undefined,
  delayed: query.delayed ? '1' : undefined,
});

// ---- 领料与入库 ----
const receiptVisible = ref(false);
const receiptQty = ref(0);
const receiptWarehouseId = ref<number>();
const receipting = ref(false);
const warehouses = ref<{ id: number; code: string; name: string }[]>([]);

async function onGenerateIssue() {
  if (!detail.value) return;
  try {
    const issue = await generateMaterialIssue(detail.value.id);
    const lines = (issue.items ?? []).map(
      (it) => `${it.material?.name ?? `物料#${it.materialId}`} × ${it.requiredQty}`,
    );
    await ElMessageBox.alert(lines.join('，') || '无领料明细', `领料单 ${issue.code}（BOM 展开）`);
  } catch {
    /* 拦截器已提示；无 BOM / 未下达等情况保持页面可继续操作 */
  }
}

/** 完工入库：按完工数打开，数量为 0 时直接拦住，避免 InputNumber min>max */
function openReceipt() {
  const completed = detail.value?.completedQty ?? 0;
  if (completed <= 0) {
    ElMessage.warning('当前没有可入库的完工数量，请先完成报工');
    return;
  }
  receiptQty.value = completed;
  receiptVisible.value = true;
}

async function doReceipt() {
  if (!detail.value || !receiptWarehouseId.value) return;
  receipting.value = true;
  try {
    const lot = await createReceipt(detail.value.id, { qty: receiptQty.value, warehouseId: receiptWarehouseId.value });
    ElMessage.success(`已入库，批次 ${lot.lotNo}`);
    receiptVisible.value = false;
  } catch {
    /* 拦截器已提示；弹窗保持打开，数量不丢，可改后重试 */
  } finally { receipting.value = false; }
}

// ---- 工序任务 ----
const operations = ref<WorkOrderOperationRow[]>([]);
const opsLoading = ref(false);
const opStatusText: Record<string, string> = {
  PENDING: '未就绪', READY: '待开工', IN_PROGRESS: '进行中', COMPLETED: '已完工', CANCELLED: '已取消',
};
const opStatusTag = (s: string) => ({
  PENDING: 'info', READY: 'warning', IN_PROGRESS: 'primary', COMPLETED: 'success', CANCELLED: 'info',
}[s] ?? 'info');

async function loadOperations(workOrderId: number) {
  opsLoading.value = true;
  try {
    operations.value = await listWorkOrderOperations(workOrderId);
  } catch {
    operations.value = []; // 拦截器已提示
  } finally { opsLoading.value = false; }
}

const assignVisible = ref(false);
const assignOp = ref<WorkOrderOperationRow | null>(null);
const assignForm = reactive<{ teamId?: number; employeeId?: number; equipmentId?: number }>({});
const teamOptions = ref<{ id: number; name: string; workCenterId: number }[]>([]);
const employeeOptions = ref<{ id: number; name: string; teamId: number }[]>([]);
const equipmentOptions = ref<{ id: number; name: string; workCenterId: number }[]>([]);

function openAssign(row: WorkOrderOperationRow) {
  assignOp.value = row;
  Object.assign(assignForm, { teamId: row.teamId ?? undefined, employeeId: row.employeeId ?? undefined, equipmentId: row.equipmentId ?? undefined });
  assignVisible.value = true;
}

async function saveAssign() {
  if (!assignOp.value) return;
  try {
    await assignOperation(assignOp.value.id, assignForm);
    ElMessage.success('已派工');
    assignVisible.value = false;
    await loadOperations(detail.value!.id);
  } catch {
    /* 拦截器已提示；弹窗保持打开，可改后重试 */
  }
}

async function onStartOp(row: WorkOrderOperationRow) {
  try {
    await ElMessageBox.confirm(`确认开工工序「${row.operationName}」？`, '开工', { type: 'primary' });
    await startOperation(row.id);
    ElMessage.success('已开工');
    await loadOperations(detail.value!.id);
  } catch {
    /* 用户取消确认，或拦截器已提示 */
  }
}

// ---- 详情与动作 ----
const detailVisible = ref(false);
const detail = ref<WorkOrderDetail | null>(null);
const transitioning = ref(false);

const qrUrl = ref('');

async function openDetail(row: WorkOrderRow) {
  operations.value = []; // 先清空，避免短暂沿用上一张工单的工序状态
  detail.value = await getWorkOrderDetail(row.id);
  detailVisible.value = true;
  void loadOperations(row.id);
  // 二维码接口需要 Bearer 头：<img src> 直连会 401，改为带鉴权取 blob 再生成 object URL
  if (qrUrl.value.startsWith('blob:')) URL.revokeObjectURL(qrUrl.value);
  qrUrl.value = '';
  try {
    const blob = await getWorkOrderQrcode(row.id);
    qrUrl.value = URL.createObjectURL(blob);
  } catch {
    /* 拦截器已提示 */
  }
}

/** 动作前确认；cancel 必填理由，complete 可带部分完工原因 */
async function onAction(action: string) {
  const d = detail.value!;
  if (action === 'cancel') {
    const { value } = await ElMessageBox.prompt(`确认取消工单 ${d.code}？`, '取消工单', {
      inputPlaceholder: '取消原因（必填）', inputValidator: (v: string) => (v?.trim() ? true : '必须填写原因'), type: 'warning',
    });
    await doTransition(action, value);
    return;
  }
  if (action === 'complete') {
    // 工序还没加载完时 operations 是空数组，直接数会误判为"全部完工"，把请求放给后端才报 422
    if (opsLoading.value) {
      ElMessage.warning('工序数据加载中，请稍候重试');
      return;
    }
    if (!operations.value.length) {
      ElMessage.warning('该工单没有工序任务，不能完工');
      return;
    }
    // 与服务端一致：工序未全部完工时先拦住，给出准确原因而不是笼统的数量报错
    const unfinished = operations.value.filter((o) => o.status !== 'COMPLETED' && o.status !== 'CANCELLED').length;
    if (unfinished > 0) {
      ElMessage.warning(`还有 ${unfinished} 道工序未完工，不能完工`);
      return;
    }
    const partial = d.completedQty < d.qty;
    const { value } = await ElMessageBox.prompt(`确认完工 ${d.code}？`, '完工', {
      inputPlaceholder: partial
        ? `当前完工 ${d.completedQty}/${d.qty}，部分完工须填写原因（必填）`
        : '全部完工，原因可留空',
      ...(partial ? { inputValidator: (v: string) => (v?.trim() ? true : '部分完工必须填写原因') } : {}),
    });
    await doTransition(action, value || undefined);
    return;
  }
  await ElMessageBox.confirm(`确认对工单 ${d.code} 执行「${actionText[action]}」？`, '确认', { type: 'warning' });
  await doTransition(action);
}

async function doTransition(action: string, reason?: string) {
  transitioning.value = true;
  try {
    await transitionWorkOrder(detail.value!.id, action, reason);
    ElMessage.success(`已${actionText[action] ?? action}`);
    detail.value = await getWorkOrderDetail(detail.value!.id);
    tableRef.value?.reload();
  } catch {
    /* 拦截器已提示；状态不变，可刷新后重试 */
  } finally {
    transitioning.value = false;
  }
}

onMounted(async () => {
  // 可选下拉数据：没有对应权限的角色（如 operator）直接跳过，避免无意义的 403
  if (userStore.has('inventory:view')) {
    void listWarehouses({ silent: true }).then((ws) => (warehouses.value = ws)).catch(() => undefined);
  }
  const [wcs, teams, emps, eqs] = await Promise.all([
    listWorkCenters({ pageSize: 100 }).catch(() => ({ list: [] })),
    userStore.has('team:view')
      ? listTeams(undefined, { silent: true }).catch(() => ({ list: [] }))
      : Promise.resolve({ list: [] as { id: number; name: string; workCenterId: number }[] }),
    listEmployees({ page: 1, pageSize: 200, status: 'ACTIVE' }).catch(() => ({ list: [] })),
    listEquipments({ pageSize: 100 }).catch(() => ({ list: [] })),
  ]);
  workCenters.value = wcs.list.map((w) => ({ id: w.id, code: w.code, name: w.name }));
  teamOptions.value = teams.list.map((t) => ({ id: t.id, name: t.name, workCenterId: t.workCenterId }));
  employeeOptions.value = emps.list.map((e) => ({ id: e.id, name: e.name, teamId: e.teamId }));
  equipmentOptions.value = eqs.list.map((e) => ({ id: e.id, name: e.name, workCenterId: e.workCenterId }));
});
</script>

<style scoped>
.status-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.status-bar .actions { margin-left: auto; display: flex; gap: 6px; flex-wrap: wrap; }
.delayed-badge { color: #f56c6c; font-size: 12px; border: 1px solid #f56c6c; border-radius: 3px; padding: 0 4px; }
.desc { margin-bottom: 16px; }
.inv-actions { display: flex; gap: 8px; margin-bottom: 12px; }
.reason { color: #999; font-size: 12px; }
.qr-box { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.qr-img { width: 120px; height: 120px; border: 1px solid #eee; }
h4 { margin: 12px 0 8px; }
</style>
