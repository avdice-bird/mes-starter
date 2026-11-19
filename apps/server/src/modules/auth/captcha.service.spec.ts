import { CaptchaService } from './captcha.service';
import { ErrorCode } from '../../common/exceptions/business.exception';

function codeOf(fn: () => unknown): number | undefined {
  try {
    fn();
  } catch (e) {
    return (e as { code?: number }).code;
  }
  return undefined;
}

describe('CaptchaService', () => {
  let service: CaptchaService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    service = new CaptchaService();
    // 显式打开测试开关，模拟 e2e/setup.ts 的行为
    process.env.CAPTCHA_EXPOSE_TARGET = 'true';
  });

  afterEach(() => {
    jest.useRealTimers();
    delete process.env.CAPTCHA_EXPOSE_TARGET;
  });

  it('返回的是不透明 PNG，答案不在响应文本里', () => {
    const c = service.create('alice');
    expect(c.background.startsWith('data:image/png;base64,')).toBe(true);
    expect(c.piece.startsWith('data:image/png;base64,')).toBe(true);
    // 关键回归：SVG 时代把 <rect x="${target}"> 直接下发了，这里必须绝迹
    expect(c.background).not.toContain('<svg');
    expect(c.background).not.toContain('<rect');
    const decoded = Buffer.from(c.background.split(',')[1], 'base64').toString('latin1');
    expect(decoded).not.toContain(String(c.target));
  });

  it('生产/开发形态下不返回 target，只有显式测试开关才返回', () => {
    delete process.env.CAPTCHA_EXPOSE_TARGET;
    const c = service.create('alice');
    expect(c.target).toBeUndefined();
  });

  it('正确偏移通过，且挑战单次有效（重放被拒）', () => {
    const c = service.create('alice');
    expect(() => service.verify(c.captchaId, c.target!, 'alice')).not.toThrow();
    expect(codeOf(() => service.verify(c.captchaId, c.target!, 'alice'))).toBe(ErrorCode.CAPTCHA_REQUIRED);
  });

  it('绑定用户名：用错误用户名试探不消耗挑战，正确用户名仍可用', () => {
    const c = service.create('alice');
    expect(codeOf(() => service.verify(c.captchaId, c.target!, 'bob'))).toBe(ErrorCode.CAPTCHA_REQUIRED);
    expect(() => service.verify(c.captchaId, c.target!, 'alice')).not.toThrow();
  });

  it('偏移超出容差被拒，并作废挑战', () => {
    const c = service.create('alice');
    const off = c.target! + c.tolerance + 20;
    expect(codeOf(() => service.verify(c.captchaId, off, 'alice'))).toBe(ErrorCode.CAPTCHA_REQUIRED);
    expect(codeOf(() => service.verify(c.captchaId, c.target!, 'alice'))).toBe(ErrorCode.CAPTCHA_REQUIRED);
  });

  it('2 分钟后过期', () => {
    const c = service.create('alice');
    jest.advanceTimersByTime(2 * 60 * 1000 + 1);
    expect(codeOf(() => service.verify(c.captchaId, c.target!, 'alice'))).toBe(ErrorCode.CAPTCHA_REQUIRED);
  });

  it('缺少 captchaId/offset 直接要求滑块', () => {
    expect(codeOf(() => service.verify(undefined, 10, 'alice'))).toBe(ErrorCode.CAPTCHA_REQUIRED);
    expect(codeOf(() => service.verify('x', undefined, 'alice'))).toBe(ErrorCode.CAPTCHA_REQUIRED);
  });

  it('单个用户名泛洪不会挤掉其他用户名的挑战', () => {
    const victim = service.create('victim');
    for (let i = 0; i < 30; i += 1) service.create('attacker');
    expect(() => service.verify(victim.captchaId, victim.target!, 'victim')).not.toThrow();
  });
});
