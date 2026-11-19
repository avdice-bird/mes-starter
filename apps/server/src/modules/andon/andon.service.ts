import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { Inject } from '@nestjs/common';
import { BOARD_EVENT_BUS, BoardEventBus } from '../board/board.events';
import { nextAndonStatus } from './andon.state';
import type { CreateAndonCallDto } from './dto/andon.dto';

/** 安灯事件 payload（进看板）：只带摘要，不带描述明细（脱敏同看板事件，第 49 节用例 8） */
export interface AndonEvent {
  andonId: number;
  code: string;
  type: string;
  workCenterId: number;
  status: string;
  escalated?: boolean;
  at: string;
}

/**
 * 安灯（第 50-52 节）：呼叫 → 响应 → 关闭的小状态机 + 站内信 + 看板事件。
 * 状态流转只查转换表（andon.state.ts）；通知发给责任角色（字典 andon_responder_role）。
 * 超时升级（第 51 节）：escalateTimeouts(now) 由定时任务每分钟调用，now 参数传入以便测试（第 52 节检查题）。
 */
@Injectable()
export class AndonService {
  constructor(
    private prisma: PrismaService,
    @Inject(BOARD_EVENT_BUS) private readonly events: BoardEventBus,
  ) {}

  /** 呼叫类型 → 责任角色 code（字典 andon_responder_role；缺配置回落 OTHER→admin） */
  private static readonly FALLBACK_RESPONDER: Record<string, string> = {
    MATERIAL: 'planner',
    EQUIPMENT: 'maintainer',
    QUALITY: 'qc',
    OTHER: 'admin',
  };

  async responderRoleOf(type: string): Promise<string> {
    const item = await this.prisma.dictItem.findFirst({
      where: { value: type, dict: { code: 'andon_responder_role' } },
    });
    return item?.label ?? AndonService.FALLBACK_RESPONDER[type] ?? 'admin';
  }

  /** 超时分钟数（字典 andon_config / andon_timeout_minutes，默认 10） */
  async timeoutMinutes(): Promise<number> {
    const item = await this.prisma.dictItem.findFirst({
      where: { value: 'andon_timeout_minutes', dict: { code: 'andon_config' } },
    });
    const n = Number(item?.label);
    return Number.isFinite(n) && n > 0 ? n : 10;
  }

  /** 创建呼叫：同工作中心同类型已有 OPEN → 合并（返回已有 id + merged 标记），不重复通知（第 51 节用例 1） */
  async create(dto: CreateAndonCallDto, caller: { id: number; username: string }) {
    // EQUIPMENT 呼叫校验设备归属该工作中心（第 51 节用例 10）
    if (dto.equipmentId) {
      const eq = await this.prisma.equipment.findUnique({ where: { id: dto.equipmentId } });
      if (!eq) throw new BusinessException(ErrorCode.NOT_FOUND, `设备 ${dto.equipmentId} 不存在`);
      if (eq.workCenterId !== dto.workCenterId) {
        throw new BusinessException(ErrorCode.VALIDATION, `设备 ${eq.code} 不属于该工作中心`);
      }
    }

    const open = await this.prisma.andonCall.findFirst({
      where: { workCenterId: dto.workCenterId, type: dto.type, status: 'OPEN' },
      orderBy: { id: 'desc' },
    });
    if (open) {
      // 合并：记录"再次呼叫"——追加到描述末尾，不新增通知
      const again = `${open.description}\n[${new Date().toISOString()}] 再次呼叫（${caller.username}）`;
      await this.prisma.andonCall.update({ where: { id: open.id }, data: { description: again } });
      return { id: open.id, code: open.code, merged: true };
    }

    const seq = Date.now();
    const call = await this.prisma.andonCall.create({
      data: {
        code: `AD-${seq}`,
        type: dto.type,
        workCenterId: dto.workCenterId,
        equipmentId: dto.equipmentId,
        workOrderId: dto.workOrderId,
        workOrderOperationId: dto.workOrderOperationId,
        description: dto.description,
        callerId: caller.id,
      },
    });

    await this.notifyResponderRoles(call.id, call.code, call.type, call.workCenterId, call.description);

    this.events.emit('andon.created', {
      andonId: call.id, code: call.code, type: call.type,
      workCenterId: call.workCenterId, status: call.status, at: call.calledAt.toISOString(),
    } satisfies AndonEvent);
    return { id: call.id, code: call.code, merged: false };
  }

  /** 给责任角色所有启用用户发站内信；返回通知数（测试断言用） */
  async notifyResponderRoles(
    andonId: number, code: string, type: string, workCenterId: number, description: string,
    titleSuffix = '',
  ): Promise<number> {
    const roleCode = await this.responderRoleOf(type);
    const users = await this.prisma.user.findMany({
      where: { status: 1, userRoles: { some: { role: { code: roleCode } } } },
      select: { id: true },
    });
    if (users.length) {
      await this.prisma.notification.createMany({
        data: users.map((u) => ({
          userId: u.id,
          title: `安灯呼叫 ${code}${titleSuffix}`,
          content: description.slice(0, 200),
          type: 'ANDON',
          refType: 'AndonCall',
          refId: andonId,
        })),
      });
    }
    return users.length;
  }

