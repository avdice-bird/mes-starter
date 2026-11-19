<template>
  <div>
    <el-tabs v-model="tab" @tab-change="reloadCurrent">
      <el-tab-pane label="设备状态与停机" name="equipments">
        <ProTable :fetch="fetchEquipments" ref="eqTableRef" @reset="Object.assign(eqQuery, { keyword: '' })">
          <template #search>
            <el-form-item label="关键字">
              <el-input v-model="eqQuery.keyword" placeholder="编码 / 名称" clearable maxlength="32" @keyup.enter="eqTableRef?.reload()" />
            </el-form-item>
          </template>
          <el-table-column prop="code" label="编码" min-width="110" />
          <el-table-column prop="name" label="名称" min-width="110" />
          <el-table-column label="状态（点击切换）" width="150">
            <template #default="{ row }">
              <el-dropdown v-permission="'equipment:change-status'" trigger="click" @command="(cmd: string) => changeStatus(row, cmd)">
                <el-tag :type="statusTag(row.status)" size="small" class="status-click">
                  {{ statusText[row.status] }} ▾
                </el-tag>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item v-for="st in ['RUNNING', 'IDLE', 'FAULT', 'MAINTENANCE']" :key="st" :command="st" :disabled="st === row.status">
                      {{ statusText[st] }}
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
              <span v-if="!canChangeStatus" class="reason">{{ statusText[row.status] }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="110" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openLogs(row)">日志</el-button>
            </template>
          </el-table-column>
        </ProTable>
      </el-tab-pane>

      <el-tab-pane label="停机记录" name="downtimes">
        <ProTable :fetch="fetchDowntimes" ref="dtTableRef">
          <template #toolbar>
            <el-button v-permission="'downtime:update'" type="primary" @click="dtVisible = true">补录停机</el-button>
            <el-button v-permission="'downtime:update'" @click="generateVisible = true">生成日报</el-button>
          </template>
          <el-table-column label="设备" min-width="120">
            <template #default="{ row }">{{ row.equipment.name }}</template>
          </el-table-column>
          <el-table-column prop="reasonCode" label="原因" width="100" />
          <el-table-column label="开始" min-width="160">
            <template #default="{ row }">{{ row.startedAt.slice(0, 16).replace('T', ' ') }}</template>
          </el-table-column>
          <el-table-column label="结束" min-width="160">
            <template #default="{ row }">{{ row.endedAt ? row.endedAt.slice(0, 16).replace('T', ' ') : '未结束' }}</template>
          </el-table-column>
          <el-table-column label="时长(分)" width="90">
            <template #default="{ row }">{{ row.durationMinutes ?? '—' }}</template>
          </el-table-column>
        </ProTable>
      </el-tab-pane>

      <el-tab-pane label="设备日报" name="reports">
        <ProTable :fetch="fetchReports" ref="repTableRef" @reset="Object.assign(repQuery, { date: '' })">
          <template #search>
            <el-form-item label="日期">
              <el-date-picker v-model="repQuery.date" type="date" value-format="YYYY-MM-DD" clearable @change="repTableRef?.reload()" />
            </el-form-item>
          </template>
          <el-table-column label="设备" min-width="120">
            <template #default="{ row }">{{ row.equipment.name }}</template>
          </el-table-column>
          <el-table-column prop="date" label="日期" width="110" />
          <el-table-column prop="runningMinutes" label="运行(分)" width="100" />
          <el-table-column prop="downMinutes" label="停机(分)" width="100" />
          <el-table-column prop="downtimeCount" label="停机次数" width="100" />
          <el-table-column label="开放" width="80">
            <template #default="{ row }">
              <el-tag v-if="row.open" type="warning" size="small">有未结束停机</el-tag>
            </template>
          </el-table-column>
        </ProTable>
      </el-tab-pane>
    </el-tabs>

    <!-- 状态切换原因 -->
    <el-dialog v-model="reasonVisible" title="切换设备状态" width="380px" destroy-on-close>
      <el-form label-width="90px">
        <el-form-item label="目标状态">
          <el-tag :type="statusTag(targetStatus)">{{ statusText[targetStatus] }}</el-tag>
        </el-form-item>
        <el-form-item label="原因">
          <el-input v-model="reasonInput" type="textarea" maxlength="200" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reasonVisible = false">取消</el-button>
        <el-button type="primary" @click="doChangeStatus">确认</el-button>
      </template>
    </el-dialog>

    <!-- 状态日志抽屉 -->
    <el-drawer v-model="logsVisible" title="状态变更日志" size="420px" destroy-on-close>
      <el-timeline>
        <el-timeline-item v-for="log in logs" :key="log.id"
          :timestamp="log.changedAt.slice(0, 16).replace('T', ' ') + ' · ' + log.operatorName"
          :type="log.toStatus === 'FAULT' ? 'danger' : log.toStatus === 'RUNNING' ? 'success' : 'primary'">
          {{ statusText[log.fromStatus] }} → {{ statusText[log.toStatus] }}
          <div v-if="log.reason" class="reason">{{ log.reason }}</div>
        </el-timeline-item>
      </el-timeline>
    </el-drawer>

    <!-- 补录停机 -->
    <el-dialog v-model="dtVisible" title="补录停机" width="420px" destroy-on-close>
      <el-form label-width="90px">
        <el-form-item label="设备">
          <el-select v-model="dtForm.equipmentId" style="width: 100%">
            <el-option v-for="e in equipments" :key="e.id" :label="e.name" :value="e.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="原因">
          <el-input v-model="dtForm.reasonCode" placeholder="如 故障 / 换型 / 保养" />
        </el-form-item>
        <el-form-item label="开始">
          <el-date-picker v-model="dtForm.startedAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss[Z]" style="width: 100%" />
        </el-form-item>
        <el-form-item label="结束">
          <el-date-picker v-model="dtForm.endedAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss[Z]" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dtVisible = false">取消</el-button>
        <el-button type="primary" @click="saveDowntime">保存</el-button>
      </template>
    </el-dialog>

    <!-- 生成日报 -->
    <el-dialog v-model="generateVisible" title="生成设备日报" width="340px" destroy-on-close>
      <el-form label-width="70px">
        <el-form-item label="日期">
          <el-date-picker v-model="generateDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="generateVisible = false">取消</el-button>
        <el-button type="primary" @click="doGenerate">生成</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import ProTable from '@/components/ProTable.vue';
import { useUserStore } from '@/stores/user';
import { listEquipments } from '@/api/routing';
import {
  changeEquipmentStatus, getEquipmentStatusLogs,
  listDowntimes, createDowntime, listEquipmentReports, generateEquipmentReport,
} from '@/api/schedule';
import type { PageQuery } from '@mes/shared';

interface EquipmentStatusLogRow { id: number; fromStatus: string; toStatus: string; operatorName: string; reason: string | null; changedAt: string }

const tab = ref('equipments');
const userStore = useUserStore();
const canChangeStatus = computed(() => userStore.has('equipment:change-status'));

const eqTableRef = ref();
const dtTableRef = ref();
const repTableRef = ref();
const eqQuery = reactive({ keyword: '' });
const repQuery = reactive({ date: '' });
const equipments = ref<{ id: number; code: string; name: string; status: string }[]>([]);

const statusText: Record<string, string> = { RUNNING: '运行中', IDLE: '空闲', FAULT: '故障', MAINTENANCE: '维护中' };
const statusTag = (s: string) => ({ RUNNING: 'success', IDLE: 'info', FAULT: 'danger', MAINTENANCE: 'warning' }[s] ?? 'info');

const fetchEquipments = (q: PageQuery) => listEquipments({ ...q, keyword: eqQuery.keyword || undefined });
const fetchDowntimes = (q: PageQuery) => listDowntimes(q);
const fetchReports = (q: PageQuery) => listEquipmentReports({ ...q, date: repQuery.date || undefined });

// 状态切换
const reasonVisible = ref(false);
const targetEq = ref<{ id: number; name: string } | null>(null);
const targetStatus = ref('RUNNING');
const reasonInput = ref('');

function changeStatus(row: { id: number; name: string; status: string }, cmd: string) {
  targetEq.value = row;
  targetStatus.value = cmd;
  reasonInput.value = '';
  reasonVisible.value = true;
}

async function doChangeStatus() {
  if (!targetEq.value) return;
  await changeEquipmentStatus(targetEq.value.id, { status: targetStatus.value, reason: reasonInput.value || undefined });
  ElMessage.success(`已切换为 ${statusText[targetStatus.value]}`);
  reasonVisible.value = false;
  eqTableRef.value?.reload();
  dtTableRef.value?.reload();
}

// 日志
const logsVisible = ref(false);
const logs = ref<EquipmentStatusLogRow[]>([]);
async function openLogs(row: { id: number }) {
  logs.value = await getEquipmentStatusLogs(row.id);
  logsVisible.value = true;
}

// 补录停机
const dtVisible = ref(false);
const dtForm = reactive({ equipmentId: 0, reasonCode: '', startedAt: '', endedAt: '' });
async function saveDowntime() {
  await createDowntime({
    equipmentId: dtForm.equipmentId, reasonCode: dtForm.reasonCode,
    startedAt: dtForm.startedAt, endedAt: dtForm.endedAt || undefined,
  });
  ElMessage.success('已补录');
  dtVisible.value = false;
  dtTableRef.value?.reload();
}

// 生成日报
const generateVisible = ref(false);
const generateDate = ref(new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10));
async function doGenerate() {
  const r = await generateEquipmentReport(generateDate.value);
  ElMessage.success(`已生成 ${r.generated} 台设备日报`);
  generateVisible.value = false;
  repTableRef.value?.reload();
}

function reloadCurrent() {
  if (tab.value === 'equipments') eqTableRef.value?.reload();
  else if (tab.value === 'downtimes') dtTableRef.value?.reload();
  else repTableRef.value?.reload();
}

onMounted(async () => {
  const r = await listEquipments({ pageSize: 100 }).catch(() => ({ list: [] }));
  equipments.value = r.list;
});
</script>

<style scoped>
.status-click { cursor: pointer; }
.reason { color: #999; font-size: 12px; }
</style>
