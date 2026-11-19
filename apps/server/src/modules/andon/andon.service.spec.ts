import { AndonService, type AndonEvent } from './andon.service';
import type { BoardEventBus } from '../board/board.events';
import { nextAndonStatus } from './andon.state';

/**
 * 第 52 节【测】安灯 Service 单测：只 mock Prisma 与事件总线，不 mock 被测 Service。
 * 重点：合并逻辑、escalateTimeouts(now)（时间传入，不 sleep）、通知发给正确角色。
 */
describe('AndonService（第 52 节）', () => {
  /** 可编程的 Prisma mock：按模型记录调用并返回预设值 */
  function makePrisma() {
    const calls: { model: string; op: string; args: unknown }[] = [];
    const respond = <T>(model: string, op: string, fn: (args: unknown) => T) =>
      jest.fn((args: unknown) => { calls.push({ model, op, args }); return fn(args); });
    return {
      calls,
      andonCall: {
        findFirst: respond('andonCall', 'findFirst', () => null),
        create: respond('andonCall', 'create', (args: any) => ({
          id: 1, code: 'AD-1', status: 'OPEN', workCenterId: args.data.workCenterId,
          type: args.data.type, description: args.data.description, calledAt: new Date('2026-01-01T00:00:00Z'),
        })),
        findUnique: respond('andonCall', 'findUnique', () => null),
        update: respond('andonCall', 'update', (args: any) => ({ id: args.where.id, status: 'OPEN', escalated: true, escalatedAt: new Date(), code: 'AD-1', type: 'EQUIPMENT', workCenterId: 1, description: 'd' })),
        findMany: respond('andonCall', 'findMany', () => []),
      },
      equipment: { findUnique: respond('equipment', 'findUnique', () => null) },
      dictItem: {
        findFirst: respond('dictItem', 'findFirst', (args: any) => {
          // andon_responder_role：MATERIAL→planner；andon_config：超时 10
          if (args.where.value === 'andon_timeout_minutes') return { label: '10' };
          return { label: 'planner' };
        }),
      },
      user: {
        findMany: respond('user', 'findMany', (args: any) =>
          // 责任角色（planner）2 人；升级通知（admin）1 人——按 where 里的角色 code 区分
          (args.where.userRoles?.some?.role?.code === 'admin' ? [{ id: 1 }] : [{ id: 11 }, { id: 12 }])),
      },
      userRole: { count: respond('userRole', 'count', () => 0) },
      notification: {
        createMany: respond('notification', 'createMany', () => ({ count: 2 })),
      },
    } as never as ConstructorParameters<typeof AndonService>[0];
  }

  function makeEvents(): { emitted: { name: string; payload: AndonEvent }[]; bus: BoardEventBus } {
    const emitted: { name: string; payload: AndonEvent }[] = [];
    // 只实现 Service 用到的 emit；断言经 emitted 数组，不依赖 eventemitter2 实例
    const bus = { emit: (name: string, payload: AndonEvent) => emitted.push({ name, payload }) };
    return { emitted, bus: bus as unknown as BoardEventBus };
  }

  const caller = { id: 7, username: 'operator' };
  const baseDto = { type: 'MATERIAL', workCenterId: 1, description: '缺料' };

  it('创建呼叫：code 生成、事件带摘要、通知 createMany 一次发给责任角色全部用户', async () => {
    const prisma = makePrisma();
    const svc = new AndonService(prisma, makeEvents().bus);
    const r = await svc.create(baseDto, caller);

    expect(r).toMatchObject({ id: 1, merged: false });
    expect(prisma.andonCall.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'MATERIAL', callerId: 7 }),
    }));
    expect(prisma.notification.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.notification.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ userId: 11 }), expect.objectContaining({ userId: 12 })],
    }));
  });

  it('合并：同工作中心同类型 OPEN 已存在 → 返回已有 id + merged=true，不再通知', async () => {
    const prisma = makePrisma();
    (prisma.andonCall.findFirst as jest.Mock).mockResolvedValue({ id: 42, code: 'AD-42', description: '旧呼叫' });
    const svc = new AndonService(prisma, makeEvents().bus);
    const r = await svc.create(baseDto, caller);

    expect(r).toEqual({ id: 42, code: 'AD-42', merged: true });
    expect(prisma.andonCall.create).not.toHaveBeenCalled();
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
    expect(prisma.andonCall.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 42 } }));
  });

  it('设备不属于该工作中心 → 400', async () => {
    const prisma = makePrisma();
    (prisma.equipment.findUnique as jest.Mock).mockResolvedValue({ id: 9, code: 'EQ-9', workCenterId: 2 });
    const svc = new AndonService(prisma, makeEvents().bus);
    await expect(svc.create({ ...baseDto, equipmentId: 9 }, caller)).rejects.toMatchObject({ code: 1001 });
  });

  it('非责任角色响应 → 403；admin 兜底放行', async () => {
    const prisma = makePrisma();
    (prisma.andonCall.findUnique as jest.Mock).mockResolvedValue({ id: 5, status: 'OPEN', type: 'MATERIAL', description: 'd' });
    const svc = new AndonService(prisma, makeEvents().bus);

    await expect(svc.respond(5, { id: 7, username: 'operator' })).rejects.toMatchObject({ code: 1003 });
    // admin 直接放行（不走 userRole.count）
    (prisma.andonCall.update as jest.Mock).mockResolvedValue({ id: 5, status: 'RESPONDED', type: 'MATERIAL', workCenterId: 1, code: 'AD-5', respondedAt: new Date() });
    await expect(svc.respond(5, { id: 1, username: 'admin' })).resolves.toMatchObject({ status: 'RESPONDED' });
  });

  it('关闭无 resolution → 400（不查库直接拒）', async () => {
    const prisma = makePrisma();
    const svc = new AndonService(prisma, makeEvents().bus);
    await expect(svc.close(1, '  ', { id: 1, username: 'maintainer' })).rejects.toMatchObject({ code: 1001 });
    expect(prisma.andonCall.findUnique).not.toHaveBeenCalled();
  });

  describe('escalateTimeouts(now)', () => {
    const NOW = new Date('2026-01-01T10:00:00Z');

    it('只升级超时且未升级的：calledAt < now-10min 才入选', async () => {
      const prisma = makePrisma();
      const svc = new AndonService(prisma, makeEvents().bus);
      await svc.escalateTimeouts(NOW);

      const where = (prisma.andonCall.findMany as jest.Mock).mock.calls[0][0].where;
      expect(where).toMatchObject({ status: 'OPEN', escalated: false });
      expect(where.calledAt.lt.getTime()).toBe(NOW.getTime() - 10 * 60_000);
    });

    it('超时呼叫：更新 escalated + 给 admin 角色用户发通知 + andon.escalated 事件（escalated: true）', async () => {
      const prisma = makePrisma();
      (prisma.andonCall.findMany as jest.Mock).mockResolvedValue([
        { id: 4, code: 'AD-4', type: 'EQUIPMENT', workCenterId: 1, description: '超时呼叫' },
      ]);
      const { bus, emitted } = makeEvents();
      const svc = new AndonService(prisma, bus);
      const n = await svc.escalateTimeouts(NOW);

      expect(n).toBe(1);
      expect(prisma.andonCall.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 4 }, data: { escalated: true, escalatedAt: NOW },
      }));
      // 升级通知发 admin（mock：无 userRoles 条件 → [{id:1}]）
      expect(prisma.notification.createMany).toHaveBeenCalledWith(expect.objectContaining({
        data: [expect.objectContaining({ userId: 1, title: expect.stringContaining('升级') })],
      }));
      expect(emitted).toEqual([expect.objectContaining({ name: 'andon.escalated', payload: expect.objectContaining({ escalated: true }) })]);
    });

    it('无超时呼叫：零更新零通知', async () => {
      const prisma = makePrisma();
      const { bus, emitted } = makeEvents();
      const svc = new AndonService(prisma, bus);
      expect(await svc.escalateTimeouts(NOW)).toBe(0);
      expect(prisma.andonCall.update).not.toHaveBeenCalled();
      expect(prisma.notification.createMany).not.toHaveBeenCalled();
      expect(emitted).toHaveLength(0);
    });

    it('超时分钟数来自字典 label；非法配置回落 10', async () => {
      const prisma = makePrisma();
      const svc = new AndonService(prisma, makeEvents().bus);
      expect(await svc.timeoutMinutes()).toBe(10);
      (prisma.dictItem.findFirst as jest.Mock).mockResolvedValue({ label: 'abc' });
      expect(await svc.timeoutMinutes()).toBe(10);
      (prisma.dictItem.findFirst as jest.Mock).mockResolvedValue({ label: '5' });
      expect(await svc.timeoutMinutes()).toBe(5);
    });
  });

  it('转换表联动：close 只在 RESPONDED 合法（Service 与表的一致性由 nextAndonStatus 保证）', () => {
    expect(nextAndonStatus('RESPONDED', 'close')).toBe('CLOSED');
    expect(nextAndonStatus('OPEN', 'respond')).toBe('RESPONDED');
  });
});
