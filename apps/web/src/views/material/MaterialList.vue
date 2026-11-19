<template>
  <ProTable :fetch="fetch" ref="tableRef" @reset="Object.assign(query, { keyword: '', categoryId: null, type: null })">
    <template #search>
      <el-form-item label="关键字">
        <el-input v-model="query.keyword" placeholder="编码 / 名称 / 规格" clearable maxlength="32" @keyup.enter="tableRef?.reload()" />
      </el-form-item>
      <el-form-item label="分类">
        <el-tree-select v-model="query.categoryId" :data="categoryOptions" check-strictly clearable
          placeholder="全部分类" style="width: 180px" @change="tableRef?.reload()" />
      </el-form-item>
      <el-form-item label="类型">
        <el-select v-model="query.type" clearable placeholder="全部类型" style="width: 130px" @change="tableRef?.reload()">
          <el-option v-for="(label, value) in TYPE_LABELS" :key="value" :label="label" :value="value" />
        </el-select>
      </el-form-item>
    </template>
    <template #toolbar>
      <el-button v-permission="'material:create'" type="primary" @click="openForm()">新增物料</el-button>
      <el-button v-permission="'material:import'" @click="importVisible = true">导入</el-button>
      <el-button v-permission="'material:export'" :loading="exporting" @click="onExport">导出</el-button>
    </template>
    <el-table-column prop="code" label="编码" min-width="140" sortable="custom" />
    <el-table-column prop="name" label="名称" min-width="150" sortable="custom" />
    <el-table-column prop="spec" label="规格型号" min-width="170">
      <template #default="{ row }">{{ row.spec || '—' }}</template>
    </el-table-column>
    <el-table-column label="分类" min-width="120">
      <template #default="{ row }">{{ row.category.name }}</template>
    </el-table-column>
    <el-table-column label="单位" width="90">
      <template #default="{ row }">{{ row.unit.name }}</template>
    </el-table-column>
    <el-table-column label="类型" width="90">
      <template #default="{ row }">
        <el-tag :type="row.type === 'FINISHED' ? 'success' : row.type === 'SEMI' ? 'warning' : 'info'" size="small">
          {{ TYPE_LABELS[row.type as keyof typeof TYPE_LABELS] ?? row.type }}
        </el-tag>
      </template>
    </el-table-column>
    <el-table-column prop="safetyStock" label="安全库存" width="100">
      <template #default="{ row }">{{ row.safetyStock ?? '—' }}</template>
    </el-table-column>
    <el-table-column label="状态" width="80">
      <template #default="{ row }">
        <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">{{ row.status === 1 ? '启用' : '停用' }}</el-tag>
      </template>
    </el-table-column>
    <el-table-column label="操作" width="140" fixed="right">
      <template #default="{ row }">
        <el-button v-permission="'material:update'" link type="primary" @click="openForm(row)">编辑</el-button>
        <el-button v-permission="'material:delete'" link type="danger" @click="onDelete(row)">删除</el-button>
      </template>
    </el-table-column>
  </ProTable>

  <!-- 新增/编辑物料 -->
  <el-dialog v-model="formVisible" :title="editing ? '编辑物料' : '新增物料'" width="520px" destroy-on-close>
    <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
      <el-form-item label="编码" prop="code">
        <el-input v-model="form.code" :disabled="!!editing" maxlength="32" />
        <div v-if="!editing" class="field-hint">编码创建后不可修改，被 BOM/库存引用</div>
      </el-form-item>
      <el-form-item label="名称" prop="name">
        <el-input v-model="form.name" maxlength="64" />
      </el-form-item>
      <el-form-item label="规格型号" prop="spec">
        <el-input v-model="form.spec" maxlength="128" />
      </el-form-item>
      <el-form-item label="分类" prop="categoryId">
        <el-tree-select v-model="form.categoryId" :data="categoryOptions" check-strictly style="width: 100%" />
      </el-form-item>
      <el-form-item label="单位" prop="unitId">
        <el-select v-model="form.unitId" style="width: 100%">
          <el-option v-for="u in units" :key="u.id" :label="`${u.name}（${u.code}）`" :value="u.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="类型" prop="type">
        <el-select v-model="form.type" style="width: 100%">
          <el-option v-for="(label, value) in TYPE_LABELS" :key="value" :label="label" :value="value" />
        </el-select>
      </el-form-item>
      <el-form-item label="安全库存" prop="safetyStock">
        <el-input-number v-model="form.safetyStock" :min="0" :max="99999999" :step="100" placeholder="可选" style="width: 100%" />
      </el-form-item>
      <el-form-item v-if="editing" label="状态">
        <el-switch v-model="form.status" :active-value="1" :inactive-value="0" active-text="启用" inactive-text="停用" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="formVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>

  <!-- 导入 -->
  <el-dialog v-model="importVisible" title="导入物料" width="640px" destroy-on-close @closed="importResult = null">
    <el-alert type="info" :closable="false" class="import-tip"
      title="先校验全部行再写入：有任何错误的行，整批都不导入。修正后重新上传即可。" />
    <div class="import-actions">
      <el-button @click="onDownloadTemplate">下载导入模板</el-button>
      <el-upload :auto-upload="false" :show-file-list="false" accept=".xlsx" :on-change="onFilePicked">
        <el-button type="primary" :loading="importing">选择 xlsx 文件并导入</el-button>
      </el-upload>
    </div>

    <template v-if="importResult">
      <el-alert v-if="importResult.errorCount === 0" type="success" :closable="false"
        :title="`导入成功：${importResult.successCount} 条`" class="import-tip" @close="emitImportOk" />
      <template v-else>
        <el-alert type="error" :closable="false"
          :title="`全部 ${importResult.errorCount} 行有错误，整批未导入。请修正后重新上传。`" class="import-tip" />
        <el-table :data="errorRows" size="small" max-height="260" class="import-tip">
          <el-table-column prop="rowNumber" label="行号" width="70" />
          <el-table-column prop="message" label="错误原因" min-width="280" />
        </el-table>
        <el-button class="import-tip" @click="onDownloadErrors">下载错误报告（Excel）</el-button>
      </template>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules, type UploadFile } from 'element-plus';
