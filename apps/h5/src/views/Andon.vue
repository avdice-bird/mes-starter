<template>
  <div class="page">
    <van-nav-bar title="安灯呼叫">
      <template #right>
        <van-icon v-if="can('andon:create')" name="plus" size="22" @click="openCreate" />
      </template>
    </van-nav-bar>

    <div class="filter-bar">
      <van-tabs v-model:active="statusTab" shrink @change="reload">
        <van-tab title="待响应" name="OPEN" />
        <van-tab title="处理中" name="RESPONDED" />
        <van-tab title="已关闭" name="CLOSED" />
        <van-tab title="全部" name="" />
      </van-tabs>
    </div>

    <div class="page-body page-body--tabbar">
      <van-pull-refresh v-model="refreshing" @refresh="reload">
        <van-list
          v-model:loading="loading"
          :finished="finished"
          :finished-text="list.length ? '没有更多了' : ''"
          @load="fetchPage"
        >
          <div v-for="a in list" :key="a.id" class="card andon-card">
            <div class="flex-between">
              <div class="flex gap-8">
                <van-tag :type="ANDON_TYPE[a.type]?.type ?? 'default'" size="medium">
                  {{ ANDON_TYPE[a.type]?.text ?? a.type }}
                </van-tag>
                <van-tag v-if="a.escalated" type="danger" plain size="medium">已升级</van-tag>
              </div>
              <van-tag :type="ANDON_STATUS[a.status]?.type ?? 'default'" effect="dark" size="medium">
                {{ ANDON_STATUS[a.status]?.text ?? a.status }}
              </van-tag>
            </div>

            <div class="andon-desc">{{ a.description }}</div>

            <div class="andon-meta">
              <span><van-icon name="cluster-o" /> {{ a.workCenter?.name ?? a.workCenterId }}</span>
              <span v-if="a.equipment"><van-icon name="setting-o" /> {{ a.equipment.name }}</span>
              <span><van-icon name="clock-o" /> {{ timeAgo(a.calledAt) }}</span>
            </div>

            <div class="andon-foot">
              <span class="muted">
                呼叫 {{ a.caller?.name ?? a.caller?.username ?? '—' }}
                <template v-if="a.responder"> · 响应 {{ a.responder.name ?? a.responder.username }}</template>
              </span>
              <div class="flex gap-8">
                <van-button
                  v-if="a.status === 'OPEN' && canRespondTo(a)"
                  type="warning"
                  size="small"
                  @click="respond(a)"
                >响应</van-button>
                <van-button
                  v-if="a.status === 'RESPONDED' && can('andon:close')"
                  type="success"
                  size="small"
                  @click="openTextDialog('close', a)"
                >关闭</van-button>
                <van-button
                  v-if="a.status === 'OPEN' && can('andon:create') && a.caller?.username === user.user?.username"
                  size="small"
                  plain
                  @click="openTextDialog('cancel', a)"
                >取消</van-button>
              </div>
            </div>

            <div v-if="a.resolution" class="resolution">
              <span class="muted">处理结果：</span>{{ a.resolution }}
            </div>
            <div v-else-if="a.cancelReason" class="resolution">
              <span class="muted">取消原因：</span>{{ a.cancelReason }}
            </div>
          </div>

          <van-empty v-if="!list.length && finished" image="search" description="暂无安灯呼叫" />
        </van-list>
      </van-pull-refresh>
    </div>

    <!-- 发起呼叫 -->
    <van-popup v-model:show="create.show" position="bottom" round :style="{ maxHeight: '90vh' }">
      <div class="create-panel">
        <div class="create-head">
          <span>发起安灯呼叫</span>
          <van-icon name="cross" size="20" @click="create.show = false" />
        </div>

        <div class="field-title">呼叫类型</div>
        <div class="type-grid">
          <button
            v-for="t in typeOptions"
            :key="t.value"
            type="button"
            class="type-btn"
            :class="{ active: create.type === t.value }"
            @click="create.type = t.value"
          >
            <van-icon :name="t.icon" size="20" />
            <span>{{ t.text }}</span>
          </button>
        </div>

        <van-cell
          title="产线"
          is-link
          :value="workCenterName"
          value-class="cell-value"
          @click="openWorkCenterPicker"
        />
        <van-cell
          v-if="create.type === 'EQUIPMENT' && can('equipment:view')"
          title="设备（选填）"
          is-link
          :value="equipmentName"
          value-class="cell-value"
          @click="openEquipmentPicker"
        />
        <van-field
          v-model="create.description"
          label="问题描述"
          type="textarea"
          rows="3"
          maxlength="200"
          show-word-limit
          placeholder="发生了什么（必填，至少 2 个字）"
          class="desc-field"
        />

        <van-button
          type="danger"
          block
          round
          class="create-submit"
          :loading="create.loading"
          @click="submitCreate"
        >立即呼叫</van-button>
        <p class="muted create-tip">同一产线同类型未关闭呼叫会自动合并，避免重复打扰</p>
      </div>
    </van-popup>

    <van-popup v-model:show="wcPicker.show" position="bottom" round>
      <van-picker
        :key="wcPicker.version"
        :columns="wcPicker.columns"
        title="选择产线"
        @confirm="onWorkCenterConfirm"
        @cancel="wcPicker.show = false"
      />
    </van-popup>

    <van-popup v-model:show="eqPicker.show" position="bottom" round>
      <van-picker
        :key="eqPicker.version"
        :columns="eqPicker.columns"
        title="选择设备"
        @confirm="onEquipmentConfirm"
        @cancel="eqPicker.show = false"
      />
    </van-popup>

    <!-- 关闭 / 取消 -->
    <van-dialog
      v-model:show="textDialog.show"
      :title="textDialog.title"
      show-cancel-button
      confirm-button-text="确认提交"
      :before-close="beforeTextClose"
    >
      <div class="dialog-body">
        <van-field
          v-model="textDialog.text"
          type="textarea"
          rows="3"
          maxlength="500"
          show-word-limit
          :placeholder="textDialog.placeholder"
        />
      </div>
    </van-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { showSuccessToast, showToast } from '@/utils/toast';
