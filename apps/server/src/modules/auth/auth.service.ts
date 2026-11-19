import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { MeResult } from '@mes/shared';
import { MenuService } from '../menu/menu.service';
import { CaptchaService } from './captcha.service';
import { LoginDto } from './dto/login.dto';

/** 连续错误次数达到该值后，登录必须携带滑块验证 */
const CAPTCHA_THRESHOLD = 3;
/** 连续错误次数达到该值即锁定 */
const LOCK_THRESHOLD = 5;
/** 锁定时长（毫秒） */
const LOCK_DURATION_MS = 15 * 60 * 1000;
/** 不存在的用户名也跟踪尝试次数（防止通过“是否出现滑块”枚举用户）；Map 上限防内存膨胀 */
const UNKNOWN_ATTEMPT_LIMIT = 5000;
/** 用户不存在时也跑一次同强度 bcrypt 比对，避免响应时间差暴露用户名是否存在 */
const DUMMY_HASH = bcrypt.hashSync(randomBytes(16).toString('hex'), 10);

interface AttemptState {
  attempts: number;
  lockedUntil: Date | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  /** refresh 有效期（毫秒），来自 JWT_REFRESH_EXPIRES（如 "7d"），默认 7 天 */
  private readonly refreshTtlMs: number;
  /** 不存在用户名的失败计数（仅在内存；真实账号的计数在 User.failedAttempts） */
  private readonly unknownAttempts = new Map<string, AttemptState>();

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private menus: MenuService,
    private captcha: CaptchaService,
    config: ConfigService,
  ) {
    this.refreshTtlMs = parseDurationMs(config.get<string>('JWT_REFRESH_EXPIRES') ?? '7d');
  }

  /** 登录：校验密码，签发双 token（refresh 入库以便登出/轮换失效） */
  async login(dto: LoginDto) {
    // 用户名策略：trim、区分大小写（第 3 节用例 11）
    const username = dto.username.trim();
    const user = await this.prisma.user.findUnique({ where: { username } });
    // 不存在的用户名也走同一套失败计数/滑块/锁定，避免通过错误形态枚举账号
    if (!user) return this.loginUnknown(username, dto);
    // 锁定检查必须在密码校验之前：锁定期间即使密码错误也返回锁定，不继续累加。
    // 但要先跑一次同强度哑哈希，与"不存在的用户名被锁定"分支耗时一致，避免时序枚举真实账号。
    await this.assertNotLocked(user, dto.password);
    // 连续 3 次密码错误后必须先完成滑块验证，验证失败不计入密码错误次数
    if (user.failedAttempts >= CAPTCHA_THRESHOLD) {
      this.captcha.verify(dto.captchaId, dto.captchaOffset, username);
    }
    const passwordOk = await bcrypt.compare(dto.password, user.password);
    if (!passwordOk) {
      const state = await this.recordFail(user);
      throw this.loginFailure(state);
    }
    if (user.status !== 1) throw new BusinessException(ErrorCode.UNAUTHORIZED, '账号已禁用');
    this.unknownAttempts.delete(username);
    // 清零失败计数与写入新 refresh token 同事务，避免中途失败留下脏状态
    const resetOp =
      user.failedAttempts > 0 || user.lockedUntil
        ? [this.prisma.user.update({
            where: { id: user.id },
            data: { failedAttempts: 0, lockedUntil: null },
          })]
        : [];
    const tokens = await this.issueTokens(user.id, user.username, resetOp);
    return { ...tokens, ...(await this.profileOf(user)) };
  }

  /** 刷新：旧 refresh 校验并作废（轮换），签发新的一对 */
  async refresh(refreshToken: string) {
    const stored = await this.prisma.refreshToken.findUnique({ where: { token: refreshToken } });
    if (!stored || stored.revoked || stored.expiresAt < new Date()) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, 'refresh token 无效');
    }
    const user = await this.prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user || user.status !== 1) throw new BusinessException(ErrorCode.UNAUTHORIZED);
    // 作废旧 refresh 与写入新 refresh 同事务：要么都成要么都不成，防止轮换断裂
    const tokens = await this.issueTokens(user.id, user.username, [
      this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } }),
    ]);
    return { ...tokens, ...(await this.profileOf(user)) };
  }

  /** 登出：使 refresh token 失效 */
  async logout(userId: number, refreshToken?: string) {
    if (refreshToken) {
      await this.prisma.refreshToken.updateMany({
        where: { userId, token: refreshToken },
        data: { revoked: true },
      });
      return;
    }
    await this.prisma.refreshToken.updateMany({ where: { userId }, data: { revoked: true } });
  }

  async me(userId: number): Promise<MeResult> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BusinessException(ErrorCode.UNAUTHORIZED);
    return this.profileOf(user);
  }

  /**
   * /auth/me 与登录共用的完整档案：用户 + 角色编码 + 权限码 + 可见菜单树。
   * 每次调用都实时查库（与 ADR-002 一致），前端刷新页面/重新登录后拿到的都是当前权限。
   */
  private async profileOf(user: { id: number; username: string; name: string }): Promise<MeResult> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId: user.id },
      include: { role: { select: { code: true, rolePermissions: { select: { permission: { select: { code: true } } } } } } },
    });
    const roles = userRoles.map((ur) => ur.role.code);
    const permissions = [...new Set(userRoles.flatMap((ur) => ur.role.rolePermissions.map((rp) => rp.permission.code)))];
    const menus = await this.menus.visibleTree(new Set(permissions));
    return { user: this.pickUser(user), roles, permissions, menus };
  }

  /**
   * 锁定期间正确密码也拒绝，消息说明剩余分钟数（第 3 节用例 2）。
   * password 只用于与 loginUnknown 分支做等量哑哈希以抹平时序差，不参与校验。
   */
  private async assertNotLocked(user: { lockedUntil: Date | null }, password: string) {
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await bcrypt.compare(password, DUMMY_HASH);
      throw this.lockedError(user.lockedUntil);
    }
  }

  /** 锁定错误：附带 lockedUntil 供前端做倒计时 */
  private lockedError(lockedUntil: Date) {
    const minutes = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 60000));
    return new BusinessException(
      ErrorCode.ACCOUNT_LOCKED,
      `密码错误次数过多，账号已锁定，请 ${minutes} 分钟后再试`,
      { lockedUntil: lockedUntil.toISOString(), minutes },
    );
  }

  /** 根据一次失败后的状态决定返回：锁定 > 需要滑块 > 普通用户名或密码错误 */
  private loginFailure(state: AttemptState): never {
    if (state.lockedUntil) throw this.lockedError(state.lockedUntil);
    if (state.attempts >= CAPTCHA_THRESHOLD) {
      throw new BusinessException(ErrorCode.CAPTCHA_REQUIRED, '密码错误次数较多，请完成滑块验证后重试', {
        captchaRequired: true,
        failedAttempts: state.attempts,
      });
    }
    throw new BusinessException(ErrorCode.UNAUTHORIZED, '用户名或密码错误');
  }

  /** 记录失败次数：原子自增；达到阈值写锁定并清零计数（锁定结束后重新计） */
  private async recordFail(user: { id: number }): Promise<AttemptState> {
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { failedAttempts: { increment: 1 } },
    });
    if (updated.failedAttempts >= LOCK_THRESHOLD) {
      const lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
      await this.prisma.user.update({ where: { id: user.id }, data: { failedAttempts: 0, lockedUntil } });
      return { attempts: LOCK_THRESHOLD, lockedUntil };
    }
    return { attempts: updated.failedAttempts, lockedUntil: null };
  }

  /** 不存在的用户名：内存计数 + 同样的滑块/锁定响应；始终跑一遍哑哈希保持时序 */
  private async loginUnknown(username: string, dto: LoginDto): Promise<never> {
    const stored = this.unknownAttempts.get(username);
    // 锁定已过期：按全新计数处理，不残留“需要滑块”的状态
    const previous = stored?.lockedUntil && stored.lockedUntil <= new Date() ? undefined : stored;
    if (previous?.lockedUntil && previous.lockedUntil > new Date()) {
      await bcrypt.compare(dto.password, DUMMY_HASH);
      throw this.lockedError(previous.lockedUntil);
    }
    if (previous && previous.attempts >= CAPTCHA_THRESHOLD) {
      this.captcha.verify(dto.captchaId, dto.captchaOffset, username);
    }
    await bcrypt.compare(dto.password, DUMMY_HASH);
    throw this.loginFailure(this.recordUnknownFail(username, previous));
  }

  private recordUnknownFail(username: string, previous: AttemptState | undefined): AttemptState {
    const now = Date.now();
    const base = previous?.lockedUntil && previous.lockedUntil.getTime() <= now ? 0 : (previous?.attempts ?? 0);
    const attempts = base + 1;
    const state: AttemptState =
      attempts >= LOCK_THRESHOLD
        ? { attempts: LOCK_THRESHOLD, lockedUntil: new Date(now + LOCK_DURATION_MS) }
        : { attempts, lockedUntil: null };
    this.unknownAttempts.set(username, state);
    while (this.unknownAttempts.size > UNKNOWN_ATTEMPT_LIMIT) {
      const oldest = this.unknownAttempts.keys().next().value as string | undefined;
      if (!oldest) break;
      this.unknownAttempts.delete(oldest);
    }
    return state;
  }

  private async issueTokens(
    userId: number,
    username: string,
    preOps: Prisma.PrismaPromise<unknown>[] = [],
  ): Promise<TokenPair> {
    // access 的有效期由 JwtModule 的 signOptions（JWT_ACCESS_EXPIRES）统一控制
    const accessToken = await this.jwt.signAsync({ sub: userId, username });
    // refresh 用随机串入库，不放在 JWT 里：可以随时吊销
    const refreshToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.refreshTtlMs);
    await this.prisma.$transaction([
      ...preOps,
      this.prisma.refreshToken.create({
        data: { userId, token: refreshToken, expiresAt },
      }),
    ]);
    return { accessToken, refreshToken };
  }

  private pickUser(user: { id: number; username: string; name: string }) {
    return { id: user.id, username: user.username, name: user.name };
  }
}

/** "7d" / "12h" / "30m" / "600s" → 毫秒；无法解析时回退 7 天 */
function parseDurationMs(value: string): number {
  const m = value.trim().match(/^(\d+)\s*(d|h|m|s)?$/i);
  if (!m) return 7 * 24 * 3600 * 1000;
  const n = Number(m[1]);
  const unit = (m[2] ?? 's').toLowerCase();
  const factor = { d: 24 * 3600, h: 3600, m: 60, s: 1 }[unit]!;
  return n * factor * 1000;
}
