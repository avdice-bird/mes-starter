import { get } from './http';

export interface Health { status: string; db: string; time: string }
export const fetchHealth = () => get<Health>('/health', undefined, { silent: true });
