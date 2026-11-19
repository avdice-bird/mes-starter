<template>
  <div class="page">
    <van-nav-bar title="扫码报工">
      <template #right>
        <span v-if="located" class="nav-action tappable tappable--flat" @click="reset">换工单</span>
        <van-icon v-else name="replay" size="20" @click="loadMyOrders" />
      </template>
    </van-nav-bar>

    <div class="page-body page-body--tabbar">
      <!-- 未定位：扫码 / 手输 / 进行中工单 -->
      <template v-if="!located">
        <div class="scan-hero card">
          <div class="scan-visual">
            <van-icon name="qr" size="52" />
            <div class="scan-corners" />
          </div>
          <div class="strong scan-title">扫描工单二维码开始报工</div>
          <div class="muted scan-sub">二维码贴在流转卡 / 工单首页，也可手动输入编码</div>
          <van-button type="primary" block round icon="scan" class="scan-btn" @click="startScan">
            扫一扫
          </van-button>
        </div>

        <div class="card">
          <div class="accent-bar strong">手动输入工单编码</div>
          <van-field
            v-model="codeInput"
            class="code-field"
            placeholder="如 PO-2026-001-W01"
            clearable
            :loading="locating"
            @keyup.enter="locate"
          >
            <template #button>
              <van-button size="small" type="primary" :loading="locating" @click="locate">定位</van-button>
            </template>
          </van-field>
          <div v-if="error" class="text-danger error-text">{{ error }}</div>
        </div>

        <template v-if="can('work-order:view')">
          <div class="section-title">
            <span>进行中的工单</span>
            <span class="more tappable tappable--flat" @click="router.push('/work-orders')">全部 ›</span>
          </div>
          <div v-if="myOrders.length" class="card order-list">
            <div
              v-for="wo in myOrders"
              :key="wo.id"
              class="order-item tappable"
              @click="quickLocate(wo.code)"
            >
              <div class="order-main">
                <div class="mono strong">{{ wo.code }}</div>
                <div class="muted">{{ wo.material.name }} · 计划 {{ fmtQty(wo.qty) }}</div>
              </div>
              <van-icon name="arrow" color="#b6bfce" />
            </div>
          </div>
          <div v-else class="card muted">暂无进行中的工单</div>
        </template>
      </template>

      <!-- 已定位：报工表单 -->
      <template v-else>
        <div class="card wo-head">
          <div class="flex-between">
            <span class="wo-code mono">{{ wo?.code }}</span>
            <van-tag :type="statusOf.type" size="medium">{{ statusOf.text }}</van-tag>
          </div>
          <div class="wo-material">{{ wo?.material.name }}</div>
          <div class="muted mono">{{ wo?.material.code }}</div>
          <div class="flex-between wo-meta">
            <span class="muted">计划 {{ fmtQty(wo?.qty) }}</span>
            <span class="muted">
              {{ wo?.workCenter?.name ?? '未排产' }}
              <template v-if="shift"> · {{ shift.name }}</template>
            </span>
          </div>
          <van-progress
            :percentage="pct(wo?.completedQty ?? 0, wo?.qty ?? 0)"
            :show-pivot="false"
            color="#1f4e8c"
            track-color="#eef1f6"
            stroke-width="6"
          />
          <div class="head-actions">
            <span class="muted">完成 {{ fmtQty(wo?.completedQty) }} / {{ fmtQty(wo?.qty) }}</span>
          </div>
          <van-button
            v-if="can('andon:create')"
            type="danger"
            block
            round
            size="large"
            icon="bulb-o"
            class="andon-btn"
            @click="goAndon"
          >拉灯呼叫</van-button>
        </div>

        <div class="section-title">
          <span>可报任务</span>
          <span class="more">{{ operations.length }} 道</span>
        </div>

        <div v-for="op in operations" :key="op.id" class="card op-card">
          <div class="flex-between">
            <div class="op-title">
              <span class="op-seq">{{ op.seq }}</span>
              <span class="op-name">{{ op.operationName }}</span>
            </div>
            <van-tag :type="OP_STATUS[op.status]?.type ?? 'default'" size="medium">
              {{ OP_STATUS[op.status]?.text ?? op.status }}
            </van-tag>
          </div>

          <div class="muted op-sub">
            {{ op.workCenter?.name }}
            <template v-if="op.isInspectionPoint"> · <span class="text-warning">质检点</span></template>
          </div>
          <div class="flex-between op-qty">
            <span class="muted">完成 {{ fmtQty(op.completedQty) }} / {{ fmtQty(op.plannedQty) }}</span>
            <span v-if="op.defectQty" class="text-danger">不良 {{ fmtQty(op.defectQty) }}</span>
          </div>

          <template v-if="op.status === 'IN_PROGRESS' && forms[op.id]">
            <div class="divider" />
            <van-cell
              title="报工员工"
              is-link
              :value="employeeLabel(op)"
              :value-class="forms[op.id]!.employeeId ? '' : 'placeholder'"
              @click="openEmployeePicker(op)"
            />
            <div class="qty-grid">
              <div class="qty-item">
                <span class="qty-label">良品</span>
                <van-stepper v-model="forms[op.id]!.goodQty" :min="0" :max="10000000" integer input-width="64px" button-size="28px" />
              </div>
              <div class="qty-item">
                <span class="qty-label">不良</span>
                <van-stepper v-model="forms[op.id]!.defectQty" :min="0" :max="10000000" integer input-width="64px" button-size="28px" />
              </div>
              <div class="qty-item">
                <span class="qty-label">工时(分)</span>
                <van-stepper v-model="forms[op.id]!.workMinutes" :min="0" :max="1440" integer input-width="64px" button-size="28px" />
              </div>
            </div>
            <van-button
              type="primary"
              block
              class="submit-btn"
              :loading="forms[op.id]!.loading"
              @click="submit(op)"
            >提交报工</van-button>
          </template>

          <template v-else-if="op.status === 'READY'">
            <div class="divider" />
            <div class="flex-between">
              <span class="muted">该工序尚未开工，开工后才能报工</span>
              <van-button
                v-if="can('work-order-operation:start')"
                type="primary"
                size="small"
                :loading="startingOp === op.id"
                @click="startOp(op)"
              >开工</van-button>
            </div>
          </template>

          <template v-else-if="op.status === 'COMPLETED'">
            <div class="divider" />
            <div class="muted"><van-icon name="passed" color="#18a058" /> 该工序已完成</div>
          </template>
        </div>

        <van-empty
          v-if="!operations.length"
          description="暂无可报任务：工序可能未派工/未开工，或上一道质检点待检验放行。请在 Web 端查看工单工序任务与质检单。"
        />
      </template>
    </div>

    <!-- 员工选择 -->
    <van-popup v-model:show="empPicker.show" position="bottom" round>
      <van-picker
        :key="empPicker.version"
        :title="`选择报工员工${empPicker.opName ? ' · ' + empPicker.opName : ''}`"
        :columns="empPicker.columns"
        @confirm="onEmployeeConfirm"
        @cancel="empPicker.show = false"
      />
    </van-popup>

    <!-- 相机扫码 -->
    <van-popup v-model:show="scanner.show" position="bottom" round @closed="stopScan">
      <div class="scanner">
        <div class="scanner-head">
          <span>扫描工单二维码</span>
          <van-icon name="cross" size="20" @click="stopScan" />
        </div>
        <div class="video-wrap">
          <video ref="videoRef" class="scan-video" playsinline muted autoplay />
          <div class="scan-frame" />
        </div>
        <p class="muted scanner-tip">将二维码放入取景框内，识别后自动定位工单</p>
      </div>
    </van-popup>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showSuccessToast, showToast } from '@/utils/toast';
