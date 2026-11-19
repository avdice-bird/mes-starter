import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import AdminLayout from '@/layout/AdminLayout.vue';
import { useUserStore } from '@/stores/user';
import type { MenuNode } from '@mes/shared';

/**
 * 静态路由：登录页、布局与首页。
 * 动态路由：登录/刷新页面后按 /me 返回的菜单树 addRoute 生成（见 registerDynamicRoutes）。
 */
export const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: () => import('@/views/Login.vue'), meta: { title: '登录', public: true } },
  {
    path: '/',
    name: 'layout',
    component: AdminLayout,
    children: [
      { path: '', name: 'home', component: () => import('@/views/Home.vue'), meta: { title: '首页' } },
    ],
  },
  { path: '/403', name: 'forbidden', component: () => import('@/views/Forbidden.vue'), meta: { public: true } },
  // 车间看板：大屏全屏页，不走 AdminLayout（侧边栏会挤掉看板宽度）；需登录且要有 board:view
  { path: '/board', name: 'board', component: () => import('@/views/board/Board.vue'), meta: { title: '车间看板', permissionCode: 'board:view' } },
  // 兜底 404：不标 public——登录后刷新动态页会先命中这里，守卫需继续走"注册动态路由再重定向"；
  // 未登录访问未知地址由守卫转登录页
  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/views/NotFound.vue'), meta: { title: '页面不存在' } },
];

const router = createRouter({ history: createWebHistory(), routes });

/** 菜单组件路径 → 真实模块。约定：menu.component 相对 src/views，如 user/UserList */
const viewModules = import.meta.glob('../views/**/*.vue');

/** 已注册的动态路由名，防止刷新/重复导航时重复 addRoute */
let dynamicRegistered = false;
export function resetDynamicRoutes() {
  dynamicRegistered = false;
}

/** 把菜单树里的叶子节点注册为布局下的动态路由；全屏页（/board）有静态路由，跳过避免双份 */
const FULLSCREEN_PATHS = new Set(['/board']);

export function registerDynamicRoutes(menus: MenuNode[]) {
  if (dynamicRegistered) return;
  const walk = (nodes: MenuNode[]) => {
    for (const m of nodes) {
      if (m.component && !FULLSCREEN_PATHS.has(m.path)) {
        const module = viewModules[`../views/${m.component}.vue`];
        if (!module) {
          // 组件路径写错了：开发期直接暴露问题，而不是静默 404
          console.warn(`[router] 菜单 ${m.path} 的组件不存在: views/${m.component}.vue`);
        }
        router.addRoute('layout', {
          path: m.path,
          name: `menu-${m.id}`,
          component: module ?? (() => import('@/views/Forbidden.vue')),
          meta: { title: m.name, permissionCode: m.permissionCode ?? undefined },
        });
      }
      if (m.children?.length) walk(m.children);
    }
  };
  walk(menus);
  dynamicRegistered = true;
}

// 守卫：未登录跳登录页并记住回跳地址；已登录则先恢复用户信息与动态路由
router.beforeEach(async (to) => {
  document.title = `${(to.meta.title as string) ?? ''} · MES`;
  const userStore = useUserStore();
  if (to.meta.public) {
    if (to.name === 'login' && userStore.isLoggedIn) return { path: '/' };
    return true;
  }
  if (!userStore.isLoggedIn) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }
  if (!userStore.user || !userStore.permissions.length) {
    try {
      await userStore.fetchMe();
      resetDynamicRoutes();
    } catch {
      // access token 失效且恢复失败：拦截器已尝试 refresh，这里兜底回登录页
      await userStore.logout();
      return { path: '/login', query: { redirect: to.fullPath } };
    }
  }
  const before = dynamicRegistered;
  registerDynamicRoutes(userStore.menus);
  // 刷新页面直接进菜单页时，`to` 在动态路由注册前就已解析——会命中通配 404，
  // 注册完成后重定向一次让真实路由命中（第二次 pass 时 before=true，不再循环；
  // 地址本身不存在则第二次仍落 404 页）
  const hitFallback = to.matched.some((r) => r.name === 'not-found');
  if (!before && hitFallback) return { path: to.fullPath, replace: true };
  // 路由级权限：菜单绑了权限码而当前用户没有 → 403（与 v-permission 双保险）
  const code = to.meta.permissionCode as string | undefined;
  if (code && !userStore.has(code)) return { path: '/403' };
  return true;
});

export default router;
