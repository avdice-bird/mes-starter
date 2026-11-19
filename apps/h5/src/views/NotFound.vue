<template>
  <div class="page">
    <van-nav-bar title="页面不存在" left-arrow @click-left="router.back()" />
    <div class="page-body">
      <van-empty image="search" description="页面不存在或已被移除">
        <van-button type="primary" round class="back-btn" @click="router.replace('/')">返回工作台</van-button>
      </van-empty>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
const router = useRouter();
</script>

<style scoped>
.page-body {
  padding-top: 60px;
}
.back-btn {
  width: 160px;
}
</style>
