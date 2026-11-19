import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { CreateInspectionDto, SubmitInspectionDto } from './dto/inspection.dto';

type Tx = import('@prisma/client').Prisma.TransactionClient;

/** SQLite 写串行 + 高并发排队（第 40 节约定） */
const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

/** 结果校验纯函数（第 45 节单测对象）：校验数量关系与缺陷明细一致性 */
export function validateSubmission(
  sampleQty: number,
  passQty: number,
  failQty: number,
  defects: { defectCodeId: number; qty: number }[],
): void {
  if (passQty + failQty !== sampleQty) {
    throw new BusinessException(ErrorCode.VALIDATION, `合格 ${passQty} + 不良 ${failQty} ≠ 抽样 ${sampleQty}`);
  }
  if (failQty > 0 && defects.length === 0) {
    throw new BusinessException(ErrorCode.VALIDATION, '有不合格品时必须填写缺陷明细');
  }
  if (failQty === 0 && defects.length > 0) {
    throw new BusinessException(ErrorCode.VALIDATION, '无不合格品时不能填写缺陷明细');
  }
  const defectSum = defects.reduce((s, d) => s + d.qty, 0);
  if (defectSum !== failQty) {
    throw new BusinessException(ErrorCode.VALIDATION, `缺陷数量合计 ${defectSum} ≠ 不合格数量 ${failQty}`);
  }
  for (const d of defects) {
    if (d.qty <= 0) throw new BusinessException(ErrorCode.VALIDATION, '缺陷数量必须大于 0');
  }
}

@Injectable()
export class InspectionService {
  constructor(private prisma: PrismaService) {}

  /** 检验单编码：SPC/IQC/IPQC/FQC 前缀 + 自增 */
  private async nextCode(tx: Tx, type: string): Promise<string> {
    const count = await tx.inspection.count();
    return `${type}-${String(count + 1).padStart(5, '0')}`;
  }

  async create(dto: CreateInspectionDto, operator: string) {
    return this.prisma.$transaction(async (tx) => {
      const code = await this.nextCode(tx, dto.type);
      return tx.inspection.create({
        data: {
          code,
          type: dto.type,
          refType: dto.refType,
          refId: dto.refId,
          sampleQty: dto.sampleQty,
          remark: dto.remark,
          createdBy: operator,
        },
      });
    });
  }

  async findOne(id: number) {
    const insp = await this.prisma.inspection.findUnique({
      where: { id },
      include: { defects: { include: { defectCode: true } } },
    });
    if (!insp) throw new BusinessException(ErrorCode.NOT_FOUND, '检验单不存在');
    return insp;
  }

