<template>
  <ProTable :fetch="fetch" ref="tableRef" @reset="Object.assign(query, { keyword: '', status: '' })">
    <template #search>
      <el-form-item label="关键字">
        <el-input v-model="query.keyword" placeholder="物料编码 / 名称 / 版本" clearable maxlength="64" @keyup.enter="tableRef?.reload()" />
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="query.status" placeholder="全部" clearable style="width: 130px">
          <el-option label="草稿 DRAFT" value="DRAFT" />
          <el-option label="生效 ACTIVE" value="ACTIVE" />
          <el-option label="已废弃 OBSOLETE" value="OBSOLETE" />
        </el-select>
      </el-form-item>
    </template>
    <template #toolbar>
      <el-button v-permission="'bom:create'" type="primary" @click="openForm()">新建 BOM</el-button>
    </template>
    <el-table-column label="父物料" min-width="170">
      <template #default="{ row }">
        <span class="mono">{{ row.material.code }}</span>
        <span class="muted">{{ row.material.name }}</span>
      </template>
    </el-table-column>
    <el-table-column prop="version" label="版本" width="170" show-overflow-tooltip />
    <el-table-column label="状态" width="110">
      <template #default="{ row }">
        <el-tag :type="statusTag(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
      </template>
    </el-table-column>
    <el-table-column label="明细" width="70">
      <template #default="{ row }">{{ row._count?.items ?? 0 }} 项</template>
    </el-table-column>
    <el-table-column label="生效期" min-width="200">
      <template #default="{ row }">{{ short(row.effectiveFrom) }} ~ {{ row.effectiveTo ? short(row.effectiveTo) : '长期' }}</template>
    </el-table-column>
    <el-table-column label="操作" width="270" fixed="right">
      <template #default="{ row }">
        <el-button v-permission="'bom:view'" link type="primary" @click="openTree(row)">树视图</el-button>
        <el-button v-permission="'bom:update'" link type="primary" @click="openItems(row)">明细</el-button>
        <el-button v-if="row.status !== 'ACTIVE'" v-permission="'bom:activate'" link type="success" @click="onActivate(row)">激活</el-button>
        <el-button v-if="row.status !== 'ACTIVE'" v-permission="'bom:delete'" link type="danger" @click="onDelete(row)">删除</el-button>
      </template>
    </el-table-column>
  </ProTable>

  <!-- 新建 BOM -->
  <el-dialog v-model="formVisible" title="新建 BOM" width="440px" destroy-on-close>
    <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
      <el-form-item label="父物料" prop="materialId">
        <el-select v-model="form.materialId" filterable remote :remote-method="searchMaterial" :loading="materialLoading" placeholder="输入编码/名称搜索" style="width: 100%">
          <el-option v-for="m in materialOptions" :key="m.id" :label="`${m.code} ${m.name}`" :value="m.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="版本" prop="version">
        <el-input v-model="form.version" maxlength="16" placeholder="如 v1" />
      </el-form-item>
      <el-form-item label="生效日期" prop="effectiveFrom">
        <el-date-picker v-model="form.effectiveFrom" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
      </el-form-item>
      <el-form-item label="失效日期">
        <el-date-picker v-model="form.effectiveTo" type="date" value-format="YYYY-MM-DD" style="width: 100%" placeholder="空 = 长期有效" />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="200" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="formVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>

  <!-- 明细批量编辑 -->
  <el-drawer v-model="itemsVisible" :title="`明细维护 · ${current?.material.name ?? ''} ${current?.version ?? ''}`" size="640px" destroy-on-close>
    <el-table :data="items" size="small">
      <el-table-column label="子件物料" min-width="180">
        <template #default="{ row }">
          <el-select v-model="row.childMaterialId" filterable remote :remote-method="searchMaterial" :loading="materialLoading" placeholder="搜索物料" style="width: 100%">
            <el-option v-for="m in materialOptions" :key="m.id" :label="`${m.code} ${m.name}`" :value="m.id" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="用量" width="120">
        <template #default="{ row }">
          <el-input-number v-model="row.qty" :min="1" :max="1000000" size="small" controls-position="right" style="width: 100%" />
        </template>
      </el-table-column>
      <el-table-column label="损耗‱" width="110">
        <template #default="{ row }">
          <el-input-number v-model="row.scrapRate" :min="0" :max="10000" size="small" controls-position="right" style="width: 100%" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="60">
        <template #default="{ $index }">
          <el-button link type="danger" :disabled="saving" @click="items.splice($index, 1)">删</el-button>
        </template>
      </el-table-column>
    </el-table>
    <div class="items-toolbar">
      <el-button size="small" @click="addItemRow">加一行</el-button>
      <el-button v-permission="'bom:update'" type="primary" size="small" :loading="saving" :disabled="current?.status === 'ACTIVE'" @click="saveItemsClick">
        保存明细
      </el-button>
      <span v-if="current?.status === 'ACTIVE'" class="muted">ACTIVE 版本明细只读，请新建版本</span>
    </div>
  </el-drawer>

  <!-- 树视图 -->
  <el-drawer v-model="treeVisible" :title="`BOM 树 · ${treeData?.bom.material.name ?? ''} ${treeData?.bom.version ?? ''}`" size="620px" destroy-on-close>
    <template v-if="treeData">
      <el-tree :data="[treeData.tree]" default-expand-all :props="{ label: 'code', children: 'children' }">
        <template #default="{ data }">
          <span class="tree-row">
            <span class="mono">{{ data.code }}</span>
            <span>{{ data.name }}</span>
            <el-tag size="small" type="info">×{{ data.qty }}</el-tag>
            <el-tag v-if="data.scrapRate" size="small" type="warning">损耗 {{ (data.scrapRate / 100).toFixed(1) }}%</el-tag>
          </span>
        </template>
      </el-tree>
      <el-divider>叶子需求汇总（共 {{ treeData.depth }} 层）</el-divider>
      <el-table :data="treeData.summary" size="small">
        <el-table-column prop="code" label="物料编码" min-width="120" />
        <el-table-column prop="name" label="名称" min-width="120" />
        <el-table-column prop="qty" label="总需求" width="100" />
      </el-table>
    </template>
  </el-drawer>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import ProTable from '@/components/ProTable.vue';
