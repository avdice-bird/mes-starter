<template>
  <div class="tabbar-layout">
    <!-- Tab 页缓存：列表 → 详情 → 返回时保留已加载数据与滚动位置；Tab 切换也保留各自状态。
         详情路由是本布局的子路由（meta.hideTabbar），布局不会卸载，缓存才有效；
         详情页不带缓存，保证切换到另一张工单时重新拉取数据。 -->
    <router-view v-slot="{ Component }">
      <transition name="fade-slide" mode="out-in">
        <keep-alive :exclude="['WorkOrderDetail']">
          <component :is="Component" />
        </keep-alive>
      </transition>
    </router-view>
    <van-tabbar v-if="showTabbar" route fixed placeholder safe-area-inset-bottom>
      <van-tabbar-item replace :to="{ name: 'home' }" icon="wap-home-o">工作台</van-tabbar-item>
      <van-tabbar-item
        v-if="can('work-order:view')"
        replace
        :to="{ name: 'work-orders' }"
        icon="orders-o"
      >工单</van-tabbar-item>
      <van-tabbar-item
        v-if="can('work-report:create')"
        replace
        :to="{ name: 'report' }"
        icon="scan"
      >报工</van-tabbar-item>
      <van-tabbar-item
        v-if="can('andon:view')"
        replace
        :to="{ name: 'andon' }"
        icon="bulb-o"
      >
        安灯
        <template #icon>
          <van-badge :content="andonStore.openCount" :show-zero="false" :max="99">
            <van-icon name="bulb-o" size="22" />
          </van-badge>
        </template>
      </van-tabbar-item>
      <van-tabbar-item replace :to="{ name: 'mine' }" icon="user-o">我的</van-tabbar-item>
    </van-tabbar>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useUserStore } from '@/stores/user';
import { useAndonStore } from '@/stores/andon';

const route = useRoute();
const user = useUserStore();
const andonStore = useAndonStore();
const can = (code: string) => user.has(code);
// 详情等子页面隐藏底部 Tabbar（仍共享布局，从而保住列表缓存）
const showTabbar = computed(() => !route.meta.hideTabbar);

onMounted(() => {
  if (user.has('andon:view')) void andonStore.refresh();
});
</script>

<style scoped>
.tabbar-layout {
  min-height: 100vh;
}
</style>
