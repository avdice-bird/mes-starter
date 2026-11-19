import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { requiredJwtSecret } from '../../common/config/env';
import { MenuModule } from '../menu/menu.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CaptchaService } from './captcha.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtStrategy } from './jwt.strategy';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

@Module({
  imports: [
    PassportModule,
    MenuModule, // /auth/me 需要菜单树
    // 密钥只从 ConfigService 取（最终来自环境变量）；签发有效期由 JWT_ACCESS_EXPIRES 控制
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: requiredJwtSecret(config),
        signOptions: { expiresIn: config.get<string>('JWT_ACCESS_EXPIRES') ?? '2h' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    CaptchaService,
    JwtStrategy,
    // 全局守卫按 providers 顺序执行：先认证（JwtAuthGuard），后鉴权（PermissionsGuard）
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AuthModule {}
