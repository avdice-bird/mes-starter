import { get, post } from './http';
import type { MenuNode, CaptchaChallenge, LoginCaptchaInput } from '@mes/shared';

export interface CurrentUser {
  id: number;
  username: string;
  name: string;
}

export interface MeResult {
  user: CurrentUser;
  roles: string[];
  permissions: string[];
  menus: MenuNode[];
}

export interface LoginResult extends MeResult {
  accessToken: string;
  refreshToken: string;
}

// 滑块验证相关类型统一放 packages/shared，避免三端重复声明
export type { CaptchaChallenge, LoginCaptchaInput } from '@mes/shared';

export const getLoginCaptcha = (username: string) =>
  post<CaptchaChallenge>('/auth/captcha', { username }, { silent: true });

export const login = (username: string, password: string, captcha?: LoginCaptchaInput) =>
  post<LoginResult>('/auth/login', { username, password, ...(captcha ?? {}) }, { silent: true });

export const refresh = (refreshToken: string) => post<LoginResult>('/auth/refresh', { refreshToken });

export const logout = (refreshToken?: string) => post<void>('/auth/logout', { refreshToken });

export const fetchMe = () => get<MeResult>('/auth/me');