import {
  cancelAndon,
  closeAndon,
  createAndonCall,
  listAndonCalls,
  respondAndon,
  type AndonRow,
} from '@/api/andon';
import { listEquipments, listWorkCenters } from '@/api/routing';
import { getDictOptions } from '@/api/dict';
import { useUserStore } from '@/stores/user';
import { useAndonStore } from '@/stores/andon';
import { ANDON_STATUS, ANDON_TYPE, timeAgo } from '@/utils/format';

const route = useRoute();
const user = useUserStore();
const andonStore = useAndonStore();
const can = (code: string) => user.has(code);

/** 呼叫类型 → 责任角色（字典 andon_responder_role，正本在后端） */
const responderRole = ref<Record<string, string>>({});

async function loadResponderRoles() {
  if (!can('andon:respond')) return;
  try {
    const opts = await getDictOptions('andon_responder_role');
    responderRole.value = Object.fromEntries(opts.map((o) => [o.value, o.label]));
  } catch {
    // 取不到字典时保守处理：只有 admin 兜底可见
  }
}

function canRespondTo(a: AndonRow) {
  if (!can('andon:respond')) return false;
  if (user.user?.username === 'admin') return true;
  const role = responderRole.value[a.type] ?? 'admin';
  return user.roles.includes(role);
}

const PAGE_SIZE = 10;
const list = ref<AndonRow[]>([]);
const loading = ref(false);
const finished = ref(false);
const refreshing = ref(false);
const page = ref(1);
const statusTab = ref('OPEN');
let fetching = false;

async function fetchPage() {
  if (fetching || finished.value) return;
  fetching = true;
  loading.value = true;
  try {
    const r = await listAndonCalls({
      page: page.value,
      pageSize: PAGE_SIZE,
      status: statusTab.value || undefined,
    });
    list.value = page.value === 1 ? r.list : [...list.value, ...r.list];
    finished.value = r.list.length < PAGE_SIZE || list.value.length >= r.total;
    page.value += 1;
  } catch {
    finished.value = true;
  } finally {
    fetching = false;
    loading.value = false;
  }
}

async function reload() {
  page.value = 1;
  finished.value = false;
  list.value = [];
  refreshing.value = true;
  await fetchPage();
  refreshing.value = false;
}

async function respond(a: AndonRow) {
  try {
    await respondAndon(a.id);
    showSuccessToast('已响应');
    // 响应后切到“处理中”，响应人可以直接继续关闭，不用再手动找页签
    statusTab.value = 'RESPONDED';
    await Promise.all([reload(), andonStore.refresh()]);
  } catch {
    // 拦截器已提示
  }
}

