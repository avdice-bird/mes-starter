<template>
  <div class="login-page">
    <div class="brand">
      <div class="brand-badge">MES</div>
      <div class="brand-title">制造执行系统</div>
      <div class="brand-sub">Manufacturing Execution System · 移动端</div>
    </div>

    <div class="login-card">
      <van-form @submit="submit">
        <van-cell-group inset>
          <van-field
            v-model="form.username"
            name="username"
            label="账号"
            placeholder="请输入用户名"
            left-icon="user-o"
            clearable
            autocomplete="username"
            :rules="[{ required: true, message: '请输入用户名' }]"
          />
          <van-field
            v-model="form.password"
            name="password"
            label="密码"
            type="password"
            placeholder="请输入密码"
            left-icon="lock"
            autocomplete="current-password"
            :rules="[{ required: true, message: '请输入密码' }]"
          />
        </van-cell-group>

        <div class="submit-wrap">
          <van-button
            round
            block
            type="primary"
            native-type="submit"
            :loading="loading"
            :disabled="lockRemain > 0"
            loading-text="登录中…"
          >
            登 录
          </van-button>
        </div>
      </van-form>

      <div v-if="lockRemain > 0" class="lock-box">
        <van-icon name="lock" size="16" />
        <span>账号已锁定，{{ lockCountdown }} 后可重试</span>
      </div>

      <p class="tip">车间现场请使用个人账号登录，操作记录将写入审计日志</p>
    </div>

    <SliderCaptcha
      v-model:show="captchaVisible"
      :challenge="captcha"
      :loading="captchaSubmitting"
      :error="captchaError"
      @submit="onCaptchaSubmit"
    />

    <div class="footer safe-bottom">MES · 电子装配车间</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showSuccessToast, showToast } from '@/utils/toast';
import { useUserStore } from '@/stores/user';
import { getLoginCaptcha, type CaptchaChallenge } from '@/api/auth';
import SliderCaptcha from '@/components/SliderCaptcha.vue';

interface ApiError {
  code?: number;
  message?: string;
  details?: { lockedUntil?: string; minutes?: number };
}

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();

const loading = ref(false);
const form = reactive({ username: '', password: '' });

const captchaVisible = ref(false);
const captcha = ref<CaptchaChallenge | null>(null);
const captchaSubmitting = ref(false);
const captchaError = ref('');
const lockMessage = ref('');
const lockRemain = ref(0);
let lockTimer: number | undefined;

const lockCountdown = computed(() => {
  const m = Math.floor(lockRemain.value / 60);
  const s = lockRemain.value % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
});

function asError(e: unknown): ApiError {
  return (e ?? {}) as ApiError;
}

async function afterLogin() {
  showSuccessToast('登录成功');
  const redirect = String(route.query.redirect ?? '/');
  await router.replace(redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/');
}

async function submit() {
  if (loading.value || captchaSubmitting.value || captchaVisible.value) return;
  if (lockRemain.value > 0) {
    showToast(lockMessage.value || '账号已锁定，请稍后再试');
    return;
  }
  loading.value = true;
  try {
    await userStore.login(form.username.trim(), form.password);
    await afterLogin();
  } catch (e) {
    await handleLoginError(asError(e));
  } finally {
    loading.value = false;
  }
}

async function handleLoginError(err: ApiError) {
  if (err.code === 1010) {
    await openCaptcha(err.message);
    return;
  }
  if (err.code === 1009) {
    startLock(err);
    return;
  }
  showToast(err.message || '用户名或密码错误');
}

async function openCaptcha(message?: string) {
  captchaError.value = message ?? '';
  try {
    captcha.value = await getLoginCaptcha(form.username.trim());
    captchaVisible.value = true;
  } catch (e) {
    showToast(asError(e).message || '获取验证码失败，请重试');
  }
}

/** 刷新挑战：失败时清空已作废的 captchaId 并关闭弹窗，避免用死 id 反复提交陷入 1010 循环 */
async function refreshCaptcha(): Promise<boolean> {
  try {
    captcha.value = await getLoginCaptcha(form.username.trim());
    return true;
  } catch (e) {
    captcha.value = null;
    captchaVisible.value = false;
    showToast(asError(e).message || '获取验证码失败，请重新登录');
    return false;
  }
}

async function onCaptchaSubmit(offset: number) {
  if (!captcha.value) return;
  captchaSubmitting.value = true;
  try {
    await userStore.login(form.username.trim(), form.password, {
      captchaId: captcha.value.captchaId,
      captchaOffset: offset,
    });
    captchaVisible.value = false;
    await afterLogin();
  } catch (e) {
    const err = asError(e);
    if (err.code === 1009) {
      captchaVisible.value = false;
      startLock(err);
      return;
    }
    captchaError.value = err.message || '验证未通过，请重试';
    await refreshCaptcha();
  } finally {
    captchaSubmitting.value = false;
  }
}

function startLock(err: ApiError) {
  const until = err.details?.lockedUntil
    ? new Date(err.details.lockedUntil).getTime()
    : Date.now() + 15 * 60 * 1000;
  lockMessage.value = err.message || '账号已锁定，请 15 分钟后再试';
  lockRemain.value = Math.max(0, Math.ceil((until - Date.now()) / 1000));
  showToast(lockMessage.value);
  clearInterval(lockTimer);
  lockTimer = window.setInterval(() => {
    lockRemain.value = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    if (lockRemain.value <= 0) {
      clearInterval(lockTimer);
      lockMessage.value = '';
    }
  }, 1000);
}

onUnmounted(() => clearInterval(lockTimer));
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 20px;
  background:
    radial-gradient(600px 300px at 85% -10%, rgba(252, 163, 17, 0.28), transparent 65%),
    linear-gradient(160deg, #14213d 0%, #1d3560 58%, #0f1a31 100%);
}

.brand {
  margin-top: calc(76px + env(safe-area-inset-top));
  text-align: center;
  color: #fff;
}

.brand-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: 18px;
  background: linear-gradient(135deg, #2a4a7f, #14213d);
  color: var(--brand-accent);
  font-size: 19px;
  font-weight: 800;
  letter-spacing: 1px;
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.35);
}

.brand-title {
  margin-top: 16px;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 4px;
}

.brand-sub {
  margin-top: 6px;
  font-size: 11px;
  letter-spacing: 0.5px;
  color: rgba(255, 255, 255, 0.55);
}

.login-card {
  width: 100%;
  max-width: 420px;
  margin-top: 44px;
}

.login-card :deep(.van-cell-group--inset) {
  margin: 0;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.26);
}

.login-card :deep(.van-field__label) {
  width: 42px;
  color: #52607a;
  font-weight: 600;
}

.login-card :deep(.van-field) {
  padding-top: 14px;
  padding-bottom: 14px;
}

.submit-wrap {
  margin-top: 26px;
}

.submit-wrap :deep(.van-button) {
  height: 48px;
  font-size: 16px;
  letter-spacing: 6px;
  box-shadow: 0 10px 22px rgba(31, 78, 140, 0.4);
}

.lock-box {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 14px 4px 0;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(229, 72, 77, 0.35);
  background: rgba(229, 72, 77, 0.16);
  color: #ffd7d8;
  font-size: 12px;
}

.tip {
  margin: 18px 8px 0;
  text-align: center;
  font-size: 11px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.42);
}

.footer {
  margin-top: auto;
  padding: 24px 0 18px;
  font-size: 11px;
  letter-spacing: 1px;
  color: rgba(255, 255, 255, 0.28);
}
</style>
