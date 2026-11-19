import { Inject, Injectable } from '@nestjs/common';
import { BOARD_EVENT_BUS, BoardEventBus } from '../board/board.events';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { CreateWorkReportDto } from './dto/work-report.dto';
import { DispatchService } from '../dispatch/dispatch.service';

/** 超产容差：0 = 不允许超产；5 = 允许超产 5%（第 38 节决策，后续可挪到 SystemSetting/字典） */
export const OVERPRODUCTION_RATE_PCT = 0;

type Tx = import('@prisma/client').Prisma.TransactionClient;

/** SQLite 写串行 + 高并发排队：交互式事务给足 maxWait/timeout（默认 2s/5s 不够，第 40 节攻击1 发现） */
const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

/** 报工（第 37 节）：流水 + 累计 + 流转，一个事务；幂等键兜底重复提交 */
@Injectable()
export class WorkReportService {
  constructor(
    private prisma: PrismaService,
    private dispatch: DispatchService,
    @Inject(BOARD_EVENT_BUS) private events: BoardEventBus,
  ) {}

  /**
   * 报工主流程（一个交互式事务）：
   * 1. 幂等：同 idempotencyKey 已存在 → 直接返回该条（200，不重复累计）
   * 2. 校验：任务状态、工单状态、数量边界、reportedAt 边界、上道良品不变量
   * 3. 插入流水 + 任务原子累加（completedQty = completedQty + ?）
   * 4. 复用 DispatchService.applyFlow 做状态流转（不复制一份）
   */
  async create(dto: CreateWorkReportDto, operator: string) {
    if (dto.goodQty + dto.defectQty <= 0) {
      throw new BusinessException(ErrorCode.VALIDATION, '良品数与不良品数不能同时为 0');
    }

    // 幂等检查在事务外快速路径（unique 约束在事务内兜底竞态）
    const existed = await this.prisma.workReport.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
    if (existed) return this.withShift(existed);

    return this.prisma.$transaction(async (tx) => {
      // 幂等兜底（事务内再查一次：并发同 key 提交只有一个能插成功）
      const dup = await tx.workReport.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
      if (dup) return this.withShift(dup);

      const op = await tx.workOrderOperation.findUnique({ where: { id: dto.workOrderOperationId } });
      if (!op) throw new BusinessException(ErrorCode.NOT_FOUND, '工序任务不存在');
      if (op.status !== 'IN_PROGRESS') {
        throw new BusinessException(ErrorCode.OP_NOT_READY, `任务状态为 ${op.status}，只有进行中的任务可报工`);
      }
      const workOrder = await tx.workOrder.findUniqueOrThrow({ where: { id: op.workOrderId } });
      if (workOrder.status === 'PAUSED') {
        throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, '工单已暂停，不能报工');
      }
      if (workOrder.status !== 'IN_PROGRESS') {
        throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, `工单状态为 ${workOrder.status}，不能报工`);
      }

      const reportedAt = dto.reportedAt ? new Date(dto.reportedAt) : new Date();
      if (reportedAt.getTime() > Date.now() + 60_000) {
        throw new BusinessException(ErrorCode.VALIDATION, '报工时间不能在未来');
      }
      if (reportedAt < workOrder.updatedAt) {
        // 用 updatedAt 近似下达时刻：log 里 release 的 createdAt 更准但代价高；本口径写进验收
        const releaseLog = await tx.workOrderStatusLog.findFirst({
          where: { workOrderId: workOrder.id, action: 'release' }, orderBy: { id: 'desc' },
        });
        if (releaseLog && reportedAt < releaseLog.createdAt) {
          throw new BusinessException(ErrorCode.VALIDATION, '报工时间不能早于工单下达时间');
        }
      }

      // 数量校验：累计（含本次）≤ plannedQty × (1 + 超产容差)；不良不占上道良品额度
      const allowance = Math.floor((op.plannedQty * (100 + OVERPRODUCTION_RATE_PCT)) / 100);
      if (op.completedQty + dto.goodQty + dto.defectQty > allowance) {
        throw new BusinessException(ErrorCode.QTY_EXCEEDED, `累计 ${op.completedQty + dto.goodQty + dto.defectQty} 超过计划 ${op.plannedQty}（超产容差 ${OVERPRODUCTION_RATE_PCT}%）`);
      }
      // 第 35 节不变量：本道报工良品 ≤ 上道良品（首道无上道）
      const prev = await this.dispatch.prevGoodQty(tx, op.workOrderId, op.seq);
      if (prev !== null && op.completedQty + dto.goodQty > prev) {
        throw new BusinessException(ErrorCode.QTY_EXCEEDED, `本道累计良品 ${op.completedQty + dto.goodQty} 超过上道良品 ${prev}`);
      }
      // 员工与派工班组一致性（第 38 节用例 11：拒绝）
      if (op.teamId) {
        const emp = await tx.employee.findUnique({ where: { id: dto.employeeId } });
        // findUniqueOrThrow 在这里会抛 P2025 → 500；统一走下面的 404/校验分支给友好错误
        if (!emp) throw new BusinessException(ErrorCode.NOT_FOUND, `报工员工 ${dto.employeeId} 不存在`);
        if (emp.teamId !== op.teamId) {
          throw new BusinessException(ErrorCode.VALIDATION, '员工不在该任务派工的班组');
        }
      }

      // 班次快照：按 reportedAt 推算（第 23 节算法），事务内无法调用外部 service（自身 prisma 即可）
      const shift = await this.pickShift(tx, reportedAt);

      // 员工存在性（FK 兜底会 500，这里给明确 404；第 40 节攻击项 4 的正面加固）
      const employee = await tx.employee.findUnique({ where: { id: dto.employeeId } });
      if (!employee) throw new BusinessException(ErrorCode.NOT_FOUND, `报工员工 ${dto.employeeId} 不存在`);
      if (employee.status !== 'ACTIVE') throw new BusinessException(ErrorCode.VALIDATION, `员工 ${employee.name} 已离职，不能报工`);

      // 插入流水（幂等键 unique 兜底竞态）
      const report = await tx.workReport.create({
        data: {
          workOrderOperationId: op.id,
          workOrderId: op.workOrderId,
          employeeId: dto.employeeId,
          teamId: op.teamId,
          equipmentId: op.equipmentId, // 派工设备快照（OEE 表现性因子依赖，第 54 节对账补）
          shiftId: shift?.id ?? null,
          goodQty: dto.goodQty,
          defectQty: dto.defectQty,
          workMinutes: dto.workMinutes ?? 0,
          reportedAt,
          idempotencyKey: dto.idempotencyKey,
          remark: dto.remark,
          createdBy: operator,
        },
      }).catch((e: { code?: string }) => {
        if (e.code === 'P2002') throw new BusinessException(ErrorCode.CONFLICT, '重复提交（幂等键冲突）');
        throw e;
      });

      // 任务原子累加 + 版本推进（比读-改-写稳，第 38 节）
      await tx.workOrderOperation.update({
        where: { id: op.id },
        data: {
          completedQty: { increment: dto.goodQty },
          defectQty: { increment: dto.defectQty },
          version: { increment: 1 },
        },
      });

      // 流转（复用第 34 节逻辑）：数量补满 → COMPLETED → 下道 READY → 末道回写工单
      await this.dispatch.applyFlow(tx, op.id, operator);

      // 看板事件（第 48 节）：推送事件不推送状态，业务代码不依赖 WebSocket
      const woForEvent = await tx.workOrder.findUniqueOrThrow({ where: { id: op.workOrderId } });
      this.events.emit('work-report.created', {
        workOrderId: op.workOrderId,
        workOrderCode: woForEvent.code,
        operationId: op.id,
        operationName: op.operationName,
        goodQty: dto.goodQty,
        defectQty: dto.defectQty,
        employeeName: employee.name,
        workCenterId: op.workCenterId,
        at: new Date().toISOString(),
      } as import('../board/board.events').WorkReportCreatedEvent);

      return this.withShift(report);
    }, TX_OPTIONS);
  }

  /** 撤销：生成负数流水；任务数量回退；末道状态可能回退（第 38 节） */
  async reverse(reportId: number, reason: string, operator: string) {
    return this.prisma.$transaction(async (tx) => {
      const original = await tx.workReport.findUnique({ where: { id: reportId } });
      if (!original) throw new BusinessException(ErrorCode.NOT_FOUND, '报工记录不存在');
      if (original.reversedById) throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, '该报工已撤销');

      const op = await tx.workOrderOperation.findUniqueOrThrow({ where: { id: original.workOrderOperationId } });
      // 下道已开工 → 拒绝撤销（回退会破坏下道已消耗的数量）
      const nextOps = await tx.workOrderOperation.findMany({
        where: { workOrderId: op.workOrderId, seq: { gt: op.seq }, status: 'IN_PROGRESS' },
      });
      if (nextOps.length > 0) {
        throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, '下道工序已开工，不能撤销');
      }

      const reverse = await tx.workReport.create({
        data: {
          workOrderOperationId: op.id,
          workOrderId: op.workOrderId,
          employeeId: original.employeeId,
          teamId: original.teamId,
          shiftId: original.shiftId,
          goodQty: -original.goodQty,
          defectQty: -original.defectQty,
          workMinutes: -original.workMinutes,
          reportedAt: new Date(),
          idempotencyKey: `reverse-${original.idempotencyKey}-${Date.now()}`,
          reversedById: original.id,
          remark: reason,
          createdBy: operator,
        },
      });
      await tx.workReport.update({
        where: { id: original.id },
        data: { reversedById: reverse.id },
      });

      // 任务数量回退（原子减）
      await tx.workOrderOperation.update({
        where: { id: op.id },
        data: {
          completedQty: { decrement: original.goodQty },
          defectQty: { decrement: original.defectQty },
          version: { increment: 1 },
        },
      });

      // 状态回退：任务从 COMPLETED 回 IN_PROGRESS（数量不再补满）；下道 READY 回 PENDING
      await tx.workOrderOperation.updateMany({
        where: { id: op.id, status: 'COMPLETED' },
        data: { status: 'IN_PROGRESS', completedAt: null, version: { increment: 1 } },
      });
      const refreshed = await tx.workOrderOperation.findUniqueOrThrow({ where: { id: op.id } });
      if (refreshed.completedQty + refreshed.defectQty < refreshed.plannedQty) {
        await tx.workOrderOperation.updateMany({
          where: { workOrderId: op.workOrderId, seq: { gt: op.seq }, status: 'READY' },
          data: { status: 'PENDING' },
        });
        // 工单 completedQty 回退（若已回写）
        const last = await tx.workOrderOperation.findFirst({
          where: { workOrderId: op.workOrderId, status: { not: 'CANCELLED' } }, orderBy: { seq: 'desc' },
        });
        if (last && last.id === op.id) {
          await tx.workOrder.update({ where: { id: op.workOrderId }, data: { completedQty: refreshed.completedQty } });
        }
      }
      return reverse;
    }, TX_OPTIONS);
  }

  async listByWorkOrder(workOrderId: number) {
    const rows = await this.prisma.workReport.findMany({
      where: { workOrderId },
      orderBy: { id: 'desc' },
      include: {
        employee: { select: { code: true, name: true } },
        team: { select: { name: true } },
        shift: { select: { name: true } },
        operation: { select: { seq: true, operationName: true } },
      },
    });
    return rows.map((r) => this.withShift(r));
  }

  private withShift(report: { shiftId: number | null } & Record<string, unknown>) {
    return report;
  }

  /** 按 reportedAt 推算班次（事务内用 tx 查班次表，逻辑对齐第 23 节 getCurrentShift 的区间判断） */
  private async pickShift(tx: Tx, at: Date): Promise<{ id: number; name: string } | null> {
    // 工厂时区 Asia/Shanghai（+8 固定偏移，与 shift.service.factoryLocal 一致）
    const FACTORY_TZ_OFFSET_MIN = 480;
    const local = new Date(at.getTime() + FACTORY_TZ_OFFSET_MIN * 60_000);
    const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
    const shifts = await tx.shift.findMany();
    for (const s of shifts) {
      const [sh, sm] = s.startTime.split(':').map(Number);
      const [eh, em] = s.endTime.split(':').map(Number);
      const start = sh * 60 + sm;
      let end = eh * 60 + em;
      if (s.crossDay) end += 1440;
      const m = minutes < start ? minutes + 1440 : minutes;
      if (m >= start && m < end) return { id: s.id, name: s.name };
    }
    return null;
  }
}
