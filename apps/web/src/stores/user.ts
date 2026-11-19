import { defineStore } from 'pinia';
import { login as loginApi, logout as logoutApi, fetchMe, type MeResult, type LoginCaptchaInput } from '@/api/auth';

/**
 * 用户状态：token、用户信息、权限码、可见菜单树。
 * 权限码与菜单在登录和 fetchMe 时从后端拉取——localStorage 里即使被改，
 * 后端守卫仍按数据库实时校验（第 7 节用例 1）。
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
    has: (s) => (code: string) => s.permissions.includes(code),
  },
  actions: {
    setTokens(access: string, refresh: string) {
      this.accessToken = access; this.refreshToken = refresh;
      localStorage.setItem('accessToken', access); localStorage.setItem('refreshToken', refresh);
    },
    /** 登录成功后保存 token 与用户信息，再拉一次 /me 同步权限与菜单 */
    async login(username: string, password: string, captcha?: LoginCaptchaInput) {
      const data = await loginApi(username, password, captcha);
      this.setTokens(data.accessToken, data.refreshToken);
      this.user = data.user;
      await this.fetchMe();
    },
    /** 刷新页面后用 access token 恢复用户信息 + 权限 + 菜单 */
    async fetchMe() {
      const me = await fetchMe();
      this.user = me.user;
      this.roles = me.roles;
      this.permissions = me.permissions;
      this.menus = me.menus;
      return me;
    },
    /** 登出：先让服务端 refresh token 失效，再清本地状态 */
    async logout() {
      try {
        await logoutApi(this.refreshToken || undefined);
      } catch {
        // 服务端登出失败（如 token 已过期）不阻塞本地清理
      }
      this.accessToken = ''; this.refreshToken = ''; this.user = null;
      this.roles = []; this.permissions = []; this.menus = [];
      localStorage.removeItem('accessToken'); localStorage.removeItem('refreshToken');
    },
  },
});
