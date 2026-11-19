<template>
  <div class="page">
    <van-nav-bar :title="title" left-arrow @click-left="back">
      <template #right>
        <slot name="right" />
      </template>
    </van-nav-bar>
    <div class="page-body">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';

defineProps<{ title: string }>();
const router = useRouter();

function back() {
  if (window.history.length > 1) router.back();
  else router.replace('/');
}
</script>