import ProTable from '@/components/ProTable.vue';
import {
  listMaterials, createMaterial, updateMaterial, deleteMaterial,
  downloadImportTemplate, importMaterials, exportMaterials, saveBlobResponse,
} from '@/api/material';
import { categoryTree } from '@/api/material-category';
import { unitOptions } from '@/api/unit';
import type { CategoryNode, MaterialRow, MaterialType, UnitOption } from '@mes/shared';

const TYPE_LABELS = { RAW: '原料', SEMI: '半成品', FINISHED: '成品' } as const;

const tableRef = ref<{ reload: () => void } | null>(null);
const query = reactive<{ keyword: string; categoryId: number | null; type: MaterialType | null }>({
  keyword: '', categoryId: null, type: null,
});
const fetch = (q: any) => listMaterials({
  ...q,
  keyword: query.keyword || undefined,
  categoryId: query.categoryId ?? undefined,
  type: query.type ?? undefined,
});

// ---- 参照数据：分类树 + 单位下拉 ----
const categoryOptions = ref<any[]>([]);
const units = ref<UnitOption[]>([]);

onMounted(async () => {
  try {
    const [cats, us] = await Promise.all([categoryTree(), unitOptions()]);
    categoryOptions.value = mapCategories(cats);
    units.value = us;
  } catch { /* 错误提示由 http 层统一处理 */ }
});

function mapCategories(nodes: CategoryNode[]): any[] {
  return nodes.map((n) => ({
    value: n.id,
    label: `${n.name}（${n.code}）`,
    children: n.children.length ? mapCategories(n.children) : undefined,
  }));
}

// ---- 新增/编辑 ----
const formVisible = ref(false);
const saving = ref(false);
const editing = ref<MaterialRow | null>(null);
const formRef = ref<FormInstance>();
const form = reactive<{
  code: string; name: string; spec: string; categoryId: number | null;
  unitId: number | null; type: MaterialType; safetyStock: number | null; status: number;
}>({ code: '', name: '', spec: '', categoryId: null, unitId: null, type: 'RAW', safetyStock: null, status: 1 });
const rules: FormRules = {
  code: [
    { required: true, message: '请输入编码', trigger: 'blur' },
    { pattern: /^[A-Za-z][A-Za-z0-9_-]{1,31}$/, message: '2-32 位字母开头的字母数字、下划线或连字符', trigger: 'blur' },
  ],
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  categoryId: [{ required: true, message: '请选择分类', trigger: 'change' }],
  unitId: [{ required: true, message: '请选择单位', trigger: 'change' }],
  type: [{ required: true, message: '请选择类型', trigger: 'change' }],
};