  async list(query: { type?: string; result?: string; page?: number; pageSize?: number }) {
    const page = Number(query.page) > 0 ? Number(query.page) : 1;
    const pageSize = Math.min(Number(query.pageSize) > 0 ? Number(query.pageSize) : 20, 200);
    const where = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.result ? { result: query.result } : {}),
    };
    const [list, total] = await this.prisma.$transaction([
      this.prisma.inspection.findMany({
        where,
        include: { defects: { include: { defectCode: { select: { code: true, name: true } } } } },
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.inspection.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  /** 提交检验结果（第 44 节）：数量校验 + 缺陷明细 + 结论；重复提交 409 */
  async submit(id: number, dto: SubmitInspectionDto, inspectorId: number) {
    return this.prisma.$transaction(async (tx) => {
      const insp = await tx.inspection.findUniqueOrThrow({ where: { id } });
      if (insp.result !== 'PENDING') {
        throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, `检验单已提交（结论 ${insp.result}）`);
      }
      validateSubmission(insp.sampleQty, dto.passQty, dto.failQty, dto.defects);

      // 缺陷代码有效性：存在且启用（停用代码不接受新录入）
      for (const d of dto.defects) {
        const dc = await tx.defectCode.findUnique({ where: { id: d.defectCodeId } });
        if (!dc) throw new BusinessException(ErrorCode.NOT_FOUND, `缺陷代码 ${d.defectCodeId} 不存在`);
        if (dc.status !== 1) throw new BusinessException(ErrorCode.VALIDATION, `缺陷代码 ${dc.name} 已停用`);
      }

      const result = dto.failQty > 0 ? 'FAIL' : 'PASS';
      const updated = await tx.inspection.updateMany({
        where: { id, version: insp.version, result: 'PENDING' },
        data: {
          passQty: dto.passQty,
          failQty: dto.failQty,
          result,
          inspectorId,
          inspectedAt: new Date(),
          remark: dto.remark ?? insp.remark,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) throw new BusinessException(ErrorCode.CONCURRENT_CONFLICT, '检验单已被他人处理');

      if (dto.defects.length > 0) {
        await tx.inspectionDefect.createMany({
          data: dto.defects.map((d) => ({ inspectionId: id, defectCodeId: d.defectCodeId, qty: d.qty, remark: d.remark })),
        });
      }

      // 质检点联动放行（第 45 节用例 1）：IPQC 针对质检点工序且结论 PASS/CONCESSION →
      // 补做被 qcHold 拦下的流转：本道保持 COMPLETED（已是），下道 PENDING → READY
      if (insp.refType === 'OPERATION' && result !== 'FAIL') {
        const qcOp = await tx.workOrderOperation.findUnique({ where: { id: insp.refId } });
        if (qcOp && qcOp.status === 'COMPLETED') {
          const siblings = await tx.workOrderOperation.findMany({
            where: { workOrderId: qcOp.workOrderId, status: { not: 'CANCELLED' } },
            orderBy: { seq: 'asc' },
          });
          const idx = siblings.findIndex((o) => o.id === qcOp.id);
          const next = siblings[idx + 1];
          if (next && next.status === 'PENDING') {
            await tx.workOrderOperation.update({
              where: { id: next.id },
              data: { status: 'READY', plannedQty: qcOp.completedQty, version: { increment: 1 } },
            });
          }
        }
      }
      return tx.inspection.findUniqueOrThrow({ where: { id }, include: { defects: { include: { defectCode: true } } } });
    }, TX_OPTIONS);
  }

  /** 不合格处理（第 44 节）：FAIL 后才能处理；CONCESSION 记录 reason 并改结论为让步接收 */
  async disposition(
    id: number,
    dto: { disposition: 'REWORK' | 'SCRAP' | 'CONCESSION'; reason: string },
    operator: string,
    operatorUserId?: number,
  ) {
    // 让步接收需要专用权限 inspection:concession（第 45 节用例 7）：实时查库
    if (dto.disposition === 'CONCESSION' && operatorUserId) {
      const owned = await this.prisma.$queryRaw<{ code: string }[]>`
        SELECT p.code FROM "Permission" p
        JOIN "RolePermission" rp ON rp."permissionId" = p.id
        JOIN "UserRole" ur ON ur."roleId" = rp."roleId"
        WHERE ur."userId" = ${operatorUserId} AND p.code = 'inspection:concession'`;
      if (owned.length === 0) {
        throw new BusinessException(ErrorCode.FORBIDDEN, '无权限，缺少：inspection:concession');
      }
    }
    return this.prisma.$transaction(async (tx) => {
      const insp = await tx.inspection.findUniqueOrThrow({ where: { id } });
      if (insp.result !== 'FAIL') {
        throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, `只有 FAIL 结论的检验单需要处理（当前 ${insp.result}）`);
      }
      const updated = await tx.inspection.updateMany({
        where: { id, version: insp.version },
        data: {
          disposition: dto.disposition,
          dispositionReason: dto.reason,
          // 让步接收 → 结论转 CONCESSION（放行），REWORK/SCRAP 保持 FAIL
          ...(dto.disposition === 'CONCESSION' ? { result: 'CONCESSION' } : {}),
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) throw new BusinessException(ErrorCode.CONCURRENT_CONFLICT, '检验单已被他人处理');
      void operator;
      return tx.inspection.findUniqueOrThrow({ where: { id }, include: { defects: { include: { defectCode: true } } } });
    }, TX_OPTIONS);
  }

  /** 缺陷代码 CRUD */
  async listDefectCodes(query: { category?: string; status?: number; page?: number; pageSize?: number }) {
    const page = Number(query.page) > 0 ? Number(query.page) : 1;
    const pageSize = Math.min(Number(query.pageSize) > 0 ? Number(query.pageSize) : 20, 200);
    const where = {
      ...(query.category ? { category: query.category } : {}),
      ...(query.status !== undefined && query.status !== null ? { status: Number(query.status) } : {}),
    };
    const [list, total] = await this.prisma.$transaction([
      this.prisma.defectCode.findMany({ where, orderBy: { id: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.defectCode.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  async createDefectCode(dto: { code: string; name: string; category: string; severity: string }, operator: string) {
    void operator;
    try {
      return await this.prisma.defectCode.create({ data: dto });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new BusinessException(ErrorCode.CONFLICT, `缺陷代码 ${dto.code} 已存在`);
      throw e;
    }
  }

  async updateDefectCode(id: number, dto: { name?: string; category?: string; severity?: string; status?: number }) {
    const dc = await this.prisma.defectCode.findUnique({ where: { id } });
    if (!dc) throw new BusinessException(ErrorCode.NOT_FOUND, '缺陷代码不存在');
    return this.prisma.defectCode.update({ where: { id }, data: dto });
  }

  /** 删除缺陷代码：被检验单引用 → 409（第 45 节用例 10） */
  async deleteDefectCode(id: number) {
    const dc = await this.prisma.defectCode.findUnique({
      where: { id },
      include: { _count: { select: { defects: true } } },
    });
    if (!dc) throw new BusinessException(ErrorCode.NOT_FOUND, '缺陷代码不存在');
    if (dc._count.defects > 0) {
      throw new BusinessException(ErrorCode.CONFLICT, `该缺陷代码被 ${dc._count.defects} 条检验记录引用，不能删除（可停用）`);
    }
    await this.prisma.defectCode.delete({ where: { id } });
  }
}
