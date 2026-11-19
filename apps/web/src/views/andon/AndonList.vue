<template>
  <div class="andon-page">
    <el-card>
      <div class="toolbar">
        <h3>安灯呼叫</h3>
        <div class="filters">
          <el-select v-model="status" clearable placeholder="全部状态" style="width: 140px" @change="reload">
            <el-option label="待响应" value="OPEN" />
            <el-option label="已响应" value="RESPONDED" />
            <el-option label="已关闭" value="CLOSED" />
            <el-option label="已取消" value="CANCELLED" />
          </el-select>
          <el-button @click="reload">刷新</el-button>
          <el-button v-if="canCreate" type="danger" @click="openCreate">发起呼叫</el-button>
        </div>
      </div>

      <el-table :data="list" v-loading="loading" size="large">
        <el-table-column prop="code" label="编号" width="170" />
        <el-table-column label="类型" width="100">
          <template #default="{ row }">
            <el-tag :type="typeColor[row.type] ?? 'info'">{{ typeText[row.type] ?? row.type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="产线" width="140">
          <template #default="{ row }">{{ row.workCenter?.name ?? row.workCenterId }}</template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="220" show-overflow-tooltip />
        <el-table-column label="状态" width="150">
          <template #default="{ row }">
            <el-tag :type="statusColor[row.status] ?? 'info'" effect="dark">{{ statusText[row.status] ?? row.status }}</el-tag>
            <el-tag v-if="row.escalated" type="danger" effect="dark" class="esc-tag">已升级</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="呼叫人" width="100">
          <template #default="{ row }">{{ row.caller?.name ?? row.caller?.username }}</template>
        </el-table-column>
        <el-table-column label="响应人" width="100">
          <template #default="{ row }">{{ row.responder?.name ?? '—' }}</template>
        </el-table-column>
        <el-table-column prop="calledAt" label="呼叫时间" width="170">
          <template #default="{ row }">{{ (row.calledAt ?? '').replace('T', ' ').slice(0, 16) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="170" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 'OPEN' && canRespondTo(row)" type="warning" size="small" @click="doRespond(row)">响应</el-button>
            <el-button v-if="row.status === 'RESPONDED' && canClose" type="success" size="small" @click="openClose(row)">关闭</el-button>
            <el-button v-if="row.status === 'OPEN' && canCancelCall(row)" link size="small" @click="doCancel(row)">取消</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-pagination
        class="pager" layout="total, prev, pager, next" :total="total"
        :page-size="pageSize" :current-page="page" @current-change="onPage"
      />
    </el-card>

    <!-- 发起呼叫 -->
    <el-dialog v-model="createDialog" title="发起安灯呼叫" width="440px">
      <el-form label-width="80px">
        <el-form-item label="呼叫类型">
          <el-select v-model="createForm.type" style="width: 100%">
            <el-option label="缺料" value="MATERIAL" />
            <el-option label="设备异常" value="EQUIPMENT" />
            <el-option label="质量问题" value="QUALITY" />
            <el-option label="其他" value="OTHER" />
          </el-select>
        </el-form-item>
        <el-form-item label="产线">
          <el-select v-model="createForm.workCenterId" style="width: 100%">
            <el-option v-for="w in workCenters" :key="w.id" :label="w.name" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="设备" v-if="createForm.type === 'EQUIPMENT'">
          <el-select v-model="createForm.equipmentId" clearable style="width: 100%">
            <el-option v-for="e in equipments" :key="e.id" :label="e.name" :value="e.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="问题描述">
          <el-input v-model="createForm.description" type="textarea" :rows="3" maxlength="200" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialog = false">取消</el-button>
        <el-button type="danger" :loading="creating" @click="submitCreate">立即呼叫</el-button>
      </template>
    </el-dialog>

    <!-- 关闭 -->
    <el-dialog v-model="closeDialog" title="关闭安灯" width="440px">
      <el-form label-width="80px">
        <el-form-item label="处理结果">
          <el-input v-model="resolution" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="怎么解决的（必填）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="closeDialog = false">取消</el-button>
        <el-button type="success" :loading="closing" @click="submitClose">确认关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  listAndonCalls, respondAndon, closeAndon, cancelAndon, createAndonCall,
  type AndonRow,
} from '@/api/andon';
import { listWorkCenters, listEquipments } from '@/api/routing';
import { getDictOptions } from '@/api/dict';
import { useUserStore } from '@/stores/user';

/** 安灯列表（第 50 节）：状态机动作按权限显隐（按钮级，前端只管显隐、后端才是防线） */
const list = ref<AndonRow[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const status = ref<string | undefined>(undefined);
const loading = ref(false);

const typeText: Record<string, string> = { MATERIAL: '缺料', EQUIPMENT: '设备', QUALITY: '质量', OTHER: '其他' };
const typeColor: Record<string, string> = { MATERIAL: 'warning', EQUIPMENT: 'danger', QUALITY: 'primary', OTHER: 'info' };
const statusText: Record<string, string> = { OPEN: '待响应', RESPONDED: '已响应', CLOSED: '已关闭', CANCELLED: '已取消' };
const statusColor: Record<string, string> = { OPEN: 'danger', RESPONDED: 'warning', CLOSED: 'success', CANCELLED: 'info' };

const user = useUserStore();
const perms = computed(() => new Set(user.permissions));
const canRespond = computed(() => perms.value.has('andon:respond'));
const canClose = computed(() => perms.value.has('andon:close'));
const canCreate = computed(() => perms.value.has('andon:create'));
/** 呼叫类型 → 责任角色（字典 andon_responder_role，正本在后端） */
const responderRole = ref<Record<string, string>>({});
async function loadResponderRoles() {
  if (!canRespond.value) return;
  try {
    const opts = await getDictOptions('andon_responder_role');
    responderRole.value = Object.fromEntries(opts.map((o) => [o.value, o.label]));
  } catch {
    // 取不到字典时保守处理：只有 admin 兜底可见
  }
}
function canRespondTo(row: AndonRow) {
  if (!canRespond.value) return false;
  if (user.user?.username === 'admin') return true;
  const role = responderRole.value[row.type] ?? 'admin';
  return user.roles.includes(role);
}
/** 取消仅呼叫人（后端 andon.service.cancel 校验 callerId） */
const canCancelCall = (row: AndonRow) => canCreate.value && row.caller?.username === user.user?.username;

async function reload() {
  loading.value = true;
  try {
    const r = await listAndonCalls({ page: page.value, pageSize, status: status.value });
    list.value = r.list;
    total.value = r.total;
  } catch {
    list.value = []; total.value = 0; // 错误提示由 http 拦截器统一弹出
  } finally {
    loading.value = false;
  }
}

function onPage(p: number) {
  page.value = p;
  void reload();
}

// 响应
async function doRespond(row: AndonRow) {
  await respondAndon(row.id);
  ElMessage.success('已响应');
  void reload();
}

// 关闭
const closeDialog = ref(false);
const closing = ref(false);
const resolution = ref('');
let closeId = 0;

function openClose(row: AndonRow) {
  closeId = row.id;
  resolution.value = '';
  closeDialog.value = true;
}

async function submitClose() {
  if (resolution.value.trim().length < 2) {
    ElMessage.warning('请填写处理结果');
    return;
  }
  closing.value = true;
  try {
    await closeAndon(closeId, resolution.value.trim());
    ElMessage.success('已关闭');
    closeDialog.value = false;
    void reload();
  } catch {
    /* 拦截器已提示；弹窗保持打开，处理结果不丢，可直接重试 */
  } finally {
    closing.value = false;
  }
}

// 取消
async function doCancel(row: AndonRow) {
  const { value } = await ElMessageBox.prompt('取消原因', '取消呼叫', { inputPattern: /.{2,}/, inputErrorMessage: '至少 2 个字' });
  await cancelAndon(row.id, value);
  ElMessage.success('已取消');
  void reload();
}

// 发起
const createDialog = ref(false);
const creating = ref(false);
const workCenters = ref<{ id: number; name: string }[]>([]);
const equipments = ref<{ id: number; name: string; workCenterId: number }[]>([]);
const createForm = ref({ type: 'EQUIPMENT', workCenterId: 0, equipmentId: undefined as number | undefined, description: '' });

function openCreate() {
  if (workCenters.value.length === 0) {
    ElMessage.warning('产线数据未加载，无法发起呼叫；请刷新页面重试，或联系管理员开通产线查看权限');
    return;
  }
  createForm.value = { type: 'EQUIPMENT', workCenterId: workCenters.value[0]?.id ?? 0, equipmentId: undefined, description: '' };
  createDialog.value = true;
}

async function submitCreate() {
  if (createForm.value.description.trim().length < 2) {
    ElMessage.warning('请填写问题描述');
    return;
  }
  creating.value = true;
  try {
    const r = await createAndonCall({
      type: createForm.value.type,
      workCenterId: createForm.value.workCenterId,
      equipmentId: createForm.value.equipmentId,
      description: createForm.value.description.trim(),
    });
    ElMessage.success(r.merged ? `已合并到未关闭呼叫 ${r.code}` : `呼叫成功 ${r.code}`);
    createDialog.value = false;
    void reload();
  } catch {
    /* 拦截器已提示；弹窗保持打开，描述不丢，可直接重试 */
  } finally {
    creating.value = false;
  }
}

onMounted(async () => {
  void reload();
  void loadResponderRoles();
  // 下拉只对有对应 view 码的角色拉取（qc 只来响应/关闭，不需要产线/设备），避免挂载时弹无意义的 403；
  // 拉取失败降级空列表，openCreate 里有兜底提示。
  // 约定：守卫拉取必须写成单行 `has('码') ? 调用 : 兜底`，菜单×页面×角色一致性测试按此识别"按权限守卫"
  const wcsJob = perms.value.has('work-center:view') ? listWorkCenters({ pageSize: 50 }).catch(() => ({ list: [] })) : Promise.resolve({ list: [] });
  const eqsJob = perms.value.has('equipment:view') ? listEquipments({ pageSize: 100 }).catch(() => ({ list: [] })) : Promise.resolve({ list: [] });
  const [wcs, eqs] = await Promise.all([wcsJob, eqsJob]);
  workCenters.value = wcs.list;
  equipments.value = eqs.list;
});
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.toolbar h3 { margin: 0; }
.filters { display: flex; gap: 8px; }
.pager { margin-top: 12px; justify-content: flex-end; }
/* 同一行两个状态标签同尺寸、间距统一 */
.esc-tag { margin-left: 6px; }
</style>