function openForm(row?: MaterialRow) {
  editing.value = row ?? null;
  form.code = row?.code ?? '';
  form.name = row?.name ?? '';
  form.spec = row?.spec ?? '';
  form.categoryId = row?.categoryId ?? null;
  form.unitId = row?.unitId ?? null;
  form.type = row?.type ?? 'RAW';
  form.safetyStock = row?.safetyStock ?? null;
  form.status = row?.status ?? 1;
  formVisible.value = true;
}

async function save() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid || form.categoryId == null || form.unitId == null) return;
  saving.value = true;
  try {
    const common = {
      name: form.name, spec: form.spec || undefined, categoryId: form.categoryId, unitId: form.unitId,
      type: form.type, safetyStock: form.safetyStock ?? undefined,
    };
    if (editing.value) {
      await updateMaterial(editing.value.id, { ...common, status: form.status });
    } else {
      await createMaterial({ code: form.code, ...common });
    }
    ElMessage.success('已保存');
    formVisible.value = false;
    tableRef.value?.reload();
  } catch {
    /* 拦截器已提示；弹窗保持打开，表单不丢，可改后重试 */
  } finally {
    saving.value = false;
  }
}

async function onDelete(row: MaterialRow) {
  try {
    await ElMessageBox.confirm(`确定删除物料「${row.name}（${row.code}）」吗？`, '删除确认', { type: 'warning' });
    await deleteMaterial(row.id);
    ElMessage.success('已删除');
    tableRef.value?.reload();
  } catch {
    /* 用户取消确认，或拦截器已提示 */
  }
}

// ---- 导入 ----
const importVisible = ref(false);
const importing = ref(false);
const importResult = ref<{ successCount: number; errorCount: number; errors: { rowNumber: number; message: string }[] } | null>(null);
const errorRows = computed(() => importResult.value?.errors ?? []);

async function onDownloadTemplate() {
  try {
    const blob = await downloadImportTemplate();
    saveBlobResponse(blob, '物料导入模板.xlsx');
  } catch { /* 拦截器已提示 */ }
}

async function onFilePicked(file: UploadFile) {
  if (!file.raw) return;
  importing.value = true;
  importResult.value = null;
  try {
    const result = await importMaterials(file.raw);
    importResult.value = result;
    if (result.errorCount === 0) {
      ElMessage.success(`导入成功 ${result.successCount} 条`);
      tableRef.value?.reload();
    }
  } catch {
    /* 拦截器已提示；错误结果面板保留上次内容 */
  } finally {
    importing.value = false;
  }
}

function emitImportOk() { /* 关闭提示后刷新在 onFilePicked 已做 */ }

// ---- 错误报告下载：前端用导入响应的 errors 生成 Excel（与后端报告同结构） ----
async function onDownloadErrors() {
  if (!importResult.value?.errors.length) return;
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('导入错误');
  ws.addRow(['物料编码', '物料名称', '规格型号', '分类编码', '单位编码', '类型', '安全库存', '错误原因']);
  for (const e of importResult.value.errors) {
    ws.addRow(['', '', '', '', '', '', '', `第 ${e.rowNumber} 行：${e.message}`]);
  }
  ws.getRow(1).font = { bold: true };
  ws.getColumn(8).font = { color: { argb: 'FFCC0000' }, bold: true };
  const buf = await wb.xlsx.writeBuffer();
  saveBlobResponse(new Blob([buf]), '物料导入错误报告.xlsx');
}

// ---- 导出 ----
const exporting = ref(false);
async function onExport() {
  exporting.value = true;
  try {
    const blob = await exportMaterials({
      keyword: query.keyword || undefined,
      categoryId: query.categoryId ?? undefined,
      type: query.type ?? undefined,
    });
    saveBlobResponse(blob, '物料导出.xlsx');
  } catch { /* 拦截器已提示 */ } finally {
    exporting.value = false;
  }
}
</script>

<style scoped>
.field-hint { font-size: 12px; color: #909399; line-height: 1.4; margin-top: 2px; }
.import-tip { margin-top: 10px; }
.import-actions { margin-top: 10px; display: flex; gap: 12px; }
</style>
