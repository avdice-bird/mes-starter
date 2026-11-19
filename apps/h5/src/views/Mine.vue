<template>
  <div class="page">
    <div class="hero mine-hero">
      <div class="flex gap-12">
        <div class="avatar-big">{{ user.displayName.slice(0, 1) }}</div>
        <div class="mine-info">
          <div class="hero-title">{{ user.displayName }}</div>
          <div class="hero-sub">@{{ user.user?.username }} · {{ roleText }}</div>
        </div>
      </div>
      <div class="mine-stats">
        <div class="stat">
          <div class="stat-value">{{ user.roles.length }}</div>
          <div class="stat-label">角色</div>
        </div>
        <div class="stat">
          <div class="stat-value">{{ user.permissions.length }}</div>
          <div class="stat-label">权限点</div>
        </div>
        <div class="stat">
          <div class="stat-value">{{ unread }}</div>
          <div class="stat-label">未读消息</div>
        </div>
      </div>
    </div>

    <div class="page-body page-body--tabbar mine-body">
      <van-cell-group inset class="menu-group">
        <van-cell
          v-if="can('notification:view')"
          title="消息通知"
          icon="bell"
          is-link
          :value="unread ? `${unread} 条未读` : ''"
          @click="router.push('/notifications')"
        />
        <van-cell
          v-if="can('work-order:view')"
          title="生产工单"
          icon="orders-o"
          is-link
          @click="router.push('/work-orders')"
        />
        <van-cell
          v-if="can('andon:view')"
          title="安灯呼叫"
          icon="bulb-o"
          is-link
          @click="router.push('/andon')"
        />
        <van-cell
          v-if="can('inventory:view')"
          title="库存查询"
          icon="balance-o"
          is-link
          @click="router.push('/inventory')"
        />
        <van-cell
          v-if="can('inspection:view')"
          title="质检任务"
          icon="completed"
          is-link
          @click="router.push('/inspections')"
        />
      </van-cell-group>

      <div class="section-title">角色与权限</div>
      <div class="card">
        <div class="role-row">
          <span class="muted">角色</span>
          <div class="flex gap-8 role-tags">
            <van-tag v-for="r in user.roles" :key="r" type="primary" plain>{{ ROLE_TEXT[r] ?? r }}</van-tag>
            <span v-if="!user.roles.length" class="muted">—</span>
          </div>
        </div>
        <div class="divider" />
        <div class="perm-summary muted">
          当前账号拥有 {{ user.permissions.length }} 个权限点，移动端仅展示与你职责相关的功能入口；
          无权限的操作会被服务端拒绝。
        </div>
      </div>

      <div class="section-title">关于</div>
      <div class="card about-card">
        <div class="about-brand">
          <div class="brand-badge">MES</div>
          <div>
            <div class="strong">制造执行系统 · 移动端</div>
            <div class="muted">H5 · Vant 3 · Version 0.1.0</div>
          </div>
        </div>
      </div>

      <van-button block round class="logout-btn" @click="logout">退出登录</van-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { showSuccessToast } from '@/utils/toast';
import { useUserStore } from '@/stores/user';
import { unreadCount } from '@/api/andon';
import { confirmAction } from '@/api/http';
import { rolesText, ROLE_TEXT } from '@/utils/format';

const router = useRouter();
const user = useUserStore();
const can = (code: string) => user.has(code);
const unread = ref(0);

const roleText = rolesText(user.roles);

onMounted(async () => {
  if (!can('notification:view')) return;
  try {
    unread.value = (await unreadCount()).count;
  } catch {
    unread.value = 0;
  }
});

async function logout() {
  if (!(await confirmAction('确认退出当前账号？', '退出登录'))) return;
  await user.logout();
  showSuccessToast('已退出');
  router.replace('/login');
}
</script>

<style scoped>
.mine-hero {
  padding-bottom: 34px;
}

.avatar-big {
  flex: none;
  width: 58px;
  height: 58px;
  border-radius: 18px;
  background: linear-gradient(135deg, #fca311, #e08900);
  color: #14213d;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  font-weight: 800;
  box-shadow: 0 8px 20px rgba(252, 163, 17, 0.3);
}

.mine-info {
  min-width: 0;
}

.mine-stats {
  display: flex;
  margin-top: 18px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.08);
  padding: 10px 0;
}

.stat {
  flex: 1;
  text-align: center;
}

.stat + .stat {
  border-left: 1px solid rgba(255, 255, 255, 0.12);
}

.stat-value {
  font-size: 19px;
  font-weight: 800;
}

.stat-label {
  margin-top: 2px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
}

.mine-body {
  margin-top: -20px;
}

.menu-group {
  overflow: hidden;
}

.menu-group :deep(.van-cell__left-icon) {
  color: #1f4e8c;
}

.role-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.role-tags {
  flex-wrap: wrap;
  justify-content: flex-end;
  flex: 1;
}

.perm-summary {
  line-height: 1.7;
}

.about-card {
  padding: 16px;
}

.about-brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-badge {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: linear-gradient(135deg, #1d3a6d, #14213d);
  color: #fca311;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 800;
}

.logout-btn {
  margin-top: 22px;
  height: 46px;
  color: var(--van-danger-color);
  border-color: #f3c9cb;
  background: #fff;
}
</style>
