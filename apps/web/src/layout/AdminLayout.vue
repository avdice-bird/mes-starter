<template>
  <el-container class="layout">
    <el-aside width="220px" class="aside">
      <div class="logo">
        <div class="logo-badge">MES</div>
        <div class="logo-text">
          <div class="logo-main">制造执行系统</div>
          <div class="logo-sub">MES PLATFORM</div>
        </div>
      </div>
      <el-menu :default-active="route.path" router background-color="#14213D" text-color="#B8C2D6" active-text-color="#FCA311">
        <el-menu-item index="/"><el-icon><HomeFilled /></el-icon><span>首页</span></el-menu-item>
        <!-- 按 /me 返回的菜单树渲染：目录节点折叠，叶子节点进路由 -->
        <template v-for="m in user.menus" :key="m.id">
          <el-sub-menu v-if="m.children?.length" :index="m.path">
            <template #title>
              <el-icon v-if="m.icon"><component :is="m.icon" /></el-icon>
              <span>{{ m.name }}</span>
            </template>
            <el-menu-item v-for="c in m.children" :key="c.id" :index="c.path">
              <el-icon v-if="c.icon"><component :is="c.icon" /></el-icon>
              <span>{{ c.name }}</span>
            </el-menu-item>
          </el-sub-menu>
          <el-menu-item v-else :index="m.path">
            <el-icon v-if="m.icon"><component :is="m.icon" /></el-icon>
            <span>{{ m.name }}</span>
          </el-menu-item>
        </template>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <span class="title">{{ route.meta.title }}</span>
        <div class="header-right">
          <!-- 站内信铃铛（第 50 节）：未读数轮询；点击查看列表、标记已读 -->
          <el-popover v-if="user.permissions.includes('notification:view')" placement="bottom" :width="380" trigger="click" @show="loadNotifications">
            <template #reference>
              <el-badge :value="unread" :hidden="unread <= 0" :max="99" class="bell">
                <el-icon :size="20"><Bell /></el-icon>
              </el-badge>
            </template>
            <div class="notif-panel">
              <div v-for="n in notifications" :key="n.id" class="notif-item" :class="{ unread: !n.isRead }" @click="readNotification(n)">
                <div class="notif-title">{{ n.title }}</div>
                <div class="notif-content">{{ n.content }}</div>
                <div class="notif-time">{{ n.createdAt.replace('T', ' ').slice(0, 16) }}</div>
              </div>
              <el-empty v-if="!notifications.length" description="暂无通知" :image-size="60" />
            </div>
          </el-popover>
          <el-dropdown @command="onCommand">
            <span class="user">
              <span class="avatar">{{ avatarText }}</span>
              <span class="user-name">{{ user.user?.name ?? '未登录' }}</span>
              <el-icon><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="logout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>
      <el-main class="main"><router-view /></el-main>
    </el-container>
    <AiChat />
    <Watermark />
  </el-container>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Bell } from '@element-plus/icons-vue';
import { useUserStore } from '@/stores/user';
import { resetDynamicRoutes } from '@/router';
import { listNotifications, unreadCount, markNotificationRead, type NotificationRow } from '@/api/andon';
import AiChat from '@/components/AiChat.vue';
import Watermark from '@/components/Watermark.vue';
const route = useRoute();
const router = useRouter();
const user = useUserStore();

/** 头像缩写：名字末字或用户名首字母 */
const avatarText = computed(() => {
  const name = user.user?.name || user.user?.username || '?';
  return [...name].slice(-1)[0].toUpperCase();
});

/** 铃铛（第 50 节）：30s 轮询未读数；面板打开拉列表；点一条标一条 */
const unread = ref(0);
const notifications = ref<NotificationRow[]>([]);
let bellTimer: ReturnType<typeof setInterval> | undefined;

async function refreshUnread() {
  try {
    unread.value = (await unreadCount()).count;
  } catch { /* 未登录/403 静默 */ }
}

async function loadNotifications() {
  const r = await listNotifications({ page: 1, pageSize: 20 });
  notifications.value = r.list;
}

async function readNotification(n: NotificationRow) {
  if (n.isRead) return;
  const r = await markNotificationRead(n.id);
  n.isRead = true;
  unread.value = r.unreadCount;
}

onMounted(() => {
  if (user.permissions.includes('notification:view')) {
    void refreshUnread();
    bellTimer = setInterval(refreshUnread, 30_000);
  }
});
onBeforeUnmount(() => clearInterval(bellTimer));

async function onCommand(command: string) {
  if (command !== 'logout') return;
  await user.logout();
  resetDynamicRoutes();
  ElMessage.success('已退出登录');
  await router.push('/login');
}
</script>

<style scoped>
.layout { height: 100vh; }
.aside {
  background: linear-gradient(180deg, #14213d 0%, #182a4d 100%);
  color: #fff;
  box-shadow: 2px 0 8px rgba(20, 33, 61, 0.15);
}
/* logo 区：徽标 + 主标题，替代单行文字 */
.logo {
  height: 60px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.logo-badge {
  width: 34px; height: 34px;
  border-radius: 9px;
  background: rgba(252, 163, 17, 0.15);
  color: var(--brand-accent);
  font-weight: 800;
  font-size: 11px;
  display: flex; align-items: center; justify-content: center;
  letter-spacing: 0.5px;
  flex: none;
}
.logo-text { line-height: 1.25; }
.logo-main { font-weight: 700; color: #fff; font-size: 14px; letter-spacing: 1px; }
.logo-sub { font-size: 10px; color: rgba(184, 194, 214, 0.7); letter-spacing: 1px; }
/* 菜单项：圆角高亮与悬浮反馈（scoped 下用 :deep 穿透 el-menu 内部） */
:deep(.el-menu) { border-right: none; padding: 6px; }
:deep(.el-menu-item), :deep(.el-sub-menu__title) { border-radius: 8px; margin: 2px 0; }
:deep(.el-menu-item:hover), :deep(.el-sub-menu__title:hover) { background: rgba(255, 255, 255, 0.07) !important; }
:deep(.el-menu-item.is-active) {
  background: var(--brand-accent) !important;
  color: #14213d !important;
  font-weight: 600;
}
.header {
  display: flex; align-items: center; justify-content: space-between;
  border-bottom: 1px solid #eef1f6; background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(8px);
  height: 56px;
}
.header-right { display: flex; align-items: center; gap: 18px; }
.bell { cursor: pointer; display: inline-flex; align-items: center; color: #6b7280; transition: color 0.2s; }
.bell:hover { color: #1d3a6d; }
.notif-panel { max-height: 360px; overflow-y: auto; }
.notif-item { padding: 8px 4px; border-bottom: 1px solid #f0f0f0; cursor: pointer; border-radius: 6px; }
.notif-item.unread .notif-title { font-weight: 700; }
.notif-item.unread { background: #fdf6ec; }
.notif-title { font-size: 13px; }
.notif-content { font-size: 12px; color: #888; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.notif-time { font-size: 11px; color: #bbb; margin-top: 2px; }
.title { font-weight: 600; letter-spacing: 0.5px; }
/* 用户区：圆形头像缩写 + 名字，替代纯文字 */
.user {
  color: #6b7280; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; outline: none;
  padding: 4px 8px; border-radius: 8px; transition: background 0.2s;
}
.user:hover { background: #f0f3f8; }
.avatar {
  width: 28px; height: 28px; border-radius: 50%;
  background: linear-gradient(135deg, #1d3a6d, #14213d);
  color: #fff; font-size: 12px; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
  flex: none;
}
.user-name { font-size: 13px; }
.main { background: var(--page-bg); padding: 16px; }
</style>
