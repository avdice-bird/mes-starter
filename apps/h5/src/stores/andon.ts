import { defineStore } from 'pinia';
import { listOpenAndon } from '@/api/andon';

/**
 * 安灯未处理数：底部 Tabbar 角标与页面共用，
 * 避免在布局里只拉一次、响应/关闭后角标不更新的问题。
 */
export const useAndonStore = defineStore('andon', {
  state: () => ({
    openCount: 0,
    refreshing: false,
  }),
  actions: {
    async refresh() {
      if (this.refreshing) return;
      this.refreshing = true;
      try {
        this.openCount = (await listOpenAndon()).length;
      } catch {
        // 无权限或网络异常时不清空已有角标，避免误报 0
      } finally {
        this.refreshing = false;
      }
    },
  },
});
