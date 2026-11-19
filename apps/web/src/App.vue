<template>
  <router-view />
</template>

<script setup lang="ts">
import { useIdleLogout } from '@/composables/useIdleLogout';

// 30 分钟无操作自动退出；常驻车间看板不参与，避免大屏无人操作被登出
useIdleLogout({ excludePaths: ['/board'] });
</script>
