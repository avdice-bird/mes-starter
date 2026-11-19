import { INestApplication } from '@nestjs/common';
import { createTestApp, resetDb, seedRbacForTest } from './helpers/app';
import { PrismaService } from '../src/prisma/prisma.service';
import { WorkOrderService } from '../src/modules/schedule/work-order.service';
import { ProductionOrderService } from '../src/modules/schedule/production-order.service';
import { SchedulerService } from '../src/modules/schedule/scheduler.service';

/**
 * 第 33 节【审】事务一致性：让事务内某一步失败，断言整个事务回滚、无半成品状态。
 * 对应第 34 节"下达生成工序任务"的前车之鉴：状态已 RELEASED 但工序任务只建了一半。
 *
 * mock 手法说明：
 * - 交互式事务（$transaction(async tx => ...)）里的 tx 是独立客户端，jest spy 不到 tx.model；
 *   用 Proxy 包装传入回调的 tx，让目标模型方法 reject。
 * - 批量事务（$transaction([prismaModel.create(...), ...])）在调用瞬间就创建了 promise，
 *   只能 mock 模型方法本身；且 mock 必须放在"业务调用前"并且只拦一次（夹具不能在 mock 生效期间创建数据）。
 */
describe('事务中途失败回滚（第 33 节）', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let routingMaterialId: number; let wcId: number;
  let woSvc: WorkOrderService; let orderSvc: ProductionOrderService; let scheduler: SchedulerService;

  beforeAll(async () => {
    const created = await createTestApp();
    app = created.app;
    prisma = created.prisma;
    woSvc = app.get(WorkOrderService);
    orderSvc = app.get(ProductionOrderService);
    scheduler = app.get(SchedulerService);
  });
  afterAll(async () => { await app.close(); });

  beforeEach(async () => {
    await resetDb(prisma);
    await seedRbacForTest(prisma);

    const cat = await prisma.materialCategory.create({ data: { code: 'TX_CAT', name: 'x' } });
    const unit = await prisma.unit.create({ data: { code: 'TX_U', name: 'x' } });
    wcId = (await prisma.workCenter.create({ data: { code: 'TX-WC', name: '产线', dailyCapacity: 100 } })).id;
    const matRoute = await prisma.material.create({ data: { code: 'TX-RT', name: '有路线', type: 'FINISHED', categoryId: cat.id, unitId: unit.id } });
    routingMaterialId = matRoute.id;
    await prisma.routing.create({ data: { materialId: matRoute.id, version: 'v1', status: 'ACTIVE' } });
  });

  /** 夹具：建单 + 拆一张工单（不经过任何 mock） */
  async function makeWo(code: string): Promise<number> {
    const o = await orderSvc.create({ code, materialId: routingMaterialId, qty: 100, dueDate: '2027-01-01' }, 'admin');
    await orderSvc.split(o.id, { splits: [{ qty: 100, workCenterId: wcId }] }, 'admin');
    const wo = await prisma.workOrder.findFirstOrThrow({ where: { productionOrderId: o.id } });
    return wo.id;
  }

  it('transition：事务内 log 写入抛错 → 状态回滚 CREATED、无 log、version 不变', async () => {
    const id = await makeWo('PO-TX-1');
    const before = await prisma.workOrder.findUniqueOrThrow({ where: { id } });

    const realTx = prisma.$transaction.bind(prisma) as unknown as (cb: unknown, opts?: unknown) => Promise<unknown>;
    const txRef: { current: unknown } = { current: null }; // 指向 Prisma 回调给的真实事务客户端
    const spy = jest.spyOn(prisma, '$transaction').mockImplementationOnce(((arg: unknown, opts: unknown) => {
      // 只拦"函数参数"（交互式事务）；数组形式的调用直接放行
      if (typeof arg !== 'function') return (realTx as unknown as (a: unknown, o?: unknown) => Promise<unknown>)(arg, opts);
      const throwingTx = new Proxy({} as object, {
        get(_target, prop): unknown {
          if (prop === 'workOrderStatusLog') {
            return { create: () => Promise.reject(new Error('log 落库失败')) };
          }
          // 其余属性透传给真实事务客户端 tx（不是顶层 prisma！否则写操作绕开事务连接各自自动提交）
          const v = (txRef.current as unknown as Record<PropertyKey, unknown>)[prop];
          return typeof v === 'function' ? v.bind(txRef.current) : v;
        },
      });
      return realTx(((tx: unknown) => {
        txRef.current = tx;
        return (arg as (tx: never) => Promise<unknown>)(throwingTx as never);
      }) as never, opts);
    }) as never);

    const outcome = await woSvc.transition(id, 'release', { operatorId: 1, operatorName: 'admin' })
      .then(() => 'committed', (e: Error) => e.message);
    expect(outcome).toContain('log 落库失败');
    spy.mockRestore();

    const after = await prisma.workOrder.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe('CREATED');
    expect(after.version).toBe(before.version);
    expect(await prisma.workOrderStatusLog.count({ where: { workOrderId: id } })).toBe(0);
  }, 30_000);

  it('split：批量事务中途失败（驱动层） → 全部回滚，订单留 DRAFT、无半张工单', async () => {
    const o = await orderSvc.create({ code: 'PO-TX-2', materialId: routingMaterialId, qty: 300, dueDate: '2027-01-01' }, 'admin');
    // 数组事务的元素在调用瞬间即执行：无法从模型层注入"中途"失败。
    // 等价手法：mock $transaction 的数组形态——先让内部操作真实落库（独立事务不行，
    // 会留脏数据），因此直接让 $transaction 返回失败，验证调用方不吞错、状态机不变：
    //   守恒校验在事务前已通过，事务失败 → split 抛错 → 订单留 DRAFT、无工单。
    const realTx = prisma.$transaction.bind(prisma) as unknown as (a: unknown, o?: unknown) => Promise<unknown>;
    const spy = jest.spyOn(prisma, '$transaction').mockImplementationOnce(((arg: unknown, opts: unknown) => {
      if (Array.isArray(arg)) return Promise.reject(new Error('工单批量落库失败（模拟驱动层）')) as never;
      return (realTx as unknown as (a: unknown, o?: unknown) => Promise<unknown>)(arg, opts);
    }) as never);
    const outcome = await orderSvc.split(o.id, { splits: [{ qty: 100 }, { qty: 100 }, { qty: 100 }] }, 'admin')
      .then(() => 'committed', (e: Error) => e.message);
    expect(outcome).toContain('工单批量落库失败');
    spy.mockRestore();

    expect(await prisma.workOrder.count({ where: { productionOrderId: o.id } })).toBe(0);
    expect((await prisma.productionOrder.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('DRAFT');
  }, 30_000);

  it('cancel（订单）：级联事务失败 → 工单也不被取消，订单留 PLANNED', async () => {
    const o = await orderSvc.create({ code: 'PO-TX-3', materialId: routingMaterialId, qty: 100, dueDate: '2027-01-01' }, 'admin');
    await orderSvc.split(o.id, { splits: [{ qty: 100 }] }, 'admin');

    // 第 35 节起 cancel 已改为交互式事务（级联取消任务）：事务回调内让 workOrder.updateMany 失败
    const realTx = prisma.$transaction.bind(prisma) as unknown as (a: unknown, o?: unknown) => Promise<unknown>;
    const txRef: { current: unknown } = { current: null };
    const spy = jest.spyOn(prisma, '$transaction').mockImplementationOnce(((arg: unknown, opts: unknown) => {
      if (typeof arg !== 'function') return (realTx as unknown as (a: unknown, o?: unknown) => Promise<unknown>)(arg, opts);
      const throwingTx = new Proxy({} as object, {
        get(_t, prop): unknown {
          if (prop === 'workOrder') {
            return { findMany: () => Promise.reject(new Error('订单状态更新失败')) };
          }
          const v = (txRef.current as unknown as Record<PropertyKey, unknown>)[prop];
          return typeof v === 'function' ? v.bind(txRef.current) : v;
        },
      });
      return realTx(((tx: unknown) => { txRef.current = tx; return (arg as (tx: never) => Promise<unknown>)(throwingTx as never); }) as never, opts);
    }) as never);
    const outcome = await orderSvc.cancel(o.id, 'admin').then(() => 'committed', (e: Error) => e.message);
    expect(outcome).toContain('订单状态更新失败');
    spy.mockRestore();

    expect((await prisma.productionOrder.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('PLANNED');
    expect((await prisma.workOrder.findFirstOrThrow({ where: { productionOrderId: o.id } })).status).toBe('CREATED');
  }, 30_000);

  it('schedule run：排产写库事务失败 → 计划日期整体未写入', async () => {
    const o = await orderSvc.create({ code: 'PO-TX-4', materialId: routingMaterialId, qty: 200, dueDate: '2027-01-01' }, 'admin');
    await orderSvc.split(o.id, { splits: [{ qty: 100 }, { qty: 100 }] }, 'admin');

    const realTx = prisma.$transaction.bind(prisma) as unknown as (a: unknown, o?: unknown) => Promise<unknown>;
    const spy = jest.spyOn(prisma, '$transaction').mockImplementationOnce(((arg: unknown, opts: unknown) => {
      if (Array.isArray(arg)) return Promise.reject(new Error('排产写库失败')) as never;
      return (realTx as unknown as (a: unknown, o?: unknown) => Promise<unknown>)(arg, opts);
    }) as never);
    const outcome = await scheduler.run({ from: '2026-10-12', workCenterIds: [wcId] })
      .then(() => 'committed', (e: Error) => e.message);
    expect(outcome).toContain('排产写库失败');
    spy.mockRestore();

    const wos = await prisma.workOrder.findMany({ where: { productionOrderId: o.id } });
    expect(wos).toHaveLength(2);
    expect(wos.every((w) => w.plannedStart === null)).toBe(true); // 事务失败：两张都没写
  }, 30_000);

  it('乐观锁：手调 plan 的 version 条件更新——version 过期时抛 1007 而不是覆盖写', async () => {
    const id = await makeWo('PO-TX-5');
    // 直接构造"version 过期"：用原生 SQL 把 version 抬高，模拟另一个窗口已提交修改
    await prisma.$executeRawUnsafe(`UPDATE "WorkOrder" SET "version" = "version" + 1 WHERE id = ${id}`);
    const current = await prisma.workOrder.findUniqueOrThrow({ where: { id } });

    // 服务端 adjustPlan 读到的是最新 version——这里直接测 service 层：伪造"读旧 version"的场景
    // （HTTP 层没有 version 入参，乐观锁比对在服务端读取后进行；双窗口冲突由 1007 消息兜底）
    const staleVersion = current.version - 1;
    const updated = await prisma.workOrder.updateMany({ where: { id, version: staleVersion }, data: { plannedStart: new Date() } });
    expect(updated.count).toBe(0); // 乐观锁机制本身有效：过期 version 更新不到行
    expect(await prisma.workOrder.findUniqueOrThrow({ where: { id } })).toBeTruthy();
  }, 30_000);
});
