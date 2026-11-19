<template>
  <div class="page">
    <van-nav-bar title="消息通知" left-arrow @click-left="back">
      <template #right>
        <van-icon name="replay" size="20" @click="reload" />
      </template>
    </van-nav-bar>

    <div class="filter-bar">
      <van-tabs v-model:active="readTab" shrink @change="reload">
        <van-tab title="未读" name="unread" />
        <van-tab title="全部" name="" />
      </van-tabs>
    </div>

    <div class="page-body">
      <van-pull-refresh v-model="refreshing" @refresh="reload">
        <van-list
          v-model:loading="loading"
          :finished="finished"
          :finished-text="list.length ? '没有更多了' : ''"
          @load="fetchPage"
        >
          <div
            v-for="n in list"
            :key="n.id"
            class="card notice-card tappable"
            :class="{ unread: !n.isRead }"
            @click="openDetail(n)"
          >
            <div class="notice-head">
              <span class="notice-title">
                <span v-if="!n.isRead" class="dot" />
                {{ n.title }}
              </span>
              <span class="muted">{{ timeAgo(n.createdAt) }}</span>
            </div>
            <div class="notice-content">{{ n.content }}</div>
            <div class="notice-foot">
              <van-tag v-if="n.type" plain size="medium">{{ n.type }}</van-tag>
              <span class="muted">{{ n.isRead ? '已读' : '未读' }}</span>
            </div>
          </div>

          <van-empty v-if="!list.length && finished" image="search" description="暂无消息" />
        </van-list>
      </van-pull-refresh>
    </div>

    <van-popup v-model:show="detail.show" round position="center">
      <div class="detail-body">
        <div class="detail-head">{{ detail.row?.title }}</div>
        <div class="muted detail-time">{{ formatDateTime(detail.row?.createdAt, true) }}</div>
        <div class="detail-content">{{ detail.row?.content || '（无详细内容）' }}</div>
        <van-button block type="primary" round @click="detail.show = false">知道了</van-button>
      </div>
    </van-popup>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  listNotifications,
  markNotificationRead,
  unreadCount,
  type NotificationRow,
} from '@/api/andon';
import { formatDateTime, timeAgo } from '@/utils/format';

const router = useRouter();

const PAGE_SIZE = 15;
const list = ref<NotificationRow[]>([]);
const loading = ref(false);
const finished = ref(false);
const refreshing = ref(false);
const page = ref(1);
const readTab = ref<'unread' | ''>('unread');
const unread = ref(0);
let fetching = false;

async function fetchPage() {
  if (fetching || finished.value) return;
  fetching = true;
  loading.value = true;
  try {
    const r = await listNotifications({
      page: page.value,
      pageSize: PAGE_SIZE,
      read: readTab.value || undefined,
    });
    list.value = page.value === 1 ? r.list : [...list.value, ...r.list];
    finished.value = r.list.length < PAGE_SIZE || list.value.length >= r.total;
    page.value += 1;
  } catch {
    finished.value = true;
  } finally {
    fetching = false;
    loading.value = false;
  }
}

async function loadUnread() {
  try {
    unread.value = (await unreadCount()).count;
  } catch {
    unread.value = 0;
  }
}

async function reload() {
  page.value = 1;
  finished.value = false;
  list.value = [];
  refreshing.value = true;
  await Promise.all([fetchPage(), loadUnread()]);
  refreshing.value = false;
}

const detail = reactive({
  show: false,
  row: null as NotificationRow | null,
});

async function openDetail(n: NotificationRow) {
  detail.row = n;
  detail.show = true;
  if (!n.isRead) {
    try {
      const r = await markNotificationRead(n.id);
      n.isRead = true;
      unread.value = r.unreadCount;
      if (readTab.value === 'unread') {
        await reload();
      }
    } catch {
      // 静默：已弹出内容
    }
  }
}

function back() {
  if (window.history.length > 1) router.back();
  else router.replace('/');
}

onMounted(() => {
  void loadUnread();
});
</script>

<style scoped>
.filter-bar {
  position: sticky;
  top: calc(46px + env(safe-area-inset-top));
  z-index: 15;
  background: #fff;
  box-shadow: 0 4px 12px rgba(20, 33, 61, 0.04);
}

.filter-bar :deep(.van-tabs__wrap) {
  height: 42px;
}

.notice-card {
  margin-bottom: 12px;
}

.notice-card.unread {
  box-shadow: 0 3px 14px rgba(31, 78, 140, 0.1);
}

.notice-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.notice-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: #1c2434;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--van-danger-color);
}

.notice-content {
  margin-top: 6px;
  font-size: 13px;
  color: #5b6779;
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.notice-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
}

.detail-body {
  width: 82vw;
  max-width: 420px;
  padding: 20px 18px;
  box-sizing: border-box;
}

.detail-head {
  font-size: 16px;
  font-weight: 700;
  line-height: 1.5;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.detail-time {
  margin-top: 4px;
}

.detail-content {
  margin: 14px 0 20px;
  font-size: 14px;
  line-height: 1.7;
  color: #33405a;
  white-space: pre-wrap;
  max-height: 46vh;
  overflow: auto;
}
</style>
