<template>
  <div class="notfound">
    <h1>404</h1>
    <p>页面不存在或已被移除</p>
    <el-button type="primary" @click="goHome">返回首页</el-button>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';

/** 兜底 404（与 Forbidden 同风格）：手输错地址 / 动态路由未注册时不再白屏 */
const router = useRouter();
function goHome() {
  void router.push('/');
}
</script>

<style scoped>
.notfound {
  height: 70vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}
.notfound h1 {
  font-size: 64px;
  color: var(--el-color-info);
  margin: 0;
}
.notfound p {
  color: var(--el-text-color-secondary);
}
</style>