/* ---------------- 关闭 / 取消的原因输入 ---------------- */
const textDialog = reactive({
  show: false,
  title: '',
  placeholder: '',
  text: '',
  kind: 'close' as 'close' | 'cancel',
  row: null as AndonRow | null,
});

function openTextDialog(kind: 'close' | 'cancel', row: AndonRow) {
  textDialog.kind = kind;
  textDialog.row = row;
  textDialog.title = kind === 'close' ? '关闭安灯' : '取消安灯';
  textDialog.placeholder = kind === 'close' ? '怎么解决的（必填）' : '取消原因（必填）';
  textDialog.text = '';
  textDialog.show = true;
}

async function beforeTextClose(action: string | 'confirm' | 'cancel'): Promise<boolean> {
  if (action !== 'confirm') return true;
  const text = textDialog.text.trim();
  if (!text) {
    showToast(textDialog.kind === 'close' ? '请填写处理结果' : '请填写取消原因');
    return false;
  }
  if (!textDialog.row) return true;
  try {
    if (textDialog.kind === 'close') await closeAndon(textDialog.row.id, text);
    else await cancelAndon(textDialog.row.id, text);
    showSuccessToast(textDialog.kind === 'close' ? '已关闭' : '已取消');
    await Promise.all([reload(), andonStore.refresh()]);
    return true;
  } catch {
    return false;
  }
}

/* ---------------- 发起呼叫 ---------------- */
const typeOptions = [
  { value: 'MATERIAL', text: '缺料', icon: 'shopping-cart-o' },
  { value: 'EQUIPMENT', text: '设备异常', icon: 'setting-o' },
  { value: 'QUALITY', text: '质量问题', icon: 'warn-o' },
  { value: 'OTHER', text: '其他', icon: 'more-o' },
];

const workCenters = ref<{ id: number; code: string; name: string }[]>([]);
const equipments = ref<{ id: number; code: string; name: string }[]>([]);

const create = reactive({
  show: false,
  type: 'EQUIPMENT',
  workCenterId: 0,
  equipmentId: 0,
  workOrderId: 0,
  description: '',
  loading: false,
});

const workCenterName = computed(() => {
  const w = workCenters.value.find((x) => x.id === create.workCenterId);
  return w ? w.name : '请选择产线';
});

const equipmentName = computed(() => {
  const e = equipments.value.find((x) => x.id === create.equipmentId);
  return e ? e.name : '不指定';
});

async function loadWorkCenters() {
  if (workCenters.value.length) return;
  try {
    const r = await listWorkCenters({ page: 1, pageSize: 100 });
    workCenters.value = r.list.map((w) => ({ id: w.id, code: w.code, name: w.name }));
  } catch {
    workCenters.value = [];
  }
}

async function loadEquipments() {
  if (!create.workCenterId) {
    equipments.value = [];
    return;
  }
  try {
    const r = await listEquipments({ page: 1, pageSize: 200, workCenterId: create.workCenterId });
    equipments.value = r.list.map((e) => ({ id: e.id, code: e.code, name: e.name }));
  } catch {
    equipments.value = [];
  }
}

const wcPicker = reactive({ show: false, version: 0, columns: [] as { text: string; value: number }[] });
const eqPicker = reactive({ show: false, version: 0, columns: [] as { text: string; value: number }[] });

function openWorkCenterPicker() {
  if (!workCenters.value.length) {
    showToast('暂无可用产线，请稍后重试');
    return;
  }
  const all = workCenters.value.map((w) => ({ text: `${w.code} ${w.name}`, value: w.id }));
  // 当前产线放首位，重新打开后直接确认不会改回第一条
  wcPicker.columns = [
    ...all.filter((o) => o.value === create.workCenterId),
    ...all.filter((o) => o.value !== create.workCenterId),
  ];
  wcPicker.version += 1;
  wcPicker.show = true;
}

/** Vant 3 单列 Picker 的 confirm 回调是 (选中项, 索引)，不是 { selectedOptions } */
function firstPicked(payload: any) {
  return Array.isArray(payload) ? payload[0] : payload;
}

function onWorkCenterConfirm(payload: any) {
  const picked = firstPicked(payload);
  if (picked && picked.value != null) {
    create.workCenterId = Number(picked.value);
    create.equipmentId = 0;
    void loadEquipments();
  }
  wcPicker.show = false;
}

