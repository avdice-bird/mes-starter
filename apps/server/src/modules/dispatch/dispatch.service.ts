import { Injectable } from '@nestjs/common';
import { Prisma, WorkOrderOperation } from '@prisma/client';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../prisma/prisma.service';
import {
  allOperationsCompleted, computeFlowTransitions, OperationState, prevOperation,
} from './operation-flow';

type Tx = Prisma.TransactionClient;

/** SQLite 写串行 + 高并发排队：交互式事务给足 maxWait/timeout（第 40 节攻击1 发现默认 2s/5s 不够） */
const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

/** 派工与流转（第 34-35 节）：任务生成在 release 事务内（WorkOrderService.transition 调用） */
@Injectable()
export class DispatchService {
  constructor(private prisma: PrismaService) {}

  /** 任务列表（按 seq 排序） */
  async listByWorkOrder(workOrderId: number): Promise<WorkOrderOperation[]> {
    return this.prisma.workOrderOperation.findMany({
      where: { workOrderId },
      orderBy: { seq: 'asc' },
      include: {
        workCenter: { select: { code: true, name: true } },
        team: { select: { code: true, name: true } },
        employee: { select: { code: true, name: true } },
        equipment: { select: { code: true, name: true } },
      },
    });
  }

  /**
   * release 事务内调用：复制 ACTIVE 路线的工序生成任务快照。
   * 必须在 WorkOrder 状态更新、log 写入的同一个事务回调里执行（ADR-003）。
   */
  async generateTasksForRelease(tx: Tx, workOrderId: number, routingId: number, qty: number): Promise<number> {
    const ops = await tx.routingOperation.findMany({
      where: { routingId },
      orderBy: { seq: 'asc' },
    });
    if (ops.length === 0) {
      throw new BusinessException(ErrorCode.OP_NOT_READY, '路线没有工序，不能下达');
    }
    await tx.workOrderOperation.createMany({
      data: ops.map((op, i) => ({
        workOrderId,
        seq: op.seq,
        operationCode: op.code,
        operationName: op.name,
        workCenterId: op.workCenterId,
        standardMinutes: op.standardMinutes,
        isInspectionPoint: op.isInspectionPoint,
        plannedQty: qty, // 初始全部 = 工单 qty；随上道完工按不变量动态下调（第 35 节用例 5）
        status: i === 0 ? 'READY' : 'PENDING',
        createdBy: 'dispatch',
        updatedBy: 'dispatch',
      })),
    });
    return ops.length;
  }

