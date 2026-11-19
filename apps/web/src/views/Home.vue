<template>
  <div class="home">
    <!-- 系统状态：健康检查（图标化） -->
    <el-card class="status-card">
      <template #header>系统状态</template>
      <el-result v-if="status === 'ok'" icon="success" title="后端连接正常" :sub-title="`数据库正常 · 服务器时间 ${time}`" />
      <el-result v-else-if="status === 'error'" icon="error" title="后端连接失败" sub-title="请确认 apps/server 已启动（npm run dev:server）" />
      <el-skeleton v-else :rows="3" animated />
    </el-card>

    <!-- 快捷入口：按当前用户权限显示（无权限的入口不出现） -->
    <el-card class="shortcuts-card">
      <template #header>快捷入口</template>
      <div class="shortcuts">
        <div v-for="s in shortcuts" :key="s.path" class="shortcut" role="link" @click="go(s.path)">
          <el-icon :size="26" :color="s.color"><component :is="s.icon" /></el-icon>
          <div class="shortcut-text">
            <div class="title">{{ s.title }}</div>
            <div class="desc">{{ s.desc }}</div>
          </div>
        </div>
      </div>
      <el-empty v-if="!shortcuts.length" description="当前角色没有可用的快捷入口" :image-size="60" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  Bell, Box, Cpu, DataLine, Document, List, Monitor, OfficeBuilding, Printer,SetUp, User,
} from '@element-plus/icons-vue';
import { fetchHealth } from '@/api/health';
import { useUserStore } from '@/stores/user';

/** 首页：系统状态 + 按权限过滤的快捷入口（图标卡片，点卡片跳转） */
const router = useRouter();
const user = useUserStore();
const status = ref<'loading' | 'ok' | 'error'>('loading');
const time = ref('');
onMounted(async () => {
  try {
    const h = await fetchHealth();
    status.value = h.status === 'ok' ? 'ok' : 'error';
    time.value = new Date(h.time).toLocaleString();
  } catch {
    status.value = 'error';
  }
});

interface Shortcut { path: string; title: string; desc: string; icon: unknown; color: string; code?: string }
const all: Shortcut[] = [
  { path: '/plan/work-orders', title: '工单列表', desc: '下达 / 开工 / 完工', icon: List, color: '#409eff', code: 'work-order:view' },
  { path: '/report', title: '车间报工', desc: '扫码定位 · 报工', icon: Document, color: '#e6a23c', code: 'work-report:create' },
  { path: '/inventory', title: '库存管理', desc: '余额 · 流水 · 领料', icon: Box, color: '#67c23a', code: 'inventory:view' },
  { path: '/inspection', title: '质量管理', desc: '检验单 · 不合格处理', icon: Cpu, color: '#f56c6c', code: 'inspection:view' },
  { path: '/equipment-status', title: '设备状态', desc: '状态切换 · 停机记录', icon: OfficeBuilding, color: '#909399', code: 'downtime:view' },
  { path: '/andon', title: '安灯呼叫', desc: '异常拉灯 · 响应', icon: Bell, color: '#f56c6c', code: 'andon:view' },
  { path: '/board', title: '车间看板', desc: '全屏实时大屏', icon: Monitor, color: '#409eff', code: 'board:view' },
  { path: '/reports/oee', title: '设备 OEE', desc: '稼动 / 性能 / 良率', icon: DataLine, color: '#67c23a', code: 'report:view' },
  { path: '/base/materials', title: '物料管理', desc: '主数据 · 导入导出', icon: SetUp, color: '#e6a23c', code: 'material:view' },
  { path: '/system/users', title: '用户管理', desc: '账号 · 角色', icon: User, color: '#909399', code: 'user:view' },
  { path: '/labels', title: '标签打印', desc: '物料 / 工单 / 批次码', icon: Printer, color: '#409eff', code: 'label:print' },
];
const shortcuts = computed(() => all.filter((s) => !s.code || user.has(s.code)));

function go(path: string) {
  void router.push(path);
}
</script>

<style scoped>
.home { display: grid; gap: 16px; }
.status-card :deep(.el-result) { padding: 24px 0; }
.shortcuts { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
.shortcut {
  display: flex; align-items: center; gap: 12px;
  border: 1px solid var(--el-border-color-lighter); border-radius: 8px;
  padding: 14px; cursor: pointer; transition: all 0.2s;
}
.shortcut:hover { border-color: var(--el-color-primary-light-5); box-shadow: var(--el-box-shadow-light); transform: translateY(-2px); }
.title { font-weight: 600; font-size: 14px; }
.desc { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 2px; }
</style>
