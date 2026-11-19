import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { BomExplodeService } from '../bom/bom-explode.service';

type Tx = import('@prisma/client').Prisma.TransactionClient;

/** SQLite 写串行 + 高并发排队（第 40 节约定） */
export const TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 } as const;

export interface IssueLine {
  materialId: number;
  lotId: number;
  qty: number;
}

/**
 * 库存（第 41 节）：铁律——余额是流水的结果，流水只增不改。
 * 所有余额变动发生在事务内：先动余额（原子），再写流水（append-only）。
 */
@Injectable()
export class InventoryService {
  constructor(
    private prisma: PrismaService,
    private explode: BomExplodeService,
  ) {}

  /** 仓库列表 */
  async listWarehouses() {
    return this.prisma.warehouse.findMany({ orderBy: { id: 'asc' } });
  }

  /** 余额列表（按仓库/物料筛选） */
  async listBalances(query: { warehouseId?: number; materialId?: number; page?: number; pageSize?: number }) {
    const page = Number(query.page) > 0 ? Number(query.page) : 1;
    const pageSize = Math.min(Number(query.pageSize) > 0 ? Number(query.pageSize) : 20, 200);
    const where = {
      ...(query.warehouseId ? { warehouseId: Number(query.warehouseId) } : {}),
      ...(query.materialId ? { materialId: Number(query.materialId) } : {}),
    };
    const [list, total] = await this.prisma.$transaction([
      this.prisma.inventoryBalance.findMany({
        where,
        include: {
          warehouse: { select: { code: true, name: true } },
          material: { select: { code: true, name: true } },
          lot: { select: { lotNo: true, producedAt: true } },
        },
        orderBy: [{ warehouseId: 'asc' }, { materialId: 'asc' }, { lotId: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.inventoryBalance.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  /** 流水列表（只读） */
  async listTransactions(query: { warehouseId?: number; materialId?: number; workOrderId?: number; type?: string; page?: number; pageSize?: number }) {
    const page = Number(query.page) > 0 ? Number(query.page) : 1;
    const pageSize = Math.min(Number(query.pageSize) > 0 ? Number(query.pageSize) : 20, 200);
    const where = {
      ...(query.warehouseId ? { warehouseId: Number(query.warehouseId) } : {}),
      ...(query.materialId ? { materialId: Number(query.materialId) } : {}),
      ...(query.workOrderId ? { workOrderId: Number(query.workOrderId) } : {}),
      ...(query.type ? { type: query.type } : {}),
    };
    const [list, total] = await this.prisma.$transaction([
      this.prisma.inventoryTransaction.findMany({
        where,
        include: {
          warehouse: { select: { code: true, name: true } },
          material: { select: { code: true, name: true } },
          lot: { select: { lotNo: true } },
        },
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.inventoryTransaction.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  /** 批次列表 */
  async listLots(query: { materialId?: number; page?: number; pageSize?: number }) {
    const page = Number(query.page) > 0 ? Number(query.page) : 1;
    const pageSize = Math.min(Number(query.pageSize) > 0 ? Number(query.pageSize) : 20, 200);
    const where = { ...(query.materialId ? { materialId: Number(query.materialId) } : {}) };
    const [list, total] = await this.prisma.$transaction([
      this.prisma.lot.findMany({
        where,
        include: { material: { select: { code: true, name: true } } },
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.lot.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  /** 守恒审计（第 42 节）：每个（仓, 料, 批）余额 = 流水和；返回不平清单 */
  async audit() {
    const balances = await this.prisma.inventoryBalance.findMany();
    const sums = await this.prisma.inventoryTransaction.groupBy({
      by: ['warehouseId', 'materialId', 'lotId'],
      _sum: { qty: true },
    });
    const sumMap = new Map(sums.map((r) => [`${r.warehouseId}:${r.materialId}:${r.lotId}`, r._sum.qty ?? 0]));
    const mismatches: { warehouseId: number; materialId: number; lotId: number; balance: number; txSum: number }[] = [];
    for (const b of balances) {
      const key = `${b.warehouseId}:${b.materialId}:${b.lotId}`;
      const sum = sumMap.get(key);
      if (sum === undefined || sum !== b.qty) {
        mismatches.push({ warehouseId: b.warehouseId, materialId: b.materialId, lotId: b.lotId, balance: b.qty, txSum: sum ?? 0 });
      }
      sumMap.delete(key);
    }
    // 有流水但无余额行的组合（余额行被非法删除的迹象）
    for (const [key, sum] of sumMap) {
      const [warehouseId, materialId, lotId] = key.split(':').map(Number);
      mismatches.push({ warehouseId, materialId, lotId, balance: 0, txSum: sum });
    }
    return { balanced: mismatches.length === 0, checked: balances.length, mismatches };
  }

  /** 生成领料单：按 BOM 展开需求（复用第 17 节 explode），数量 × 工单 qty */
  async generateIssue(workOrderId: number, operator: string) {
    const wo = await this.prisma.workOrder.findUnique({ where: { id: workOrderId } });
    if (!wo) throw new BusinessException(ErrorCode.NOT_FOUND, '工单不存在');
    if (!wo.routingId) throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, '工单未下达（无路线），先 release');
    const existing = await this.prisma.materialIssue.findFirst({ where: { workOrderId, status: 'DRAFT' } });
    if (existing) return this.getIssue(existing.id); // 已有 DRAFT 直接复用

    const bom = await this.prisma.bom.findFirst({ where: { materialId: wo.materialId, status: 'ACTIVE' }, include: { items: true } });
    if (!bom) throw new BusinessException(ErrorCode.NOT_FOUND, '成品没有 ACTIVE 的 BOM，无法展开需求');

    const graph = await this.explode.loadGraph();
    const materials = await this.prisma.material.findMany({ select: { id: true, code: true, name: true, type: true } });
    const matMap = new Map(materials.map((m) => [m.id, m]));
    const result = this.explode.explodeFromBom(
      graph,
      { id: bom.id, materialId: bom.materialId, items: bom.items.map((it) => ({ childMaterialId: it.childMaterialId, qty: it.qty, scrapRate: it.scrapRate })) },
      matMap,
      wo.qty,
    );

    const count = await this.prisma.materialIssue.count();
    const code = `MI-${String(count + 1).padStart(5, '0')}`;
    return this.prisma.materialIssue.create({
      data: {
        code,
        workOrderId,
        createdBy: operator,
        items: {
          create: result.summary.map((s) => ({
            materialId: s.materialId,
            requiredQty: s.qty,
          })),
        },
      },
      // 与 getIssue 返回同形：明细带 material，前端生成领料单后能直接展示物料名
      include: { items: { include: { material: { select: { code: true, name: true } } } } },
    });
  }

  /** 领料执行：事务内逐行扣余额（FIFO 批次）+ 写流水；任一行不足整单回滚 */
  async issue(issueId: number, operator: string) {
    return this.prisma.$transaction(async (tx) => {
      const issue = await tx.materialIssue.findUnique({ where: { id: issueId }, include: { items: { include: { material: true } } } });
      if (!issue) throw new BusinessException(ErrorCode.NOT_FOUND, '领料单不存在');
      if (issue.status === 'ISSUED') throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, '领料单已执行');
      const workOrder = await tx.workOrder.findUniqueOrThrow({ where: { id: issue.workOrderId } });
      if (!['RELEASED', 'IN_PROGRESS'].includes(workOrder.status)) {
        throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, `工单状态为 ${workOrder.status}，不能领料`);
      }

      for (const item of issue.items) {
        const need = item.requiredQty - item.issuedQty;
        if (need <= 0) continue;
        await this.deductFifo(tx, issue.workOrderId, item.materialId, need, issue.id, operator, item);
        await tx.materialIssueItem.update({ where: { id: item.id }, data: { issuedQty: item.requiredQty } });
      }
      await tx.materialIssue.update({ where: { id: issueId }, data: { status: 'ISSUED' } });
      return this.getIssueTx(tx, issueId);
    }, TX_OPTIONS);
  }

  /** FIFO 扣减：按批次 producedAt 升序扣，直到扣满；任何一行不足抛 2001 整单回滚 */
  private async deductFifo(tx: Tx, workOrderId: number, materialId: number, qty: number, issueId: number, operator: string, item?: { id: number; requiredQty: number; issuedQty: number }) {
    void item;
    const balances = await tx.inventoryBalance.findMany({
      where: { materialId, qty: { gt: 0 } },
      include: { lot: { select: { producedAt: true } } },
      orderBy: { lotId: 'asc' },
    });
    // FIFO：按 producedAt 排序
    balances.sort((a, b) => a.lot.producedAt.getTime() - b.lot.producedAt.getTime());
    let remaining = qty;
    for (const b of balances) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, b.qty);
      const updated = await tx.inventoryBalance.updateMany({
        where: { id: b.id, version: b.version, qty: b.qty },
        data: { qty: b.qty - take, version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new BusinessException(ErrorCode.CONCURRENT_CONFLICT, '库存已被其他操作修改，请重试');
      }
      await tx.inventoryTransaction.create({
        data: {
          type: 'ISSUE', warehouseId: b.warehouseId, materialId, lotId: b.lotId,
          qty: -take, refType: 'MATERIAL_ISSUE', refId: issueId, workOrderId, operatorName: operator,
        },
      });
      remaining -= take;
    }
    if (remaining > 0) {
      throw new BusinessException(ErrorCode.STOCK_SHORT, `物料 ${materialId} 库存不足，缺 ${remaining}`);
    }
  }

  /** 完工入库：生成成品批次（lotNo 规则）+ 余额 + RECEIPT 流水 */
  async receipt(workOrderId: number, dto: { qty: number; warehouseId: number }, operator: string) {
    return this.prisma.$transaction(async (tx) => {
      const wo = await tx.workOrder.findUniqueOrThrow({ where: { id: workOrderId } });
      if (!['IN_PROGRESS', 'COMPLETED'].includes(wo.status)) {
        throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, `工单状态为 ${wo.status}，不能入库`);
      }
      // 质检联动（第 45 节用例 3）：成品物料要求 FQC 时，必须有 PASS/CONCESSION 的 FQC
      // （校验顺序：状态 → FQC → 数量，FQC 是入库资格问题，优先于数量问题）
      const material = await tx.material.findUniqueOrThrow({ where: { id: wo.materialId } });
      if (material.requireFqc) {
        // 按工单关联：FQC refType=WORK_ORDER refId=workOrderId
        const fqc = await tx.inspection.findFirst({
          where: { type: 'FQC', refType: 'WORK_ORDER', refId: workOrderId, result: { in: ['PASS', 'CONCESSION'] } },
        });
        if (!fqc) {
          throw new BusinessException(ErrorCode.OP_NOT_READY, '该物料要求成品检验（FQC），且尚无合格/让步接收的 FQC 结论，不能入库');
        }
      }

      const already = await tx.inventoryTransaction.aggregate({
        where: { workOrderId, type: 'RECEIPT' },
        _sum: { qty: true },
      });
      const received = already._sum.qty ?? 0;
      if (dto.qty > wo.completedQty - received) {
        throw new BusinessException(ErrorCode.QTY_EXCEEDED, `可入库数量 ${Math.max(0, wo.completedQty - received)}（完工 ${wo.completedQty} − 已入库 ${received}）`);
      }
      const wh = await tx.warehouse.findUnique({ where: { id: dto.warehouseId } });
      if (!wh) throw new BusinessException(ErrorCode.NOT_FOUND, '仓库不存在');

      // 批次号：<物料编码>-<yyyyMMdd>-<序号>；同日序号自增（并发布 由事务串行 + 重查保证）
      const lot = await this.createProductionLot(tx, wo.materialId, wo.id, dto.qty, operator);

      await tx.inventoryBalance.upsert({
        where: { warehouseId_materialId_lotId: { warehouseId: dto.warehouseId, materialId: wo.materialId, lotId: lot.id } },
        create: { warehouseId: dto.warehouseId, materialId: wo.materialId, lotId: lot.id, qty: dto.qty },
        update: { qty: { increment: dto.qty } },
      });
      await tx.inventoryTransaction.create({
        data: {
          type: 'RECEIPT', warehouseId: dto.warehouseId, materialId: wo.materialId, lotId: lot.id,
          qty: dto.qty, refType: 'RECEIPT', refId: lot.id, workOrderId, operatorName: operator,
        },
      });
      return lot;
    }, TX_OPTIONS);
  }

  /** 生成生产批次：lotNo = <物料编码>-<yyyyMMdd>-<当日序号>，事务内重查保证并发不重 */
  private async createProductionLot(tx: Tx, materialId: number, workOrderId: number, qty: number, operator: string) {
    void operator; // Lot 无审计字段（批次事实不可变），操作人记录在 RECEIPT 流水里
    const material = await tx.material.findUniqueOrThrow({ where: { id: materialId } });
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    // 同日同物料已有多少个生产批次 → 序号续
    const todayStart = new Date(`${today.toISOString().slice(0, 10)}T00:00:00.000Z`);
    const existing = await tx.lot.count({
      where: { materialId, sourceType: 'PRODUCTION', producedAt: { gte: todayStart } },
    });
    let seq = existing + 1;
    // 重查循环：并发下 lotNo 冲突则序号 +1 重试
    for (let attempt = 0; attempt < 10; attempt++) {
      const lotNo = `${material.code}-${dateStr}-${String(seq).padStart(3, '0')}`;
      const dup = await tx.lot.findUnique({ where: { lotNo } });
      if (dup) { seq += 1; continue; }
      return tx.lot.create({
        data: { lotNo, materialId, qty, sourceType: 'PRODUCTION', sourceWorkOrderId: workOrderId },
      });
    }
    throw new BusinessException(ErrorCode.CONFLICT, '批次号生成失败（并发冲突）');
  }

  /** 退料（第 42 节用例 6）：RETURN 流水，余额回增，领料单明细 issuedQty 减少 */
  async returnMaterial(dto: { issueItemId: number; lotId: number; qty: number; warehouseId: number }, operator: string) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.materialIssueItem.findUniqueOrThrow({ where: { id: dto.issueItemId }, include: { issue: true } });
      if (item.issue.status !== 'ISSUED') throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, '领料单未执行，无需退料');
      if (dto.qty <= 0 || dto.qty > item.issuedQty) {
        throw new BusinessException(ErrorCode.VALIDATION, `退料量必须在 1 ~ ${item.issuedQty} 之间`);
      }
      await tx.inventoryBalance.upsert({
        where: { warehouseId_materialId_lotId: { warehouseId: dto.warehouseId, materialId: item.materialId, lotId: dto.lotId } },
        create: { warehouseId: dto.warehouseId, materialId: item.materialId, lotId: dto.lotId, qty: dto.qty },
        update: { qty: { increment: dto.qty } },
      });
      await tx.inventoryTransaction.create({
        data: {
          type: 'RETURN', warehouseId: dto.warehouseId, materialId: item.materialId, lotId: dto.lotId,
          qty: dto.qty, refType: 'MATERIAL_ISSUE', refId: item.issueId, workOrderId: item.issue.workOrderId,
          operatorName: operator, remark: '退料',
        },
      });
      await tx.materialIssueItem.update({ where: { id: item.id }, data: { issuedQty: { decrement: dto.qty } } });
      return { ok: true };
    }, TX_OPTIONS);
  }

  /** 库存调整（第 42 节用例 8）：直接改余额的接口不存在；调整走 ADJUST 流水 + reason + 权限 */
  async adjust(dto: { warehouseId: number; materialId: number; lotId: number; qty: number; reason: string }, operator: string) {
    return this.prisma.$transaction(async (tx) => {
      const balance = await tx.inventoryBalance.findUnique({
        where: { warehouseId_materialId_lotId: { warehouseId: dto.warehouseId, materialId: dto.materialId, lotId: dto.lotId } },
      });
      const current = balance?.qty ?? 0;
      if (current + dto.qty < 0) throw new BusinessException(ErrorCode.STOCK_SHORT, '调整后余额不能为负');
      if (balance) {
        await tx.inventoryBalance.update({ where: { id: balance.id }, data: { qty: current + dto.qty, version: { increment: 1 } } });
      } else {
        if (dto.qty <= 0) throw new BusinessException(ErrorCode.VALIDATION, '无余额行时只能做正调整');
        await tx.inventoryBalance.create({ data: { warehouseId: dto.warehouseId, materialId: dto.materialId, lotId: dto.lotId, qty: dto.qty } });
      }
      await tx.inventoryTransaction.create({
        data: {
          type: 'ADJUST', warehouseId: dto.warehouseId, materialId: dto.materialId, lotId: dto.lotId,
          qty: dto.qty, refType: 'ADJUST', operatorName: operator, remark: dto.reason,
        },
      });
      return { ok: true };
    }, TX_OPTIONS);
  }

  private async getIssueTx(tx: Tx, id: number) {
    const issue = await tx.materialIssue.findUniqueOrThrow({
      where: { id },
      include: { items: { include: { material: { select: { code: true, name: true } } } } },
    });
    return issue;
  }

  async getIssue(id: number) {
    const issue = await this.prisma.materialIssue.findUnique({
      where: { id },
      include: { items: { include: { material: { select: { code: true, name: true } } } } },
    });
    if (!issue) throw new BusinessException(ErrorCode.NOT_FOUND, '领料单不存在');
    return issue;
  }

  async listIssues(query: { workOrderId?: number; page?: number; pageSize?: number }) {
    const page = Number(query.page) > 0 ? Number(query.page) : 1;
    const pageSize = Math.min(Number(query.pageSize) > 0 ? Number(query.pageSize) : 20, 200);
    const where = { ...(query.workOrderId ? { workOrderId: Number(query.workOrderId) } : {}) };
    const [list, total] = await this.prisma.$transaction([
      this.prisma.materialIssue.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.materialIssue.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }
}
