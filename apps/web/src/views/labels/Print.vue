<template>
  <div class="print-page">
    <!-- 打印页自身不进 @media print，只有标签区被打印 -->
    <div class="no-print controls">
      <h2>标签打印</h2>
      <el-form inline>
        <el-form-item label="类型">
          <el-radio-group v-model="kind" @change="onKindChange">
            <el-radio-button value="lot">批次</el-radio-button>
            <el-radio-button value="work-order">工单</el-radio-button>
            <el-radio-button value="material">物料</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item>
          <el-select v-model="selected" multiple collapse-tags collapse-tags-tooltip placeholder="选择要打印的标签" style="width: 420px">
            <el-option v-for="c in candidates" :key="c.value" :label="c.label" :value="c.value" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :disabled="!selected.length || loading" :loading="loading" @click="load">生成标签</el-button>
          <el-button type="success" :disabled="!labels.length" @click="print">打印（{{ labels.length }} 张）</el-button>
        </el-form-item>
      </el-form>
    </div>

    <el-empty v-if="!labels.length" description="选择并生成标签后开始打印" class="no-print" />
    <!-- 标签区：60×40mm × 每行 3 张；qr 由后端约定内容经前端渲染 -->
    <div class="sheet">
      <div v-for="l in labels" :key="l.qr" class="label">
        <img :src="qrDataUrl(l.qr)" class="qr" :alt="l.qr" />
        <div class="meta">
          <div class="code">{{ l.code }}</div>
          <div class="name">{{ l.name }}</div>
          <div class="row"><span>{{ l.qtyLabel }}：{{ l.qty }}</span><span>{{ l.date }}</span></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import QRCode from 'qrcode';
import { getLabelBatch, type LabelData } from '@/api/labels';
import { listLotsForLabels, listWorkOrdersForLabels, listMaterialsForLabels } from '@/api/labels';

/** 标签打印（第 55 节）：60×40mm 固定尺寸 + @media print；批量一页多标签。 */
type Kind = 'lot' | 'work-order' | 'material';
const kind = ref<Kind>('lot');
const candidates = ref<{ value: number | string; label: string }[]>([]);
const selected = ref<(number | string)[]>([]);
const labels = ref<LabelData[]>([]);
const loading = ref(false);

const qrDataUrl = (text: string): string => {
  // 同步缓存：load 时已预热；兜底空白。
  // reactive Map：warmQr 异步写入后能触发依赖本函数的重渲染（普通 Map 不会——首次生成会全是空白码）
  return qrCache.get(text) ?? '';
};
const qrCache = reactive(new Map<string, string>());
async function warmQr(texts: string[]) {
  for (const t of texts) {
    if (!qrCache.has(t)) qrCache.set(t, await QRCode.toDataURL(t, { width: 120, margin: 0 }));
  }
}

function onKindChange() {
  selected.value = [];
  labels.value = [];
  void loadCandidates();
}

async function loadCandidates() {
  candidates.value = await (kind.value === 'lot'
    ? listLotsForLabels()
    : kind.value === 'work-order' ? listWorkOrdersForLabels() : listMaterialsForLabels());
}

async function load() {
  if (!selected.value.length) return;
  loading.value = true;
  try {
    labels.value = await getLabelBatch(kind.value, selected.value);
    if (!labels.value.length) ElMessage.warning('所选条目均无有效数据');
    await warmQr(labels.value.map((l) => l.qr));
  } finally {
    loading.value = false;
  }
}

function print() {
  window.print();
}

onMounted(loadCandidates);
</script>

<style scoped>
.print-page { max-width: 1080px; }
.controls { margin-bottom: 16px; }
/* 屏幕：60×40mm 标签（约 227×151px @96dpi），一行 3 张 */
.sheet { display: flex; flex-wrap: wrap; gap: 8mm; }
.label {
  width: 60mm; height: 40mm; box-sizing: border-box;
  border: 1px dashed #bbb; padding: 2mm;
  display: flex; gap: 2mm; background: #fff; color: #000;
}
.qr { width: 20mm; height: 20mm; }
.meta { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: space-between; }
.code { font-size: 9pt; font-weight: 700; word-break: break-all; }
.name { font-size: 8pt; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.row { font-size: 7pt; display: flex; justify-content: space-between; }

/* 打印：只打标签区，一行 3 张、去边框底色 */
@media print {
  .no-print { display: none !important; }
  .sheet { gap: 4mm; }
  .label { border: none; break-inside: avoid; }
  body * { visibility: hidden; }
  .sheet, .sheet * { visibility: visible; }
  .sheet { position: absolute; left: 0; top: 0; width: 100%; }
}
</style>