  /** 响应：从 token 取响应人（不信任请求体，第 51 节用例 9）；权限在 Controller 守卫 + 这里责任角色校验 */
  async respond(id: number, responder: { id: number; username: string }, remark?: string) {
    const call = await this.prisma.andonCall.findUnique({ where: { id } });
    if (!call) throw new BusinessException(ErrorCode.NOT_FOUND, `安灯 ${id} 不存在`);
    const target = nextAndonStatus(call.status, 'respond');

    // 非责任角色 403；admin 兜底放行（第 51 节用例 3/4）
    if (responder.username !== 'admin') {
      const roleCode = await this.responderRoleOf(call.type);
      const owned = await this.prisma.userRole.count({
        where: { userId: responder.id, role: { code: roleCode } },
      });
      if (!owned) throw new BusinessException(ErrorCode.FORBIDDEN, `仅责任角色 ${roleCode} 可响应`);
    }

    const updated = await this.prisma.andonCall.update({
      where: { id },
      data: { status: target, responderId: responder.id, respondedAt: new Date(), description: remark ? `${call.description}\n[响应] ${remark}` : call.description },
    });
    this.events.emit('andon.responded', {
      andonId: updated.id, code: updated.code, type: updated.type,
      workCenterId: updated.workCenterId, status: updated.status, at: (updated.respondedAt ?? new Date()).toISOString(),
    } satisfies AndonEvent);
    return { id: updated.id, status: updated.status };
  }

  /** 关闭：需 resolution（400 校验）；RESPONDED → CLOSED */
  async close(id: number, resolution: string, closer: { id: number; username: string }) {
    if (!resolution || resolution.trim().length < 2) {
      throw new BusinessException(ErrorCode.VALIDATION, '关闭必须填写处理结果（resolution）');
    }
    const call = await this.prisma.andonCall.findUnique({ where: { id } });
    if (!call) throw new BusinessException(ErrorCode.NOT_FOUND, `安灯 ${id} 不存在`);
    const target = nextAndonStatus(call.status, 'close');

    const updated = await this.prisma.andonCall.update({
      where: { id },
      data: { status: target, closedAt: new Date(), resolution },
    });
    this.events.emit('andon.closed', {
      andonId: updated.id, code: updated.code, type: updated.type,
      workCenterId: updated.workCenterId, status: updated.status, at: (updated.closedAt ?? new Date()).toISOString(),
    } satisfies AndonEvent);
    void closer;
    return { id: updated.id, status: updated.status };
  }

  /** 取消：仅呼叫人本人且 OPEN（第 51 节用例 6/7） */
  async cancel(id: number, reason: string, caller: { id: number; username: string }) {
    const call = await this.prisma.andonCall.findUnique({ where: { id } });
    if (!call) throw new BusinessException(ErrorCode.NOT_FOUND, `安灯 ${id} 不存在`);
    if (call.callerId !== caller.id) throw new BusinessException(ErrorCode.FORBIDDEN, '仅呼叫人可取消');
    const target = nextAndonStatus(call.status, 'cancel');
    const updated = await this.prisma.andonCall.update({
      where: { id },
      data: { status: target, cancelReason: reason },
    });
    this.events.emit('andon.closed', {
      andonId: updated.id, code: updated.code, type: updated.type,
      workCenterId: updated.workCenterId, status: updated.status, at: new Date().toISOString(),
    } satisfies AndonEvent);
    return { id: updated.id, status: updated.status };
  }

  /** 超时升级（第 51 节用例 2）：OPEN 且 calledAt 超过配置分钟且未升级 → escalated + 通知 admin。
   *  now 由调用方传入：定时任务传当前时间；测试传固定时间（第 52 节检查题——可测定，不 sleep） */
  async escalateTimeouts(now: Date): Promise<number> {
    const minutes = await this.timeoutMinutes();
    const deadline = new Date(now.getTime() - minutes * 60_000);
    const overdue = await this.prisma.andonCall.findMany({
      where: { status: 'OPEN', escalated: false, calledAt: { lt: deadline } },
      select: { id: true, code: true, type: true, workCenterId: true, description: true },
    });
    for (const call of overdue) {
      await this.prisma.andonCall.update({
        where: { id: call.id },
        data: { escalated: true, escalatedAt: now },
      });
      // 升级通知 admin 角色所有用户
      const admins = await this.prisma.user.findMany({
        where: { status: 1, userRoles: { some: { role: { code: 'admin' } } } },
        select: { id: true },
      });
      if (admins.length) {
        await this.prisma.notification.createMany({
          data: admins.map((u) => ({
            userId: u.id,
            title: `安灯升级 ${call.code}`,
            content: `呼叫超过 ${minutes} 分钟未响应：${call.description.slice(0, 150)}`,
            type: 'ANDON',
            refType: 'AndonCall',
            refId: call.id,
          })),
        });
      }
      this.events.emit('andon.escalated', {
        andonId: call.id, code: call.code, type: call.type,
        workCenterId: call.workCenterId, status: 'OPEN', escalated: true, at: now.toISOString(),
      } satisfies AndonEvent);
    }
    return overdue.length;
  }

  /** 列表（看板"当前安灯"与安灯页共用） */
  async list(query: { page?: number; pageSize?: number; status?: string; workCenterId?: number }) {
    const page = Number(query.page) > 0 ? Number(query.page) : 1;
    const pageSize = Math.min(Number(query.pageSize) > 0 ? Number(query.pageSize) : 20, 200);
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.workCenterId ? { workCenterId: Number(query.workCenterId) } : {}),
    };
    const [list, total] = await Promise.all([
      this.prisma.andonCall.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          caller: { select: { username: true, name: true } },
          responder: { select: { username: true, name: true } },
          workCenter: { select: { code: true, name: true } },
          equipment: { select: { code: true, name: true } },
        },
      }),
      this.prisma.andonCall.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  /** 看板初始化：当前 OPEN 呼叫（红块数据源） */
  async openCalls(workCenterId?: number) {
    return this.prisma.andonCall.findMany({
      where: { status: 'OPEN', ...(workCenterId ? { workCenterId } : {}) },
      orderBy: { calledAt: 'asc' },
      select: {
        id: true, code: true, type: true, workCenterId: true, escalated: true,
        calledAt: true, description: true,
      },
    });
  }
}