import { listBoms, getBom, getBomTree, createBom, saveBomItems, activateBom, deleteBom } from '@/api/bom';
import type { BomRow, BomItemRow, BomTreeResult } from '@mes/shared';

const tableRef = ref<{ reload: () => void } | null>(null);
const query = reactive({ keyword: '', status: '' });
const fetch = (q: any) => listBoms({ ...q, keyword: query.keyword || undefined, status: query.status || undefined });

const statusTag = (s: string) => ({ DRAFT: 'info', ACTIVE: 'success', OBSOLETE: 'danger' }[s] ?? 'info');
const statusText = (s: string) => ({ DRAFT: '草稿', ACTIVE: '生效', OBSOLETE: '已废弃' }[s] ?? s);
const short = (d: string) => (d ?? '').slice(0, 10);

// ---- 物料搜索（远程） ----
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

// ---- 新建 ----
const formVisible = ref(false);
const saving = ref(false);
const formRef = ref<FormInstance>();
const form = reactive({ materialId: undefined as number | undefined, version: 'v1', effectiveFrom: '', effectiveTo: '', remark: '' });
const rules: FormRules = {
  materialId: [{ required: true, message: '请选择父物料', trigger: 'change' }],
  version: [{ required: true, message: '请输入版本', trigger: 'blur' }],
  effectiveFrom: [{ required: true, message: '请选择生效日期', trigger: 'change' }],
};

async function openForm() {
  form.materialId = undefined;
  form.version = 'v1';
  form.effectiveFrom = new Date().toISOString().slice(0, 10);
  form.effectiveTo = '';
  form.remark = '';
  await searchMaterial('');
  formVisible.value = true;
}

async function save() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;
  saving.value = true;
  try {
    await createBom({
      materialId: form.materialId!,
      version: form.version,
      effectiveFrom: form.effectiveFrom,
      effectiveTo: form.effectiveTo || undefined,
      remark: form.remark || undefined,
    });
    ElMessage.success('已创建，接下来维护明细');
    formVisible.value = false;
    tableRef.value?.reload();
  } finally {
    saving.value = false;
  }
}

// ---- 明细维护 ----
const itemsVisible = ref(false);
const current = ref<BomRow | null>(null);
const items = ref<BomItemRow[]>([]);
const itemsRows = ref<any[]>([]);

async function openItems(row: BomRow) {
  current.value = row;
  itemsVisible.value = true;
  const detail = await getBom(row.id);
  itemsRows.value = detail.items.map((it) => ({
    childMaterialId: it.childMaterialId,
    qty: it.qty,
    scrapRate: it.scrapRate,
    position: it.position,
  }));
  await searchMaterial('');
}

function addItemRow() {
  itemsRows.value.push({ childMaterialId: undefined as unknown as number, qty: 1, scrapRate: 0 });
}

async function saveItemsClick() {
  if (!current.value) return;
  const payload = itemsRows.value.filter((r) => r.childMaterialId);
  if (!payload.length) return ElMessage.warning('至少一行有效明细');
  saving.value = true;
  try {
    await saveBomItems(current.value.id, payload);
    ElMessage.success('明细已保存');
    tableRef.value?.reload();
  } finally {
    saving.value = false;
  }
}

// ---- 激活 / 删除 ----
async function onActivate(row: BomRow) {
  await ElMessageBox.confirm(
    `激活 ${row.version} 后，该物料其他生效版本将自动置为已废弃。确定激活吗？`,
    '激活确认',
    { type: 'warning' },
  );
  await activateBom(row.id);
  ElMessage.success('已激活');
  tableRef.value?.reload();
}

async function onDelete(row: BomRow) {
  await ElMessageBox.confirm(`确定删除 BOM ${row.version} 吗？明细将一并删除。`, '删除确认', { type: 'warning' });
  await deleteBom(row.id);
  ElMessage.success('已删除');
  tableRef.value?.reload();
}

// ---- 树视图 ----
const treeVisible = ref(false);
const treeData = ref<BomTreeResult | null>(null);
async function openTree(row: BomRow) {
  treeData.value = await getBomTree(row.id);
  treeVisible.value = true;
}
</script>

<style scoped>
.mono { font-family: Consolas, monospace; font-size: 12px; margin-right: 6px; }
.muted { color: #909399; font-size: 12px; margin-left: 6px; }
.items-toolbar { margin-top: 10px; display: flex; gap: 8px; align-items: center; }
.tree-row { display: inline-flex; gap: 6px; align-items: center; }
</style>
