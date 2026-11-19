import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { CaptchaService } from './captcha.service';
import { CaptchaDto } from './dto/captcha.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';

// 认证与鉴权由全局守卫统一处理（见 auth.module.ts 的 APP_GUARD），Controller 不再重复挂
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private captcha: CaptchaService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('login')
  @ApiOperation({ summary: '登录，返回双 token 与用户信息；每分钟最多 20 次' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('captcha')
  @Public()
  @ApiOperation({ summary: '获取登录滑块验证挑战（连续 3 次密码错误后）' })
  captchaChallenge(@Body() dto: CaptchaDto) {
    return this.captcha.create(dto.username.trim());
  }

  @HttpCode(HttpStatus.OK)
  @Public()
  @Post('refresh')
  @ApiOperation({ summary: '用 refreshToken 换新的一对 token' })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  @ApiOperation({ summary: '登出，使 refreshToken 失效' })
  logout(@Req() req: Request & { user: { id: number } }) {
    return this.auth.logout(req.user.id, req.body?.refreshToken);
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: '当前登录用户' })
  me(@Req() req: Request & { user: { id: number } }) {
    return this.auth.me(req.user.id);
  }
}
