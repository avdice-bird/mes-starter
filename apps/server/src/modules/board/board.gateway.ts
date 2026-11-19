import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Namespace } from 'socket.io';
import { BOARD_EVENT_BUS, BoardEventBus } from './board.events';
import type { EquipmentStatusChangedEvent, WorkOrderStatusChangedEvent, WorkReportCreatedEvent } from './board.events';
import type { AndonEvent } from '../andon/andon.service';

/**
 * 看板 Gateway（第 48 节）：命名空间 /board，互斥房间 all 与 wc:<id>（第 49 节改：不并播，防重复/越房间）。
 * 设计：推送事件不推送状态——业务 Service 发领域事件（EventEmitter2），这里监听后广播。
 * 鉴权（第 49 节用例 2/3）：握手带 token，无效/无 board:view 权限断开。
 *
 * 实现说明：不用 @nestjs/websockets 装饰器（ESM 包与 Jest CJS 不兼容，会污染全部 e2e），
 * 改为纯 socket.io 服务——由 main.ts 的 setupBoardGateway() 挂载，test 环境不调用。
 */
@Injectable()
export class BoardGateway {
  constructor(@Inject(BOARD_EVENT_BUS) private readonly eventBus: BoardEventBus) {}

  private server: Namespace | null = null;
  private readonly logger = new Logger(BoardGateway.name);

  /** main.ts 在 http server 创建后调用；test 环境不调用 */
  attach(server: Namespace, jwtVerify: (token: string) => { sub: number }, checkPermission: (userId: number) => Promise<boolean>): void {
    this.server = server;
    server.use(async (socket, next) => {
      try {
        const token = (socket.handshake.auth?.token ?? (socket.handshake.headers?.authorization as string | undefined)?.replace('Bearer ', '')) as string | undefined;
        if (!token) throw new Error('no token');
        const payload = jwtVerify(token);
        if (!(await checkPermission(payload.sub))) throw new Error('no board:view permission');
        socket.data = { userId: payload.sub };
        next();
      } catch (e) {
        next(new Error(`rejected: ${(e as Error).message}`));
      }
    });
    server.on('connection', (socket) => {
      // 房间互斥（第 49 节用例 4/5）：默认 all；watch-wc 后只在 wc:<id>，收不到其他 wc 的事件也不重复收
      socket.join('all');
      socket.on('watch-wc', (wcId: number | null) => {
        if (wcId === null) {
          for (const r of socket.rooms) if (r.startsWith('wc:')) socket.leave(r);
          socket.join('all');
          return;
        }
        if (!Number.isInteger(wcId) || wcId <= 0) return;
        socket.leave('all');
        for (const r of socket.rooms) if (r.startsWith('wc:')) socket.leave(r);
        socket.join(`wc:${wcId}`);
      });
      socket.on('disconnect', () => undefined);
    });
    this.eventBus.on('work-report.created', (e: WorkReportCreatedEvent) => this.onWorkReportCreated(e));
    this.eventBus.on('equipment.status-changed', (e: EquipmentStatusChangedEvent) => this.onEquipmentStatusChanged(e));
    this.eventBus.on('work-order.status-changed', (e: WorkOrderStatusChangedEvent) => this.onWorkOrderStatusChanged(e));
    // 安灯事件（第 50 节）：created/responded/escalated/closed 统一以 andon.* 推给看板（红块出现/消失）
    for (const name of ['andon.created', 'andon.responded', 'andon.escalated', 'andon.closed']) {
      this.eventBus.on(name, (e: AndonEvent) => {
        this.broadcast(e.workCenterId, name, {
          andonId: e.andonId, code: e.code, type: e.type,
          workCenterId: e.workCenterId, status: e.status, escalated: e.escalated ?? false,
        });
      });
    }
    this.logger.log('board gateway attached');
  }

  private broadcast(wcId: number | null, event: string, payload: unknown): void {
    if (!this.server) return;
    // 同时发 wc 房间与 all 房间：互斥入房（watch-wc）保证每个 socket 只在其中之一，恰收一份
    if (wcId) this.server.to(`wc:${wcId}`).emit(event, payload);
    this.server.to('all').emit(event, payload);
  }

  onWorkReportCreated(e: WorkReportCreatedEvent): void {
    this.broadcast(e.workCenterId, 'work-report.created', e);
  }

  onEquipmentStatusChanged(e: EquipmentStatusChangedEvent): void {
    this.broadcast(e.workCenterId, 'equipment.status-changed', e);
  }

  onWorkOrderStatusChanged(e: WorkOrderStatusChangedEvent): void {
    this.broadcast(e.workCenterId, 'work-order.status-changed', e);
  }
}