import type { EmployeeRow } from '@mes/shared';
import {
  createWorkReport,
  getWorkOrderByCode,
  listWorkOrders,
  startOperation,
  type WorkOrderOperationRow,
  type WorkOrderRow,
} from '@/api/schedule';
import { listEmployees, getCurrentShift } from '@/api/team';
import type { ShiftRow } from '@mes/shared';
import { useUserStore } from '@/stores/user';
import { OP_STATUS, WORK_ORDER_STATUS, fmtQty, pct } from '@/utils/format';

const route = useRoute();
const router = useRouter();
const user = useUserStore();
const can = (code: string) => user.has(code);

const locating = ref(false);
const located = ref(false);
const error = ref('');
const codeInput = ref('');
const wo = ref<WorkOrderRow | null>(null);
const operations = ref<WorkOrderOperationRow[]>([]);
const myOrders = ref<WorkOrderRow[]>([]);
const employees = ref<EmployeeRow[]>([]);
const shift = ref<ShiftRow | null>(null);
const startingOp = ref(0);

interface FormState {
  employeeId?: number;
  goodQty: number;
  defectQty: number;
  workMinutes: number;
  loading: boolean;
  key: string;
}
const forms = reactive<Record<number, FormState>>({});
let keySeq = 0;

const statusOf = computed(
  () => WORK_ORDER_STATUS[wo.value?.status ?? ''] ?? { text: wo.value?.status ?? '—', type: 'default' as const },
);

