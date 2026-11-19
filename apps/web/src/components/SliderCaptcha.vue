<template>
  <el-dialog
    :model-value="visible"
    width="360px"
    :show-close="false"
    :close-on-click-modal="false"
    append-to-body
    class="slider-captcha-dialog"
    @update:model-value="onVisible"
    @closed="reset"
  >
    <div class="captcha-panel">
      <div class="captcha-head">
        <span class="captcha-title">安全验证</span>
        <el-icon class="captcha-close" @click="close"><Close /></el-icon>
      </div>
      <div class="captcha-tip">拖动滑块，使拼图对准缺口</div>

      <div v-if="challenge" class="captcha-stage" :style="{ width: `${challenge.width}px`, height: `${challenge.height}px` }">
        <img class="captcha-bg" :src="challenge.background" alt="" draggable="false" />
        <img
          class="captcha-piece"
          :src="challenge.piece"
          alt=""
          draggable="false"
          :style="{
            top: `${challenge.pieceTop}px`,
            left: `${offset}px`,
            width: `${challenge.pieceSize}px`,
            height: `${challenge.pieceSize}px`,
          }"
        />
      </div>
      <div v-else class="captcha-loading">加载中…</div>

      <div v-if="challenge" class="captcha-slider" :style="{ width: `${challenge.maxOffset + 44}px` }">
        <div class="captcha-fill" :style="{ width: `${offset + 22}px` }" />
        <div class="captcha-text">按住滑块拖动</div>
        <div
          class="captcha-handle"
          :style="{ transform: `translateX(${offset}px)` }"
          @pointerdown="onDown"
          @pointermove="onMove"
          @pointerup="onUp"
          @pointercancel="onUp"
        >
          <el-icon><ArrowRight /></el-icon>
        </div>
      </div>

      <div v-if="error" class="captcha-error">{{ error }}</div>

      <div class="captcha-actions">
        <el-button type="primary" :loading="loading" :disabled="!challenge || offset === 0" @click="submit">
          验证并登录
        </el-button>
        <el-button :disabled="loading" @click="close">取消</el-button>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { ArrowRight, Close } from '@element-plus/icons-vue';
import type { CaptchaChallenge } from '@/api/auth';

const props = withDefaults(
  defineProps<{
    visible: boolean;
    challenge: CaptchaChallenge | null;
    loading?: boolean;
    error?: string;
  }>(),
  { loading: false, error: '' },
);

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
  (e: 'submit', offset: number): void;
}>();

const offset = ref(0);
const dragging = ref(false);
let startX = 0;
let startOffset = 0;

watch(
  () => props.challenge?.captchaId,
  () => {
    offset.value = 0;
    dragging.value = false;
  },
);

function reset() {
  offset.value = 0;
  dragging.value = false;
}

function onVisible(value: boolean) {
  if (props.loading) return;
  emit('update:visible', value);
}

function onDown(e: PointerEvent) {
  if (props.loading || !props.challenge) return;
  e.preventDefault();
  dragging.value = true;
  startX = e.clientX;
  startOffset = offset.value;
  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
}

function onMove(e: PointerEvent) {
  if (!dragging.value || !props.challenge) return;
  const max = props.challenge.maxOffset;
  offset.value = Math.max(0, Math.min(max, startOffset + (e.clientX - startX)));
}

function onUp(e: PointerEvent) {
  if (!dragging.value) return;
  dragging.value = false;
  (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
}

function submit() {
  if (!props.challenge || offset.value <= 0 || props.loading) return;
  emit('submit', Math.round(offset.value));
}

function close() {
  if (props.loading) return;
  emit('update:visible', false);
}
</script>

<style scoped>
.captcha-panel {
  width: 100%;
}

.captcha-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.captcha-title {
  font-size: 16px;
  font-weight: 700;
  color: #1c2434;
}

.captcha-close {
  color: #9aa4b8;
  cursor: pointer;
}

.captcha-tip {
  margin: 4px 0 12px;
  font-size: 12px;
  color: #7c8698;
}

.captcha-stage {
  position: relative;
  margin: 0 auto;
  overflow: hidden;
  border-radius: 8px;
  background: #eef1f6;
}

.captcha-bg {
  display: block;
  width: 100%;
  height: 100%;
  user-select: none;
}

.captcha-piece {
  position: absolute;
  box-sizing: border-box;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}

.captcha-slider {
  position: relative;
  height: 44px;
  margin: 14px auto 0;
  overflow: hidden;
  border-radius: 8px;
  background: #eef1f6;
  user-select: none;
  touch-action: none;
}

.captcha-fill {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  border-radius: 8px;
  background: rgba(31, 78, 140, 0.16);
}

.captcha-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: #7c8698;
  pointer-events: none;
}

.captcha-handle {
  position: absolute;
  top: 0;
  left: 0;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: linear-gradient(135deg, #2a5a9e, #1f4e8c);
  color: #fff;
  cursor: grab;
  touch-action: none;
  box-shadow: 0 2px 8px rgba(31, 78, 140, 0.35);
}

.captcha-handle:active {
  cursor: grabbing;
}

.captcha-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 130px;
  color: #7c8698;
  font-size: 13px;
}

.captcha-error {
  margin-top: 10px;
  text-align: center;
  font-size: 12px;
  color: #e5484d;
}

.captcha-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
}

.captcha-actions :deep(.el-button) {
  width: 100%;
  margin-left: 0;
}
</style>
