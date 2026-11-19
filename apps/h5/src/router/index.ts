import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useUserStore } from '@/stores/user';

/**
 * 移动端路由：底部 Tabbar 四个一级页 + 独立详情/功能页。
 * 权限通过 meta.permissionCode 控制，页面内按钮再按权限码二次显隐。
 */
export const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/Login.vue'),
    meta: { title: '登录', public: true },
  },
  {
    path: '/',
    component: () => import('@/layout/TabbarLayout.vue'),
    children: [
      {
        path: '',
        name: 'home',
        component: () => import('@/views/Home.vue'),
        meta: { title: '工作台' },
      },
      {
        path: 'work-orders',
        name: 'work-orders',
        component: () => import('@/views/WorkOrderList.vue'),
        meta: { title: '工单', permissionCode: 'work-order:view' },
      },
      {
        // 详情放在 Tab 布局的子路由里：布局不卸载，配合 keep-alive 才能返回时保留列表与滚动位置
        path: 'work-orders/:id',
        name: 'work-order-detail',
        component: () => import('@/views/WorkOrderDetail.vue'),
        meta: { title: '工单详情', permissionCode: 'work-order:view', hideTabbar: true },
      },
      {
        path: 'report',
        name: 'report',
        component: () => import('@/views/Report.vue'),
        meta: { title: '扫码报工', permissionCode: 'work-report:create' },
      },
      {
        path: 'andon',
        name: 'andon',
        component: () => import('@/views/Andon.vue'),
        meta: { title: '安灯', permissionCode: 'andon:view' },
      },
      {
        path: 'mine',
        name: 'mine',
        component: () => import('@/views/Mine.vue'),
        meta: { title: '我的' },
      },
    ],
  },
  {
    path: '/notifications',
    name: 'notifications',
    component: () => import('@/views/Notifications.vue'),
    meta: { title: '消息通知', permissionCode: 'notification:view' },
  },
  {
    path: '/inventory',
    name: 'inventory',
    component: () => import('@/views/Inventory.vue'),
    meta: { title: '库存查询', permissionCode: 'inventory:view' },
  },
  {
    path: '/inspections',
    name: 'inspections',
    component: () => import('@/views/Inspection.vue'),
    meta: { title: '质检任务', permissionCode: 'inspection:view' },
  },
  {
    path: '/403',
    name: 'forbidden',
    component: () => import('@/views/Forbidden.vue'),
    meta: { title: '无权限', public: true },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFound.vue'),
    meta: { title: '页面不存在', public: true },
  },
];

const PAGE_TRANSITION_MS = 180;

const router = createRouter({
  history: createWebHistory(),
  routes,
  // 前进/新页面回到顶部；浏览器返回（含左箭头 router.back、手势返回）恢复离开时的滚动位置。
  // 页面切换有 180ms 过渡，等缓存页重新挂载、高度恢复后再滚，否则目标位置还不存在。
  scrollBehavior(_to, _from, savedPosition) {
    if (savedPosition) {
      return new Promise((resolve) =>
        setTimeout(() => resolve(savedPosition), PAGE_TRANSITION_MS + 80),
      );
    }
    return { top: 0 };
  },
});

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

  if (!userStore.user) {
    try {
      await userStore.fetchMe();
    } catch {
      await userStore.logout();
      return { path: '/login', query: { redirect: to.fullPath } };
    }
  }

  const code = to.meta.permissionCode as string | undefined;
  if (code && !userStore.has(code)) return { path: '/403' };
  return true;
});

export default router;
