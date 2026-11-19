import { Injectable } from '@nestjs/common';
import { randomBytes, randomInt } from 'node:crypto';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { CaptchaChallenge } from '@mes/shared';
import { WIDTH, HEIGHT, PIECE_SIZE, PIECE_TOP, renderPuzzle } from './puzzle-image';

const TOLERANCE = 6;
const TTL_MS = 2 * 60 * 1000;
/** 内存挑战总量上限（所有挑战 2 分钟过期，create 时先清过期，正常情况远低于此值） */
const MAX_CHALLENGES = 5000;
/** 单个用户名最多同时保留的未使用挑战数：防止刷接口挤掉其他用户的挑战 */
const MAX_PER_USERNAME = 5;

interface StoredChallenge {
  username: string;
  target: number;
  expiresAt: number;
}

/**
 * 登录滑块验证码：服务端生成一张带缺口的随机位图和对应拼图块，
 * 目标横坐标只存在服务端；前端拖动后回传偏移，服务端校验。
 *
 * 关键安全点：下发的是**不透明 PNG 像素**，不再是含 `<rect x="${target}">` 的 SVG 文本，
 * 客户端无法从响应里解析出答案（否则滑块可被脚本直接求解，防暴力破解形同虚设）。
 * - 单次有效：绑定的用户名校验通过后，无论偏移对错立即作废
 * - 绑定用户名：A 用户拿到的挑战不能给 B 用户用
 * - 2 分钟过期；内存 Map 足够本项目单实例部署
 */
@Injectable()
export class CaptchaService {
  private readonly challenges = new Map<string, StoredChallenge>();

  create(username: string): CaptchaChallenge {
    this.cleanup();
    this.trimForUser(username);
    while (this.challenges.size >= MAX_CHALLENGES) this.evictOne();

    const target = randomInt(80, WIDTH - PIECE_SIZE - 10);
    const { background, piece } = renderPuzzle(target);
    const captchaId = randomBytes(16).toString('hex');
    this.challenges.set(captchaId, { username, target, expiresAt: Date.now() + TTL_MS });

    const result: CaptchaChallenge = {
      captchaId,
      background,
      piece,
      width: WIDTH,
      height: HEIGHT,
      pieceSize: PIECE_SIZE,
      pieceTop: PIECE_TOP,
      maxOffset: WIDTH - PIECE_SIZE,
      tolerance: TOLERANCE,
      expiresIn: TTL_MS / 1000,
    };
    // 仅供 e2e 自动拖动：必须在 NODE_ENV=test 且显式打开开关时才返回；生产/开发永不返回。
    // setup.ts 在测试进程里设置该开关。
    if (process.env.NODE_ENV === 'test' && process.env.CAPTCHA_EXPOSE_TARGET === 'true') {
      result.target = target;
    }
    return result;
  }

  verify(captchaId: string | undefined, offset: number | undefined, username: string): void {
    if (!captchaId || offset == null) {
      throw new BusinessException(ErrorCode.CAPTCHA_REQUIRED, '请先完成滑块验证');
    }
    const challenge = this.challenges.get(captchaId);
    // 先校验归属，再作废：用错误用户名试探不会消耗掉别人的挑战
    if (!challenge || challenge.username !== username) {
      throw new BusinessException(ErrorCode.CAPTCHA_REQUIRED, '验证已失效，请重新拖动滑块');
    }
    // 单次有效：归属正确后，无论校验成败都立即作废，避免同一挑战被反复试探
    this.challenges.delete(captchaId);
    if (challenge.expiresAt < Date.now()) {
      throw new BusinessException(ErrorCode.CAPTCHA_REQUIRED, '验证已过期，请重新拖动滑块');
    }
    if (Math.abs(Number(offset) - challenge.target) > TOLERANCE) {
      throw new BusinessException(ErrorCode.CAPTCHA_REQUIRED, '滑块验证未通过，请重试');
    }
  }

  /** 单个用户名超限：淘汰该用户名最早的挑战，不影响其他用户名 */
  private trimForUser(username: string) {
    const own: string[] = [];
    for (const [id, c] of this.challenges) if (c.username === username) own.push(id);
    while (own.length >= MAX_PER_USERNAME) {
      const id = own.shift();
      if (id) this.challenges.delete(id);
    }
  }

  /** 总量兜底：优先淘汰"持有挑战最多"的用户名（通常是泛洪者），再淘汰最早插入的 */
  private evictOne() {
    const counts = new Map<string, number>();
    for (const c of this.challenges.values()) counts.set(c.username, (counts.get(c.username) ?? 0) + 1);
    let heaviest = '';
    let max = 0;
    for (const [u, n] of counts) {
      if (n > max) {
        max = n;
        heaviest = u;
      }
    }
    for (const [id, c] of this.challenges) {
      if (c.username === heaviest) {
        this.challenges.delete(id);
        return;
      }
    }
    const oldest = this.challenges.keys().next().value;
    if (oldest) this.challenges.delete(oldest);
  }

  private cleanup() {
    const now = Date.now();
    for (const [id, c] of this.challenges) {
      if (c.expiresAt <= now) this.challenges.delete(id);
    }
  }
}
