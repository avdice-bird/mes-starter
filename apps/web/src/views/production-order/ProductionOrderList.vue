<template>
  <div>
    <el-tabs v-model="tab" @tab-change="reloadCurrent">
      <!-- 订单 -->
      <el-tab-pane label="生产订单" name="orders">
        <ProTable :fetch="fetchOrders" ref="orderTableRef" @reset="Object.assign(orderQuery, { keyword: '', status: '' })">
          <template #search>
            <el-form-item label="关键字">
              <el-input v-model="orderQuery.keyword" placeholder="编码 / 成品名称" clearable maxlength="32" @keyup.enter="orderTableRef?.reload()" />
            </el-form-item>
            <el-form-item label="状态">
              <el-select v-model="orderQuery.status" placeholder="全部" clearable style="width: 140px" @change="orderTableRef?.reload()">
                <el-option v-for="(label, key) in orderStatusText" :key="key" :label="label" :value="key" />
              </el-select>
            </el-form-item>
          </template>
          <template #toolbar>
            <el-button v-permission="'production-order:create'" type="primary" @click="openOrderForm()">新建订单</el-button>
          </template>
          <el-table-column prop="code" label="订单编码" min-width="120" />
          <el-table-column label="成品" min-width="150">
            <template #default="{ row }">{{ row.material.name }}（{{ row.material.code }}）</template>
          </el-table-column>
          <el-table-column prop="qty" label="数量" width="90" />
          <el-table-column label="交期" width="110">
            <template #default="{ row }">{{ (row.dueDate || '').slice(0, 10) }}</template>
          </el-table-column>
          <el-table-column prop="priority" label="优先级" width="80" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="orderStatusTag(row.status)" size="small">{{ orderStatusText[row.status] ?? row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="工单数" width="80">
            <template #default="{ row }">{{ row.workOrderCount }}</template>
          </el-table-column>
          <el-table-column label="操作" width="200" fixed="right">
            <template #default="{ row }">
              <el-button v-permission="'production-order:split'" link type="primary" :disabled="row.status !== 'DRAFT'" @click="openSplit(row)">拆分</el-button>
              <el-button v-permission="'production-order:update'" link type="primary" @click="openOrderForm(row)">编辑</el-button>
              <el-button v-permission="'production-order:cancel'" link type="warning" :disabled="row.status === 'CANCELLED' || row.status === 'COMPLETED'" @click="onCancel(row)">取消</el-button>
              <el-button v-permission="'production-order:delete'" link type="danger" :disabled="row.workOrderCount > 0" @click="onDelete(row)">删除</el-button>
            </template>
          </el-table-column>
        </ProTable>
      </el-tab-pane>

      <!-- 工单（只读） -->
      <el-tab-pane label="工单列表" name="workOrders">
        <ProTable :fetch="fetchWorkOrders" ref="woTableRef" @reset="Object.assign(woQuery, { keyword: '', workCenterId: undefined, delayed: false })">
          <template #search>
            <el-form-item label="关键字">
              <el-input v-model="woQuery.keyword" placeholder="工单编码 / 物料名称" clearable maxlength="32" @keyup.enter="woTableRef?.reload()" />
            </el-form-item>
            <el-form-item label="工作中心">
              <el-select v-model="woQuery.workCenterId" placeholder="全部" clearable style="width: 160px" @change="woTableRef?.reload()">
                <el-option v-for="w in workCenters" :key="w.id" :label="w.name" :value="w.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="仅看延误">
              <el-switch v-model="woQuery.delayed" @change="woTableRef?.reload()" />
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
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag type="info" size="small">{{ woStatusText[row.status] ?? row.status }}</el-tag>
            </template>
          </el-table-column>
        </ProTable>
      </el-tab-pane>

      <!-- 排产 -->
      <el-tab-pane label="排产" name="schedule">
        <el-card>
          <el-form inline @submit.prevent>
            <el-form-item label="开始日期">
              <el-date-picker v-model="scheduleFrom" type="date" value-format="YYYY-MM-DD" :clearable="false" style="width: 150px" />
            </el-form-item>
            <el-form-item v-permission="'schedule:run'">
              <el-button type="primary" :loading="scheduling" @click="onRunSchedule">一键排产</el-button>
            </el-form-item>
          </el-form>
          <el-alert v-if="scheduleResult" :type="scheduleResult.delayed > 0 ? 'warning' : 'success'" :closable="false" class="result-bar">
            本次排产 {{ scheduleResult.scheduled }} 张工单，延误 {{ scheduleResult.delayed }} 张<template v-if="scheduleResult.skipped.length">，跳过 {{ scheduleResult.skipped.length }} 张（产能不足或产线不可排）</template>
          </el-alert>
          <el-empty v-if="!scheduleGroups.length && !scheduleLoading" description="还没有排产结果，点「一键排产」" />
          <div v-for="g in scheduleGroups" :key="String(g.workCenterId)" class="group">
            <h4>{{ g.workCenter ? g.workCenter.name : '未分配 / 跳过' }}</h4>
            <el-table :data="g.items" size="small" stripe>
              <el-table-column prop="code" label="工单" min-width="130" />
              <el-table-column prop="qty" label="数量" width="80" />
              <el-table-column label="计划起止" min-width="170">
                <template #default="{ row }">{{ row.plannedStart.slice(0, 10) }} ~ {{ row.plannedEnd.slice(0, 10) }}</template>
              </el-table-column>
              <el-table-column label="延误" width="80">
                <template #default="{ row }">
                  <el-tag v-if="row.isDelayed" type="danger" size="small">延误</el-tag>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- 订单表单 -->
    <el-dialog v-model="orderFormVisible" :title="editing ? '编辑订单' : '新建订单'" width="480px" destroy-on-close>
      <el-form ref="orderFormRef" :model="orderForm" :rules="orderRules" label-width="90px">
        <el-form-item label="编码" prop="code">
          <el-input v-model="orderForm.code" disabled maxlength="32" :placeholder="editing ? '' : '保存后自动生成'" />
          <div v-if="!editing" class="hint">编码由系统按 PO-年份-序号 自动生成，无需手动填写</div>
        </el-form-item>
        <el-form-item label="成品" prop="materialId">
          <el-select v-model="orderForm.materialId" filterable style="width: 100%" placeholder="选择成品物料">
            <el-option v-for="m in finishedMaterials" :key="m.id" :label="`${m.code} ${m.name}`" :value="m.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="数量" prop="qty">
          <el-input-number v-model="orderForm.qty" :min="1" :max="10000000" style="width: 100%" :disabled="!!editing && orderForm.workOrderCount > 0" />
          <div v-if="editing && orderForm.workOrderCount > 0" class="hint">已拆分工单，数量不可改；如需修改请先取消工单。</div>
        </el-form-item>
        <el-form-item label="交期" prop="dueDate">
          <el-date-picker v-model="orderForm.dueDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="优先级" prop="priority">
          <el-select v-model="orderForm.priority" style="width: 100%">
            <el-option v-for="p in 5" :key="p" :label="p" :value="p" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="orderForm.remark" type="textarea" maxlength="200" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="orderFormVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveOrder">保存</el-button>
      </template>
    </el-dialog>

    <!-- 拆分对话框 -->
    <el-dialog v-model="splitVisible" title="拆分工单" width="520px" destroy-on-close>
      <el-form label-width="90px">
        <el-form-item label="订单">{{ splitOrder?.code }}，共 {{ splitOrder?.qty }}</el-form-item>
        <el-form-item v-for="(it, i) in splits" :key="i" :label="`工单 ${i + 1}`">
          <el-input-number v-model="it.qty" :min="1" style="width: 150px" />
          <el-select v-model="it.workCenterId" clearable placeholder="产线（可空）" style="width: 200px; margin-left: 8px">
            <el-option v-for="w in workCenters" :key="w.id" :label="`${w.code} ${w.name}`" :value="w.id" />
          </el-select>
          <el-button link type="danger" :disabled="splits.length <= 1" @click="splits.splice(i, 1)">移除</el-button>
        </el-form-item>
        <el-form-item>
          <el-button link type="primary" @click="splits.push({ qty: 1 })">+ 加一行</el-button>
          <span class="hint" :class="{ bad: splitSum !== splitOrder?.qty }">
            已拆 {{ splitSum }} / 订单 {{ splitOrder?.qty }}
            <template v-if="splitSum !== splitOrder?.qty">（差额 {{ (splitOrder?.qty ?? 0) - splitSum }}）</template>
          </span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="splitVisible = false">取消</el-button>
        <el-button type="primary" :disabled="splitSum !== splitOrder?.qty" :loading="saving" @click="doSplit">确认拆分</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import ProTable from '@/components/ProTable.vue';
import { listWorkCenters } from '@/api/routing';
import { listMaterials } from '@/api/material';
import {
  listProductionOrders, createProductionOrder, updateProductionOrder, splitProductionOrder,
  cancelProductionOrder, deleteProductionOrder, listWorkOrders, runSchedule, getScheduleView,
} from '@/api/schedule';
import type { MaterialRow, ProductionOrderRow, ScheduleRunResult, WorkOrderRow, PageQuery } from '@mes/shared';

const tab = ref('orders');
const saving = ref(false);
const workCenters = ref<{ id: number; code: string; name: string }[]>([]);
const finishedMaterials = ref<MaterialRow[]>([]);

const orderStatusText: Record<string, string> = {
  DRAFT: '草稿', PLANNED: '已拆分', RELEASED: '已下达', COMPLETED: '完成', CANCELLED: '已取消',
};
const orderStatusTag = (s: string) => ({ DRAFT: 'info', PLANNED: 'primary', RELEASED: 'primary', COMPLETED: 'success', CANCELLED: 'info' }[s] ?? 'info');
const woStatusText: Record<string, string> = {
  CREATED: '已创建', RELEASED: '已下达', IN_PROGRESS: '进行中', COMPLETED: '完成', CANCELLED: '已取消',
};

// ---- 订单 ----
const orderTableRef = ref();
const orderQuery = reactive({ keyword: '', status: '' });
const fetchOrders = (q: PageQuery) => listProductionOrders({ ...q, keyword: orderQuery.keyword || undefined, status: orderQuery.status || undefined });

const orderFormVisible = ref(false);
const editing = ref<ProductionOrderRow | null>(null);
const orderFormRef = ref<FormInstance>();
const orderForm = reactive({ code: '', materialId: 0, qty: 1, dueDate: '', priority: 3, remark: '', workOrderCount: 0 });
const orderRules: FormRules = {
  materialId: [{ required: true, message: '请选择成品' }],
  qty: [{ required: true, message: '请输入数量' }],
  dueDate: [{ required: true, message: '请选择交期' }],
};

function openOrderForm(row?: ProductionOrderRow) {
  editing.value = row ?? null;
  Object.assign(orderForm, {
    code: row?.code ?? '', materialId: row?.materialId ?? 0, qty: row?.qty ?? 1,
    dueDate: row ? (row.dueDate || '').slice(0, 10) : '', priority: row?.priority ?? 3,
    remark: row?.remark ?? '', workOrderCount: row?.workOrderCount ?? 0,
  });
  orderFormVisible.value = true;
}

async function saveOrder() {
  await orderFormRef.value?.validate();
  saving.value = true;
  try {
    if (editing.value) {
      await updateProductionOrder(editing.value.id, {
        qty: orderForm.workOrderCount > 0 ? undefined : orderForm.qty,
        dueDate: orderForm.dueDate, priority: orderForm.priority, remark: orderForm.remark,
      });
      ElMessage.success('已保存');
    } else {
      const created = await createProductionOrder({
        materialId: orderForm.materialId,
        qty: orderForm.qty,
        dueDate: orderForm.dueDate,
        priority: orderForm.priority,
        remark: orderForm.remark,
      });
      ElMessage.success(`已创建 ${created.code}`);
    }
    orderFormVisible.value = false;
    orderTableRef.value?.reload();
  } finally { saving.value = false; }
}

async function onCancel(row: ProductionOrderRow) {
  await ElMessageBox.confirm(`确认取消订单 ${row.code}？其下未开工工单一并取消。`, '取消订单', { type: 'warning' });
  await cancelProductionOrder(row.id);
  ElMessage.success('已取消');
  orderTableRef.value?.reload();
}

async function onDelete(row: ProductionOrderRow) {
  await ElMessageBox.confirm(`确认删除订单 ${row.code}？`, '删除', { type: 'warning' });
  await deleteProductionOrder(row.id);
  ElMessage.success('已删除');
  orderTableRef.value?.reload();
}

// ---- 拆分 ----
const splitVisible = ref(false);
const splitOrder = ref<ProductionOrderRow | null>(null);
const splits = reactive<{ qty: number; workCenterId?: number }[]>([{ qty: 1 }]);
const splitSum = computed(() => splits.reduce((s, it) => s + (it.qty || 0), 0));

function openSplit(row: ProductionOrderRow) {
  splitOrder.value = row;
  splits.splice(0, splits.length, { qty: row.qty });
  splitVisible.value = true;
}

async function doSplit() {
  if (!splitOrder.value) return;
  saving.value = true;
  try {
    await splitProductionOrder(splitOrder.value.id, splits.map((it) => ({ qty: it.qty, workCenterId: it.workCenterId })));
    ElMessage.success('拆分成功，订单转为已拆分');
    splitVisible.value = false;
    orderTableRef.value?.reload();
    woTableRef.value?.reload();
  } finally { saving.value = false; }
}

// ---- 工单 ----
const woTableRef = ref();
const woQuery = reactive({ keyword: '', workCenterId: undefined as number | undefined, delayed: false });
const fetchWorkOrders = (q: PageQuery) => listWorkOrders({
  ...q,
  keyword: woQuery.keyword || undefined,
  workCenterId: woQuery.workCenterId,
  delayed: woQuery.delayed ? '1' : undefined,
});

// ---- 排产 ----
const scheduleFrom = ref(new Date().toISOString().slice(0, 10));
const scheduling = ref(false);
const scheduleLoading = ref(false);
const scheduleResult = ref<ScheduleRunResult | null>(null);
const scheduleGroups = ref<ScheduleRunResult['groups']>([]);

async function onRunSchedule() {
  scheduling.value = true;
  try {
    scheduleResult.value = await runSchedule({ from: scheduleFrom.value });
    scheduleGroups.value = scheduleResult.value.groups;
    ElMessage.success(`排产完成：${scheduleResult.value.scheduled} 张，延误 ${scheduleResult.value.delayed} 张`);
    woTableRef.value?.reload();
  } finally { scheduling.value = false; }
}

function reloadCurrent() {
  if (tab.value === 'orders') orderTableRef.value?.reload();
  else if (tab.value === 'workOrders') woTableRef.value?.reload();
  else void loadScheduleView();
}

/** 切到排产页时展示已有排产结果（不重排） */
async function loadScheduleView() {
  scheduleLoading.value = true;
  try {
    const view = await getScheduleView();
    scheduleGroups.value = view.groups.map((g) => ({
      workCenterId: g.workCenterId,
      workCenter: g.workCenter,
      items: g.items.map((w: WorkOrderRow) => ({
        id: w.id, code: w.code, qty: w.qty,
        plannedStart: w.plannedStart ?? '', plannedEnd: w.plannedEnd ?? '', isDelayed: w.isDelayed,
      })),
    }));
  } finally { scheduleLoading.value = false; }
}

onMounted(async () => {
  const [wcs, mats] = await Promise.all([
    listWorkCenters({ pageSize: 100 }),
    listMaterials({ page: 1, pageSize: 100, type: 'FINISHED' }),
  ]);
  workCenters.value = wcs.list.map((w) => ({ id: w.id, code: w.code, name: w.name }));
  finishedMaterials.value = mats.list;
});
</script>

<style scoped>
.hint { color: #999; font-size: 12px; }
.hint.bad { color: #f56c6c; }
.result-bar { margin-bottom: 12px; }
.group { margin-top: 12px; }
.group h4 { margin: 8px 0; }
</style>
