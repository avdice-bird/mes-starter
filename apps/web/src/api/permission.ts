import { get } from './http';
import type { PermissionRow } from '@mes/shared';

export const listPermissions = () => get<PermissionRow[]>('/permissions');
