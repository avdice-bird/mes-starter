import { onBeforeUnmount, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useUserStore } from '@/stores/user';
import { showToast } from '@/utils/toast';

const DEFAULT_IDLE_MS = 30 * 60 * 1000;
const CHECK_MS = 15 * 1000;
const PERSIST_MS = 5 * 1000;
/** 多标签页共享最近活动时间：任一标签有操作，其他标签不会被误退 */
const STORAGE_KEY = 'mes:lastActivityAt';
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;

interface IdleLogoutOptions {
  /** 无操作超时，默认 30 分钟 */
  idleMs?: number;
  /** 不参与自动退出的路由前缀（如常驻看板 /board） */
  excludePaths?: string[];
}

/**
 * 登录后无操作 30 分钟自动退出：
 * - 监听点击/键盘/滚轮/触摸/滚动，持续刷新最近活动时间
 * - 每 15s 检查一次；多标签页通过 localStorage 共享活动时间
 * - 超时调用登出接口、清理登录态并回登录页；看板等常驻页可通过 excludePaths 排除
 */
export function useIdleLogout(options: IdleLogoutOptions = {}) {
  const router = useRouter();
  const user = useUserStore();
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const excludePaths = options.excludePaths ?? [];

  let lastActivity = Date.now();
  let lastPersist = 0;
  let timer: number | undefined;
  let loggingOut = false;

  function persist(now: number) {
    if (now - lastPersist < PERSIST_MS) return;
    lastPersist = now;
    try {
      localStorage.setItem(STORAGE_KEY, String(now));
    } catch {
      // 隐私模式等场景写不进去，退化为单标签页计时
    }
  }

  function markActivity() {
    if (!user.isLoggedIn) return;
    const now = Date.now();
    lastActivity = now;
    persist(now);
  }

  function resetIdle(now = Date.now()) {
    lastActivity = now;
    lastPersist = now;
    try {
      localStorage.setItem(STORAGE_KEY, String(now));
    } catch {
      // 同上
    }
  }

  function readStoredActivity(): number {
    const value = Number(localStorage.getItem(STORAGE_KEY) || 0);
    return Number.isFinite(value) ? value : 0;
  }

  function isExcluded() {
    const path = router.currentRoute.value.path;
    return excludePaths.some((p) => path === p || path.startsWith(`${p}/`));
  }

  async function doLogout(remote = false) {
    if (loggingOut) return;
    loggingOut = true;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    const current = router.currentRoute.value;
    const redirect = current.path !== '/login' ? { redirect: current.fullPath } : {};
    try {
      await user.logout();
    } catch {
      // logout() 内部已兜底清理本地状态
    }
    showToast(remote ? '登录已退出' : '长时间未操作，已自动退出');
    await router.replace({ path: '/login', query: redirect });
    loggingOut = false;
  }

  function check() {
    if (!user.isLoggedIn || loggingOut || isExcluded()) return;
    const last = Math.max(lastActivity, readStoredActivity());
    if (Date.now() - last >= idleMs) void doLogout();
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') check();
  }

  function onStorage(event: StorageEvent) {
    // 其他标签页退出登录时清掉了活动时间：同步退出，避免一个标签已退、另一个还在用
    if (event.key === STORAGE_KEY && !event.newValue && user.isLoggedIn) void doLogout(true);
  }

  watch(
    () => user.isLoggedIn,
    (loggedIn) => {
      if (loggedIn) {
        resetIdle();
      } else {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          // ignore
        }
      }
    },
  );

  onMounted(() => {
    // 刷新页面不算“活动”：沿用上次活动时间；超过 30 分钟则加载后立即退出
    if (user.isLoggedIn) {
      const stored = readStoredActivity();
      if (stored > 0) {
        lastActivity = stored;
        lastPersist = Date.now();
      } else {
        resetIdle();
      }
    }
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, markActivity, { passive: true });
    }
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisibilityChange);
    timer = window.setInterval(check, CHECK_MS);
    check();
  });

  onBeforeUnmount(() => {
    for (const event of ACTIVITY_EVENTS) {
      window.removeEventListener(event, markActivity);
    }
    window.removeEventListener('storage', onStorage);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    if (timer) clearInterval(timer);
  });
}
