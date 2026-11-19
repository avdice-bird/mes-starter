import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { CaptchaService } from './captcha.service';
import { MenuService } from '../menu/menu.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
  let service: AuthService;
  const adminUser = {
    id: 1, username: 'admin', name: '管理员', status: 1,
    failedAttempts: 0, lockedUntil: null,
    password: bcrypt.hashSync('Admin@123', 10),
    createdAt: new Date(), updatedAt: new Date(), createdBy: '', updatedBy: '',
  };
  const prismaMock = {
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    user: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    refreshToken: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({}),
    },
    userRole: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const jwtMock = { signAsync: jest.fn().mockResolvedValue('access-token') };
  const menuMock = { visibleTree: jest.fn().mockResolvedValue([]) };
  const captchaMock = { create: jest.fn(), verify: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: JwtService, useValue: jwtMock },
        { provide: MenuService, useValue: menuMock },
        { provide: CaptchaService, useValue: captchaMock },
        { provide: ConfigService, useValue: { get: () => '7d' } },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  it('正确密码应返回双 token 和用户信息', async () => {
    prismaMock.user.findUnique.mockResolvedValue(adminUser);
    const result = await service.login({ username: 'admin', password: 'Admin@123' });
    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBeTruthy();
    expect(result.user).toEqual({ id: 1, username: 'admin', name: '管理员' });
    expect(result.user).not.toHaveProperty('password');
  });

  it('错误密码应抛出未登录异常', async () => {
    prismaMock.user.findUnique.mockResolvedValue(adminUser);
    prismaMock.user.update.mockResolvedValueOnce({ ...adminUser, failedAttempts: 1 });
    await expect(service.login({ username: 'admin', password: 'wrong' })).rejects.toMatchObject({ code: 1002 });
    // 失败次数要累加（第 3 节锁定逻辑）
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 }, data: { failedAttempts: { increment: 1 } } }),
    );
  });

  it('连续 3 次错误应要求滑块验证', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...adminUser, failedAttempts: 2 });
    prismaMock.user.update.mockResolvedValueOnce({ ...adminUser, failedAttempts: 3 });
    await expect(service.login({ username: 'admin', password: 'wrong' })).rejects.toMatchObject({ code: 1010 });
    expect(captchaMock.verify).not.toHaveBeenCalled();
  });

  it('达到 3 次后缺少滑块验证应被拒绝，且不累加失败次数', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...adminUser, failedAttempts: 3 });
    captchaMock.verify.mockImplementationOnce(() => {
      throw new BusinessException(ErrorCode.CAPTCHA_REQUIRED, '请先完成滑块验证');
    });
    await expect(service.login({ username: 'admin', password: 'Admin@123' })).rejects.toMatchObject({ code: 1010 });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('达到 3 次后携带有效滑块验证且密码正确应登录成功', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...adminUser, failedAttempts: 3 });
    captchaMock.verify.mockReturnValueOnce(undefined);
    const result = await service.login({
      username: 'admin', password: 'Admin@123', captchaId: 'captcha-1', captchaOffset: 120,
    });
    expect(result.accessToken).toBe('access-token');
    expect(captchaMock.verify).toHaveBeenCalledWith('captcha-1', 120, 'admin');
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { failedAttempts: 0, lockedUntil: null } }),
    );
  });

  it('连续错误达到 5 次应触发 15 分钟锁定', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...adminUser, failedAttempts: 4 });
    captchaMock.verify.mockReturnValueOnce(undefined);
    prismaMock.user.update.mockResolvedValueOnce({ ...adminUser, failedAttempts: 5 });
    await expect(
      service.login({ username: 'admin', password: 'wrong', captchaId: 'captcha-1', captchaOffset: 120 }),
    ).rejects.toMatchObject({ code: 1009 });
    const lockCall = prismaMock.user.update.mock.calls.find(([arg]) => arg.data.lockedUntil);
    expect(lockCall?.[0].data.failedAttempts).toBe(0);
    expect(lockCall?.[0].data.lockedUntil.getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
  });

  it('锁定中的用户即使密码正确也应被拒绝', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      ...adminUser,
      lockedUntil: new Date(Date.now() + 10 * 60 * 1000),
    });
    await expect(service.login({ username: 'admin', password: 'Admin@123' })).rejects.toMatchObject({ code: 1009 });
    expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
  });

  it('登录成功应清零失败次数', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...adminUser, failedAttempts: 2 });
    await service.login({ username: 'admin', password: 'Admin@123' });
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { failedAttempts: 0, lockedUntil: null } }),
    );
  });

  it('用户不存在也应抛出未登录异常', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(service.login({ username: 'ghost', password: 'x' })).rejects.toMatchObject({ code: 1002 });
  });

  it('不存在的用户名连续 3 次错误也应要求滑块（防用户名枚举）', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(service.login({ username: 'ghost', password: 'x' })).rejects.toMatchObject({ code: 1002 });
    await expect(service.login({ username: 'ghost', password: 'x' })).rejects.toMatchObject({ code: 1002 });
    await expect(service.login({ username: 'ghost', password: 'x' })).rejects.toMatchObject({ code: 1010 });
  });

  it('有效 refresh token 应轮换出新的 token 对', async () => {
    prismaMock.refreshToken.findUnique.mockResolvedValue({
      id: 1, userId: 1, token: 'old', revoked: false, expiresAt: new Date(Date.now() + 86400000),
    });
    prismaMock.user.findUnique.mockResolvedValue(adminUser);
    const result = await service.refresh('old');
    expect(result.refreshToken).not.toBe('old');
    expect(prismaMock.refreshToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 }, data: { revoked: true } }),
    );
  });

  it('已吊销的 refresh token 应抛出未登录异常', async () => {
    prismaMock.refreshToken.findUnique.mockResolvedValue({
      id: 1, userId: 1, token: 'old', revoked: true, expiresAt: new Date(Date.now() + 86400000),
    });
    await expect(service.refresh('old')).rejects.toMatchObject({ code: 1002 });
  });

  it('登出应吊销 refresh token', async () => {
    await service.logout(1, 'old');
    expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 1, token: 'old' }, data: { revoked: true } }),
    );
  });
});
