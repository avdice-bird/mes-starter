import { ConfigService } from '@nestjs/config';

/**
 * JWT 密钥必须来自环境变量；缺失直接启动失败，不允许静默用默认值。
 * 开发环境从 apps/server/.env 读取，测试由 test/setup.ts 注入 test-secret。
 */
export function requiredJwtSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET');
  if (!secret) {
    throw new Error('环境变量 JWT_SECRET 未配置：复制 apps/server/.env.example 为 .env 并修改');
  }
  return secret;
}