function newKey(): string {
  keySeq += 1;
  return `h5-${Date.now()}-${keySeq}-${Math.random().toString(36).slice(2, 8)}`;
}

function syncForms(ops: WorkOrderOperationRow[]) {
  for (const op of ops) {
    if (!forms[op.id]) {
      forms[op.id] = { goodQty: 0, defectQty: 0, workMinutes: 0, loading: false, key: newKey() };
    }
  }
}

async function loadMyOrders() {
  if (!can('work-order:view')) return;
  try {
    const r = await listWorkOrders({ page: 1, pageSize: 5, status: 'IN_PROGRESS' });
    myOrders.value = r.list;
  } catch {
    myOrders.value = [];
  }
}

async function loadShift() {
  // 班次只用于展示；没有 shift:view 的角色直接跳过，避免无意义的 403
  if (!can('shift:view')) {
    shift.value = null;
    return;
  }
  try {
    shift.value = (await getCurrentShift(undefined, { silent: true })).shift;
  } catch {
    shift.value = null;
  }
}

async function ensureEmployees() {
  if (employees.value.length) return;
  try {
    const r = await listEmployees({ page: 1, pageSize: 200, status: 'ACTIVE' });
    employees.value = r.list;
  } catch {
    employees.value = [];
  }
}

function normalizeCode(raw: string): string {
  const s = raw.trim();
  try {
    const url = new URL(s);
    const q = url.searchParams.get('wo');
    if (q) return q;
  } catch {
    // 非 URL，按纯编码处理
  }
  return s.replace(/^wo:/i, '').split('?')[0];
}

function quickLocate(code: string) {
  codeInput.value = code;
  void locate();
}

async function locate() {
  const code = normalizeCode(codeInput.value);
  if (!code) {
    showToast('请输入工单编码');
    return;
  }
  locating.value = true;
  error.value = '';
  try {
    const r = await getWorkOrderByCode(code);
    wo.value = r.workOrder;
    operations.value = r.operations;
    syncForms(r.operations);
    await Promise.all([ensureEmployees(), loadShift()]);
    located.value = true;
  } catch {
    error.value = `工单 ${code} 不存在或当前账号无权访问`;
  } finally {
    locating.value = false;
  }
}

async function refreshLocated() {
  if (!wo.value) return;
  try {
    const r = await getWorkOrderByCode(wo.value.code);
    wo.value = r.workOrder;
    operations.value = r.operations;
    syncForms(r.operations);
  } catch {
    // 拦截器已提示
  }
}

function reset() {
  located.value = false;
  wo.value = null;
  operations.value = [];
  codeInput.value = '';
  error.value = '';
  // 清空旧工单的表单与幂等键：重新定位时生成新键，避免旧键复用
  for (const key of Object.keys(forms)) delete forms[Number(key)];
  void loadMyOrders();
}