function openEquipmentPicker() {
  // 始终带“不指定”，即使该产线暂无设备也允许用户进入选择器确认
  const all = [
    { text: '不指定', value: 0 },
    ...equipments.value.map((e) => ({ text: `${e.code} ${e.name}`, value: e.id })),
  ];
  // 当前设备放首位，重新打开后直接确认不会丢选择
  eqPicker.columns = [
    ...all.filter((o) => o.value === create.equipmentId),
    ...all.filter((o) => o.value !== create.equipmentId),
  ];
  eqPicker.version += 1;
  eqPicker.show = true;
}

function onEquipmentConfirm(payload: any) {
  const picked = firstPicked(payload);
  if (picked && picked.value != null) create.equipmentId = Number(picked.value);
  eqPicker.show = false;
}

async function openCreate() {
  if (!can('andon:create')) return;
  await loadWorkCenters();
  if (!create.workCenterId && workCenters.value.length) {
    create.workCenterId = workCenters.value[0].id;
    void loadEquipments();
  }
  create.show = true;
}

async function submitCreate() {
  if (!create.workCenterId) {
    showToast('请选择产线');
    return;
  }
  if (create.description.trim().length < 2) {
    showToast('请填写问题描述（至少 2 个字）');
    return;
  }
  create.loading = true;
  try {
    const r = await createAndonCall({
      type: create.type,
      workCenterId: create.workCenterId,
      equipmentId: create.type === 'EQUIPMENT' && create.equipmentId ? create.equipmentId : undefined,
      workOrderId: create.workOrderId || undefined,
      description: create.description.trim(),
    });
    showSuccessToast(r.merged ? '已合并到未关闭呼叫' : `呼叫成功 ${r.code}`);
    create.show = false;
    create.description = '';
    create.workOrderId = 0;
    void andonStore.refresh();
    if (statusTab.value && statusTab.value !== 'OPEN') {
      // 切回待响应页签，@change 会触发刷新
      statusTab.value = 'OPEN';
    } else {
      await reload();
    }
  } catch {
    // 拦截器已提示；弹窗保持打开
  } finally {
    create.loading = false;
  }
}

onMounted(async () => {
  void loadResponderRoles();
  if (!can('andon:create')) return;
  await loadWorkCenters();
  if (route.query.create === '1') {
    const wc = Number(route.query.wc);
    if (wc && workCenters.value.some((w) => w.id === wc)) create.workCenterId = wc;
    const wo = Number(route.query.wo);
    if (wo) create.workOrderId = wo;
    if (route.query.desc) create.description = String(route.query.desc);
    if (create.workCenterId) await loadEquipments();
    create.show = true;
  }
});
</script>

<style scoped>
.filter-bar {
  position: sticky;
  top: calc(46px + env(safe-area-inset-top));
  z-index: 15;
  background: #fff;
  box-shadow: 0 4px 12px rgba(20, 33, 61, 0.04);
}

.filter-bar :deep(.van-tabs__wrap) {
  height: 42px;
}

.andon-card {
  margin-bottom: 12px;
}

.andon-desc {
  margin: 10px 0 8px;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.55;
}

.andon-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 12px;
  color: #7c8698;
}

.andon-meta .van-icon {
  margin-right: 2px;
}

.andon-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}

.resolution {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f6f8fc;
  font-size: 12px;
  color: #46536b;
}

.create-panel {
  padding: 16px 16px calc(18px + env(safe-area-inset-bottom));
}

.create-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 14px;
}

.field-title {
  font-size: 13px;
  color: #7c8698;
  margin: 4px 0 8px;
}

.type-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 10px;
}

.type-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 12px 4px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #fafbfd;
  color: #52607a;
  font-size: 12px;
  transition: background-color 0.14s ease, border-color 0.14s ease, transform 0.1s ease;
}

.type-btn:active {
  background: var(--van-active-color);
  transform: scale(0.96);
}

.type-btn.active {
  border-color: #e5484d;
  background: #fdecec;
  color: #d93a3f;
  font-weight: 600;
}

.create-panel :deep(.van-cell) {
  padding-left: 0;
  padding-right: 0;
}

.cell-value {
  color: #1c2434;
}

.desc-field {
  padding-left: 0;
  padding-right: 0;
  margin-top: 4px;
}

.create-submit {
  height: 46px;
  margin-top: 16px;
  font-size: 15px;
  letter-spacing: 1px;
}

.create-tip {
  margin-top: 10px;
  text-align: center;
}

.dialog-body {
  padding: 8px 16px 16px;
}
</style>
