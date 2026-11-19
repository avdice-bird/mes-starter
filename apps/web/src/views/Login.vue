<template>
  <div class="login-page">
    <el-card class="login-card">
      <div class="login-brand">
        <div class="brand-badge">MES</div>
        <div class="login-title">制造执行系统</div>
        <div class="login-sub">Manufacturing Execution System</div>
      </div>
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @keyup.enter="submit">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" placeholder="请输入用户名" :prefix-icon="User" maxlength="50" autofocus />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="form.password" type="password" show-password placeholder="请输入密码" :prefix-icon="Lock" maxlength="72" />
        </el-form-item>
        <el-button type="primary" class="login-btn" :loading="loading" :disabled="lockRemain > 0" native-type="button" @click="submit">
          登 录
        </el-button>
      </el-form>

      <el-alert
        v-if="lockRemain > 0"
        :title="`账号已锁定，${lockCountdown} 后可重试`"
        type="error"
        :closable="false"
        show-icon
        class="lock-alert"
      />
    </el-card>

    <SliderCaptcha
      v-model:visible="captchaVisible"
      :challenge="captcha"
      :loading="captchaSubmitting"
      :error="captchaError"
      @submit="onCaptchaSubmit"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { FormInstance, FormRules } from 'element-plus';
import { ElMessage } from 'element-plus';
import { Lock, User } from '@element-plus/icons-vue';
import { useUserStore } from '@/stores/user';
import { getLoginCaptcha, type CaptchaChallenge } from '@/api/auth';
import SliderCaptcha from '@/components/SliderCaptcha.vue';

interface ApiError {
  code?: number;
  message?: string;
  details?: { lockedUntil?: string; minutes?: number };
}

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();

const formRef = ref<FormInstance>();
const loading = ref(false);
const form = reactive({ username: '', password: '' });
const rules: FormRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
};

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
  ElMessage.success('登录成功');
  // 守卫记住的回跳地址，只接受站内路径
  const redirect = String(route.query.redirect ?? '/');
  await router.push(redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/');
}

async function submit() {
  if (loading.value || captchaSubmitting.value || captchaVisible.value) return;
  if (lockRemain.value > 0) {
    ElMessage.warning(lockMessage.value || '账号已锁定，请稍后再试');
    return;
  }
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;
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
  ElMessage.error(err.message || '用户名或密码错误');
}

async function openCaptcha(message?: string) {
  captchaError.value = message ?? '';
  try {
    captcha.value = await getLoginCaptcha(form.username.trim());
    captchaVisible.value = true;
  } catch (e) {
    ElMessage.error(asError(e).message || '获取验证码失败，请重试');
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
    ElMessage.error(asError(e).message || '获取验证码失败，请重新登录');
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
    // 新挑战拿不到就结束本次弹窗流程；拿到了才继续让用户重新拖动
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
  ElMessage.error(lockMessage.value);
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
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 品牌深蓝渐变 + 底部隐约装饰光晕，替代单色平铺 */
  background:
    radial-gradient(1200px 500px at 50% -10%, rgba(252, 163, 17, 0.12), transparent 60%),
    linear-gradient(150deg, #14213d 0%, #1d2f56 55%, #14213d 100%);
}
.login-card {
  width: 380px;
  padding: 12px 16px 8px;
  border: none;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
}
.login-brand { text-align: center; margin-bottom: 20px; }
.brand-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: linear-gradient(135deg, #1d3a6d, #14213d);
  color: var(--brand-accent);
  font-weight: 800;
  font-size: 17px;
  letter-spacing: 1px;
  margin-bottom: 12px;
  box-shadow: 0 6px 16px rgba(20, 33, 61, 0.3);
}
.login-title {
  font-size: 20px;
  font-weight: 700;
  color: #14213d;
  letter-spacing: 2px;
}
.login-sub {
  font-size: 12px;
  color: #9aa4b8;
  letter-spacing: 1px;
  margin-top: 4px;
}
.login-btn {
  width: 100%;
  margin-top: 4px;
  height: 42px;
  font-size: 15px;
  letter-spacing: 6px;
}
.lock-alert {
  margin-top: 14px;
}
</style>
