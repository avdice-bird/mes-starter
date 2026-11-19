import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
/** 公开接口：跳过认证与权限守卫（第 2、6 节的 Guard 会读取这个元数据） */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