function employeesOf(op: WorkOrderOperationRow): EmployeeRow[] {
  return employees.value.filter((e) => (op.teamId ? e.teamId === op.teamId : true));
}

function employeeLabel(op: WorkOrderOperationRow): string {
  const id = forms[op.id]?.employeeId;
  if (!id) return '请选择';
  const e = employees.value.find((x) => x.id === id);
  return e ? `${e.code} ${e.name}` : '请选择';
}

const empPicker = reactive({
  show: false,
  version: 0,
  opId: 0,
  opName: '',
  columns: [] as { text: string; value: number }[],
});

function openEmployeePicker(op: WorkOrderOperationRow) {
  const list = employeesOf(op);
  if (!list.length) {
    showToast('该工序班组暂无在职员工，请先在 Web 端维护');
    return;
  }
  empPicker.opId = op.id;
  empPicker.opName = op.operationName;
  // 当前已选员工放首位，重新打开后直接确认不会换人
  const selected = forms[op.id]?.employeeId;
  const ordered = selected
    ? [...list.filter((e) => e.id === selected), ...list.filter((e) => e.id !== selected)]
    : list;
  empPicker.columns = ordered.map((e) => ({ text: `${e.code} ${e.name}（${e.team?.name ?? ''}）`, value: e.id }));
  // 每次打开重建 Picker，默认选中首位（当前员工）
  empPicker.version += 1;
  empPicker.show = true;
}

// Vant 3 单列 Picker 的 confirm 回调是 (选中项, 索引)，不是 { selectedOptions }
function onEmployeeConfirm(picked: any) {
  const opt = Array.isArray(picked) ? picked[0] : picked;
  if (opt && opt.value != null && forms[empPicker.opId]) {
    forms[empPicker.opId].employeeId = Number(opt.value);
  }
  empPicker.show = false;
}

async function submit(op: WorkOrderOperationRow) {
  const f = forms[op.id];
  if (!f) return;
  if (f.goodQty + f.defectQty <= 0) {
    showToast('良品 + 不良必须大于 0');
    return;
  }
  if (!f.employeeId) {
    showToast('请选择报工员工');
    return;
  }
  f.loading = true;
  try {
    await createWorkReport({
      workOrderOperationId: op.id,
      employeeId: f.employeeId,
      goodQty: f.goodQty,
      defectQty: f.defectQty,
      workMinutes: f.workMinutes,
      idempotencyKey: f.key,
    });
    showSuccessToast('报工成功');
    // 成功后换幂等键；失败保留原键，允许原样重试
    f.key = newKey();
    f.goodQty = 0;
    f.defectQty = 0;
    f.workMinutes = 0;
    await refreshLocated();
  } catch {
    // 拦截器已提示
  } finally {
    f.loading = false;
  }
}

async function startOp(op: WorkOrderOperationRow) {
  startingOp.value = op.id;
  try {
    await startOperation(op.id);
    showSuccessToast('已开工');
    await refreshLocated();
  } catch {
    // 拦截器已提示
  } finally {
    startingOp.value = 0;
  }
}

function goAndon() {
  router.push({
    path: '/andon',
    query: {
      create: '1',
      wo: String(wo.value?.id ?? ''),
      wc: wo.value?.workCenterId ? String(wo.value.workCenterId) : '',
      desc: `${wo.value?.code ?? ''} ${wo.value?.material?.name ?? ''}`,
    },
  });
}

/* ---------------- 相机扫码（原生 BarcodeDetector，不引入额外依赖） ---------------- */
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
}
const BarcodeDetectorImpl = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;

const scanner = reactive({ show: false });
const videoRef = ref<HTMLVideoElement>();
let stream: MediaStream | null = null;
let raf = 0;
let detector: BarcodeDetectorLike | null = null;

