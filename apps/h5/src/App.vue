<template>
  <router-view v-slot="{ Component }">
    <transition name="fade-slide" mode="out-in">
      <component :is="Component" />
    </transition>
  </router-view>
  <Watermark v-if="showWatermark" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useUserStore } from '@/stores/user';
import Watermark from '@/components/Watermark.vue';
import { useIdleLogout } from '@/composables/useIdleLogout';

// 根组件负责页面过渡、全局账号水印与 30 分钟无操作自动退出
useIdleLogout();
const route = useRoute();
const user = useUserStore();
const showWatermark = computed(
  () => user.isLoggedIn && !route.meta.public && !!user.user?.username,
);
</script>

<style>
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.fade-slide-enter-from {
  opacity: 0;
  transform: translateX(8px);
}
.fade-slide-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}
</style>
