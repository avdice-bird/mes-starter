import { SetMetadata } from '@nestjs/common';

/** 接口需要的权限码元数据 key */
export const IS_PERMISSIONS_KEY = 'required_permissions';

/**
 * 声明接口所需权限码：`@Permissions('material:create')` 或 `@Permissions('a:view', 'b:view')`。
 * 由全局 PermissionsGuard 校验（注册在 JwtAuthGuard 之后），多个码为"与"关系。
 * 权限码格式 `<模块>:<动作>`，动作限于 view / create / update / delete / import / export / <业务动作>。
 */
export const Permissions = (...codes: string[]) => SetMetadata(IS_PERMISSIONS_KEY, codes);
