import { defineStore } from 'pinia';
import { login as loginApi, logout as logoutApi, fetchMe, type MeResult, type LoginCaptchaInput } from '@/api/auth';

/**
 * 移动端登录态：token + 用户 + 权限码。
 * 权限仅用于界面显隐，真正防线在后端守卫。
 */
export const useUserStore = defineStore('user', {
  state: () => ({
    accessToken: localStorage.getItem('accessToken') ?? '',
    refreshToken: localStorage.getItem('refreshToken') ?? '',
    user: null as null | MeResult['user'],
    roles: [] as string[],
    permissions: [] as string[],
    menus: [] as MeResult['menus'],
  }),
  getters: {
    isLoggedIn: (s) => !!s.accessToken,
    displayName: (s) => s.user?.name || s.user?.username || '未登录',
    has: (s) => (code: string) => s.permissions.includes(code),
  },
  actions: {
    setTokens(access: string, refresh: string) {
      this.accessToken = access;
      this.refreshToken = refresh;
      localStorage.setItem('accessToken', access);
      localStorage.setItem('refreshToken', refresh);
    },
    async login(username: string, password: string, captcha?: LoginCaptchaInput) {
      const data = await loginApi(username, password, captcha);
      this.setTokens(data.accessToken, data.refreshToken);
      this.user = data.user;
      await this.fetchMe();
    },
    async fetchMe() {
      const me = await fetchMe();
      this.user = me.user;
      this.roles = me.roles;
      this.permissions = me.permissions;
      this.menus = me.menus;
      return me;
    },
    async logout() {
      try {
        await logoutApi(this.refreshToken || undefined);
      } catch {
        // token 已失效不阻塞本地清理
      }
      this.accessToken = '';
      this.refreshToken = '';
      this.user = null;
      this.roles = [];
      this.permissions = [];
      this.menus = [];
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
    },
  },
});