  /** 派工：班组 / 员工 / 设备（校验见第 35 节用例 6-8） */
  async assign(id: number, dto: { teamId?: number; employeeId?: number; equipmentId?: number }, operator: string) {
    const op = await this.getOperation(id);
    if (op.status === 'COMPLETED' || op.status === 'CANCELLED') {
      throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, `任务已${op.status === 'COMPLETED' ? '完工' : '取消'}，不能再派工`);
    }
    const workOrder = await this.prisma.workOrder.findUniqueOrThrow({ where: { id: op.workOrderId } });
    if (workOrder.status === 'CANCELLED' || workOrder.status === 'CLOSED') {
      throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, `工单状态为 ${workOrder.status}，不能派工`);
    }

    let teamId = dto.teamId;
    if (dto.teamId !== undefined) await this.assertTeam(dto.teamId, op.workCenterId);
    if (dto.employeeId !== undefined) {
      const emp = await this.assertEmployee(dto.employeeId, op);
      // 员工必须属于所派班组（第 40 节攻击项 4 的一并加固）
      if (teamId !== undefined && emp.teamId !== teamId) {
        throw new BusinessException(ErrorCode.VALIDATION, `员工不属于班组 ${teamId}`);
      }
      teamId = teamId ?? emp.teamId;
    }
    if (dto.equipmentId !== undefined) await this.assertEquipment(dto.equipmentId, op.workCenterId);

    const updated = await this.prisma.workOrderOperation.updateMany({
      where: { id, version: op.version },
      data: {
        ...(teamId !== undefined ? { teamId } : {}),
        ...(dto.employeeId !== undefined ? { employeeId: dto.employeeId } : {}),
        ...(dto.equipmentId !== undefined ? { equipmentId: dto.equipmentId } : {}),
        version: { increment: 1 },
        updatedBy: operator,
      },
    });
    if (updated.count === 0) throw new BusinessException(ErrorCode.CONCURRENT_CONFLICT, '任务已被他人修改，请刷新重试');
    return this.prisma.workOrderOperation.findUniqueOrThrow({ where: { id } });
  }

  /** 开工：READY → IN_PROGRESS；首道开工时工单自动 IN_PROGRESS（在 transition 之外，独立小事务） */
  async start(id: number, operator: string) {
    const op = await this.getOperation(id);
    if (op.status !== 'READY') {
      throw new BusinessException(ErrorCode.OP_NOT_READY, op.status === 'PENDING' ? '工序未就绪（上道未完工）' : `任务状态为 ${op.status}，不能开工`);
    }
    const workOrder = await this.prisma.workOrder.findUniqueOrThrow({ where: { id: op.workOrderId } });
    // 工单 RELEASED（首道开工前）或 IN_PROGRESS（首道开工后）都可开工任务；PAUSED/CANCELLED 等拒绝（用例 9）
    if (workOrder.status !== 'RELEASED' && workOrder.status !== 'IN_PROGRESS') {
      throw new BusinessException(ErrorCode.OP_NOT_READY, `工单状态为 ${workOrder.status}，任务不能开工（第 35 节用例 9）`);
    }

    await this.prisma.$transaction(async (tx) => {
      const current = await tx.workOrderOperation.findUniqueOrThrow({ where: { id } });
      if (current.status !== 'READY') {
        throw new BusinessException(ErrorCode.OP_NOT_READY, '任务状态已变化，请刷新');
      }
      const updated = await tx.workOrderOperation.updateMany({
        where: { id, version: current.version, status: 'READY' },
        data: { status: 'IN_PROGRESS', startedAt: new Date(), version: { increment: 1 }, updatedBy: operator },
      });
      if (updated.count === 0) throw new BusinessException(ErrorCode.CONCURRENT_CONFLICT, '任务已被他人修改');
      // 工单同步转 IN_PROGRESS（幂等：已是 IN_PROGRESS 则跳过）
      if (workOrder.status === 'RELEASED') {
        const wo = await tx.workOrder.updateMany({
          where: { id: workOrder.id, status: 'RELEASED' },
          data: { status: 'IN_PROGRESS' },
        });
        if (wo.count > 0) {
          await tx.workOrderStatusLog.create({
            data: {
              workOrderId: workOrder.id, fromStatus: 'RELEASED', toStatus: 'IN_PROGRESS',
              action: 'start', operatorName: operator,
            },
          });
        }
      }
    }, TX_OPTIONS);
    return this.prisma.workOrderOperation.findUniqueOrThrow({ where: { id } });
  }

  /**
   * 临时完工接口（第 34 节；第 37 节被报工替代后删除）。
   * 数量累加 + 流转（复用 computeFlowTransitions），末道完成回写工单 completedQty。
   */
  async completeQty(id: number, qty: number, defectQty: number, operator: string) {
    const op = await this.getOperation(id);
    if (op.status !== 'IN_PROGRESS') {
      throw new BusinessException(ErrorCode.OP_NOT_READY, `任务状态为 ${op.status}，先开工再报完工`);
    }
    if (op.completedQty + qty > op.plannedQty) {
      throw new BusinessException(ErrorCode.QTY_EXCEEDED, `累计良品将超过计划数量（${op.completedQty}+${qty} > ${op.plannedQty}）`);
    }

    await this.prisma.$transaction(async (tx) => {
      const current = await tx.workOrderOperation.findUniqueOrThrow({ where: { id } });
      const updated = await tx.workOrderOperation.updateMany({
        where: { id, version: current.version, status: 'IN_PROGRESS' },
        data: {
          completedQty: current.completedQty + qty,
          defectQty: current.defectQty + defectQty,
          version: { increment: 1 },
          updatedBy: operator,
        },
      });
      if (updated.count === 0) throw new BusinessException(ErrorCode.CONCURRENT_CONFLICT, '任务已被他人修改，请刷新重试');

      await this.applyFlow(tx, id, operator);
    }, TX_OPTIONS);
    return this.prisma.workOrderOperation.findUniqueOrThrow({ where: { id } });
  }

  /**
   * 流转执行（事务内）：根据最新任务数量计算状态变更并落地。
   * 报工（第 37 节）复用本方法，不复制一份。
   */
  async applyFlow(tx: Tx, operationId: number, operator: string): Promise<void> {
    const ops = (await tx.workOrderOperation.findMany({ where: { workOrderId: (await tx.workOrderOperation.findUniqueOrThrow({ where: { id: operationId } })).workOrderId } }))
      .map((o) => this.toState(o));
    const changes = computeFlowTransitions(ops, operationId);
    // 质检点联动（第 45 节用例 1）：本道是质检点且本次报满 → 过滤掉"本道 COMPLETED / 下道 READY"变更，
    // 生成 IPQC 待检单，本道保持 IN_PROGRESS（qcHold），直到 IPQC PASS/CONCESSION
    const flowOp = ops.find((o) => o.id === operationId)!;
    const isQcHold = flowOp.isInspectionPoint
      && flowOp.completedQty + flowOp.defectQty >= flowOp.plannedQty
      && !(await tx.inspection.findFirst({
          where: { refType: 'OPERATION', refId: operationId, result: { in: ['PASS', 'CONCESSION'] } },
        }));
    const nextId = ops.filter((o) => o.status !== 'CANCELLED').sort((a, b) => a.seq - b.seq)
      .find((o) => o.seq > flowOp.seq)?.id;
    const effectiveChanges = isQcHold
      ? changes.filter((ch) => ch.opId !== nextId && ch.to !== 'READY') // 只拦"下道 READY"，保留本道 COMPLETED 等其它
      : changes;
    for (const ch of effectiveChanges) {
      const data: Prisma.WorkOrderOperationUpdateManyMutationInput = {
        status: ch.to,
        version: { increment: 1 },
        updatedBy: operator,
      };
      if (ch.to === 'COMPLETED') data.completedAt = new Date();
      if (ch.plannedQty !== undefined) data.plannedQty = ch.plannedQty;
      await tx.workOrderOperation.updateMany({ where: { id: ch.opId }, data });
    }
    // 工单 completedQty 同步（第 41 节：分批入库需要完工数实时可见）。
    // 口径：**最后一道有产出的工序**的良品数（半成品中途产出也可入库）；
    // 末道尚无产出时不覆盖（避免把已有数量倒扣回 0——M3 互测发现的覆盖 bug）。
    const woId = (await tx.workOrderOperation.findUniqueOrThrow({ where: { id: operationId } })).workOrderId;
    const freshOps = (await tx.workOrderOperation.findMany({ where: { workOrderId: woId } }))
      .map((o) => this.toState(o));
    const sorted = freshOps.filter((o) => o.status !== 'CANCELLED').sort((a, b) => a.seq - b.seq);
    const currentWo = await tx.workOrder.findUniqueOrThrow({ where: { id: woId } });
    const withOutput = [...sorted].reverse().find((o) => o.completedQty > 0);
    if (withOutput && withOutput.completedQty !== currentWo.completedQty) {
      await tx.workOrder.update({
        where: { id: woId },
        data: { completedQty: withOutput.completedQty, updatedBy: operator },
      });
    }

    if (isQcHold) {
      await tx.inspection.create({
        data: {
          code: `IPQC-${Date.now().toString(36).toUpperCase()}-${operationId}`,
          type: 'IPQC',
          refType: 'OPERATION',
          refId: operationId,
          sampleQty: flowOp.plannedQty,
          createdBy: 'flow',
        },
      });
      return; // 下道保持 PENDING
    }
  }

  /** 工单 complete 前置：全部任务完成（第 35 节用例 11） */
  async assertAllOperationsDone(workOrderId: number): Promise<void> {
    const ops = await this.prisma.workOrderOperation.findMany({ where: { workOrderId } }).then((rows) => rows.map((o) => this.toState(o)));
    if (ops.length === 0) {
      throw new BusinessException(ErrorCode.OP_NOT_READY, '工单没有工序任务，不能完工');
    }
    if (!allOperationsCompleted(ops)) {
      const remaining = ops.filter((o) => o.status !== 'COMPLETED').length;
      throw new BusinessException(ErrorCode.OP_NOT_READY, `还有 ${remaining} 道工序未完工，不能完工`);
    }
  }

  /** 上道良品数（第 35 节不变量：本道累计 ≤ 上道良品） */
  async prevGoodQty(tx: Tx, workOrderId: number, seq: number): Promise<number | null> {
    const ops = (await tx.workOrderOperation.findMany({ where: { workOrderId } })).map((o) => this.toState(o));
    const prev = prevOperation(ops, seq);
    return prev ? prev.completedQty : null;
  }

  /** 跳过工序（allowSkip=true 专用，第 35 节用例 4）：标记跳过 → 本道 COMPLETED，下道 READY */
  async skip(id: number, operator: string) {
    const op = await this.getOperation(id);
    if (op.skipped) throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, '任务已跳过');
    // allowSkip 快照自路线工序；快照表存 isInspectionPoint 但 allowSkip 需要快照——
    // 用 operationCode + workOrderId 反查路线工序不可靠（快照原则），故直接按 inspection 点禁止跳过：
    // 质检点不允许跳过是业务铁律，其余工序放开（快照表未存 allowSkip，第 35 节决策：跳过放开但质检点禁止）
    if (op.isInspectionPoint) {
      throw new BusinessException(ErrorCode.VALIDATION, '质检点工序不允许跳过');
    }
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.workOrderOperation.findUniqueOrThrow({ where: { id } });
      if (current.status === 'COMPLETED' || current.status === 'CANCELLED') {
        throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, `任务状态为 ${current.status}，不能跳过`);
      }
      const updated = await tx.workOrderOperation.updateMany({
        where: { id, version: current.version },
        data: { skipped: true, status: 'COMPLETED', completedAt: new Date(), version: { increment: 1 }, updatedBy: operator },
      });
      if (updated.count === 0) throw new BusinessException(ErrorCode.CONCURRENT_CONFLICT, '任务已被他人修改');
      await this.applyFlow(tx, id, operator);
    }, TX_OPTIONS);
    return this.prisma.workOrderOperation.findUniqueOrThrow({ where: { id } });
  }

  /** 工单取消级联（第 35 节用例 10）：未完工任务全部置 CANCELLED（由 WorkOrderService.cancel 调用） */
  async cancelTasksOfOrder(tx: Tx, workOrderId: number, operator: string): Promise<void> {
    await tx.workOrderOperation.updateMany({
      where: { workOrderId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      data: { status: 'CANCELLED', updatedBy: operator },
    });
  }

  private toState(o: WorkOrderOperation): OperationState {
    return {
      id: o.id, seq: o.seq,
      status: o.status as OperationState['status'],
      plannedQty: o.plannedQty, completedQty: o.completedQty, defectQty: o.defectQty,
      skipped: o.skipped, isInspectionPoint: o.isInspectionPoint,
    };
  }

  private async getOperation(id: number) {
    const op = await this.prisma.workOrderOperation.findUnique({ where: { id } });
    if (!op) throw new BusinessException(ErrorCode.NOT_FOUND, '工序任务不存在');
    return op;
  }

  private async assertTeam(teamId: number, workCenterId: number) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new BusinessException(ErrorCode.NOT_FOUND, `班组 ${teamId} 不存在`);
    if (team.workCenterId !== workCenterId) {
      throw new BusinessException(ErrorCode.VALIDATION, `班组 ${team.name} 不属于该工序的工作中心`);
    }
  }

  private async assertEmployee(employeeId: number, op: WorkOrderOperation) {
    const emp = await this.prisma.employee.findUnique({ where: { id: employeeId }, include: { skills: true, team: true } });
    if (!emp) throw new BusinessException(ErrorCode.NOT_FOUND, `员工 ${employeeId} 不存在`);
    if (emp.status !== 'ACTIVE') throw new BusinessException(ErrorCode.VALIDATION, `员工 ${emp.name} 已离职，不能派工`);
    // 第 35 节用例 6：无技能 → 拒绝（选"拒绝"而非警告：技能数据第 23 节已建，拒绝成本为零）
    const hasSkill = emp.skills.some((s) => s.workCenterId === op.workCenterId || s.opCode === op.operationCode);
    if (!hasSkill && emp.skills.length > 0) {
      throw new BusinessException(ErrorCode.VALIDATION, `员工 ${emp.name} 没有工序 ${op.operationName} 所需技能`);
    }
    return emp;
  }

  private async assertEquipment(equipmentId: number, workCenterId: number) {
    const eq = await this.prisma.equipment.findUnique({ where: { id: equipmentId } });
    if (!eq) throw new BusinessException(ErrorCode.NOT_FOUND, `设备 ${equipmentId} 不存在`);
    if (eq.workCenterId !== workCenterId) {
      throw new BusinessException(ErrorCode.VALIDATION, `设备 ${eq.name} 不属于该工序的工作中心`);
    }
    // 第 47 节用例 8：FAULT 设备不能派工
    if (eq.status === 'FAULT') {
      throw new BusinessException(ErrorCode.VALIDATION, `设备 ${eq.name} 故障中，不能派工`);
    }
  }
}