async function startScan() {
  if (!BarcodeDetectorImpl) {
    showToast('当前浏览器不支持相机扫码，请手动输入工单编码');
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('当前环境无法调用摄像头');
    return;
  }
  scanner.show = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    const video = videoRef.value;
    if (!video) {
      // 弹层懒渲染时 video 可能还没挂上：必须停掉刚打开的媒体流，否则摄像头会一直占用
      stopScan();
      return;
    }
    video.srcObject = stream;
    await video.play();
    detector = new BarcodeDetectorImpl({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13'] });
    scanTick();
  } catch {
    showToast('打开摄像头失败，请检查浏览器权限或改用手动输入');
    stopScan();
  }
}

function scanTick() {
  const video = videoRef.value;
  if (!scanner.show || !video || !detector) return;
  detector
    .detect(video)
    .then((codes) => {
      const raw = codes[0]?.rawValue;
      if (raw) {
        const code = normalizeCode(raw);
        stopScan();
        codeInput.value = code;
        void locate();
        return;
      }
      raf = requestAnimationFrame(scanTick);
    })
    .catch(() => {
      raf = requestAnimationFrame(scanTick);
    });
}

function stopScan() {
  scanner.show = false;
  cancelAnimationFrame(raf);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  detector = null;
  if (videoRef.value) videoRef.value.srcObject = null;
}

onMounted(() => {
  void loadMyOrders();
  const woCode = route.query.wo;
  if (woCode) {
    codeInput.value = String(woCode);
    void locate();
  }
});

onUnmounted(stopScan);
</script>

<style scoped>
.nav-action {
  color: #fff;
  font-size: 13px;
}

.scan-hero {
  text-align: center;
  padding: 24px 16px 18px;
}

.scan-visual {
  position: relative;
  width: 108px;
  height: 108px;
  margin: 0 auto 14px;
  border-radius: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #1f4e8c;
  background: linear-gradient(160deg, #eef4fc, #e3ecf9);
}

.scan-corners {
  position: absolute;
  inset: 10px;
  border: 2px dashed rgba(31, 78, 140, 0.25);
  border-radius: 16px;
}

.scan-title {
  font-size: 16px;
}

.scan-sub {
  margin: 6px 0 16px;
}

.scan-btn {
  height: 46px;
  font-size: 15px;
}

.code-field {
  margin-top: 10px;
  padding-left: 0;
  padding-right: 0;
}

.error-text {
  margin-top: 8px;
  font-size: 12px;
}

.order-list {
  padding: 4px 14px;
}

.order-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 0;
}

.order-item + .order-item {
  border-top: 1px solid var(--line);
}

.order-main {
  min-width: 0;
}

.wo-code {
  font-size: 16px;
  font-weight: 800;
  color: #14213d;
}

.wo-material {
  margin-top: 6px;
  font-size: 15px;
  font-weight: 600;
}

.wo-meta {
  margin: 10px 0 8px;
}

.head-actions {
  margin-top: 10px;
}

.andon-btn {
  margin-top: 10px;
  height: 48px;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 2px;
}

.op-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.op-seq {
  display: inline-flex;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  align-items: center;
  justify-content: center;
  background: #e8f0fa;
  color: #1f4e8c;
  font-size: 12px;
  font-weight: 700;
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

.qty-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
  margin: 6px 0 14px;
}

.qty-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
}

.qty-label {
  font-size: 14px;
  color: #46536b;
}

.submit-btn {
  height: 44px;
}

:deep(.placeholder) {
  color: #b6bfce;
}

.scanner {
  padding: 14px 16px calc(20px + env(safe-area-inset-bottom));
}

.scanner-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 12px;
}

.video-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 3 / 4;
  max-height: 56vh;
  border-radius: 14px;
  overflow: hidden;
  background: #000;
}

.scan-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.scan-frame {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 62%;
  aspect-ratio: 1;
  transform: translate(-50%, -50%);
  border-radius: 12px;
  box-shadow: 0 0 0 2000px rgba(0, 0, 0, 0.35);
  border: 2px solid rgba(252, 163, 17, 0.9);
}

.scanner-tip {
  margin-top: 12px;
  text-align: center;
}
</style>
