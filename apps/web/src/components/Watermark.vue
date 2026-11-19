<template>
  <canvas ref="canvasRef" class="watermark-canvas" aria-hidden="true" />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useUserStore } from '@/stores/user';

/**
 * 账号名水印：固定覆盖全屏、pointer-events: none。
 * 用 canvas 绘制重复斜向文字，避免 DOM 节点过多；随窗口尺寸/账号变化重绘。
 */
const user = useUserStore();
const username = computed(() => user.user?.username ?? '');
const canvasRef = ref<HTMLCanvasElement>();
let raf = 0;

function draw() {
  const el = canvasRef.value;
  const text = username.value;
  if (!el || !text) return;
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  el.width = Math.max(1, Math.floor(w * dpr));
  el.height = Math.max(1, Math.floor(h * dpr));
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  const ctx = el.getContext('2d');
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.font = '13px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = 'rgba(90, 100, 120, 0.14)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(w / 2, h / 2);
  ctx.rotate((-20 * Math.PI) / 180);
  const stepX = 170;
  const stepY = 96;
  for (let y = -h; y <= h; y += stepY) {
    for (let x = -w; x <= w; x += stepX) {
      ctx.fillText(text, x, y);
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function scheduleDraw() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(draw);
}

watch(username, scheduleDraw);
onMounted(() => {
  draw();
  window.addEventListener('resize', scheduleDraw);
});
onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  window.removeEventListener('resize', scheduleDraw);
});
</script>

<style scoped>
.watermark-canvas {
  position: fixed;
  inset: 0;
  z-index: 900;
  width: 100%;
  height: 100%;
  pointer-events: none;
  user-select: none;
}
</style>
