import { Injectable } from '@nestjs/common';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../prisma/prisma.service';

/** 追溯树节点 */
export interface TraceNode {
  lotNo: string;
  materialCode: string;
  materialName: string;
  qty: number;          // 该批次在链上的相关数量（正数）
  viaWorkOrder: string | null; // 关联工单编码
  children: TraceNode[];
}

/**
 * 批次追溯（第 43 节）：沿流水走，一次查出相关流水在内存建图（ADR-002 策略，不逐级查库）。
 * 反向：成品批次 → RECEIPT 流水 → 工单 → ISSUE 流水 → 原料批次（多级 BOM 递归）。
 * 正向：原料批次 → ISSUE 流水 → 工单 → RECEIPT 流水 → 成品批次。
 */
@Injectable()
export class TraceService {
  constructor(private prisma: PrismaService) {}

  async traceBack(lotNo: string): Promise<{ root: TraceNode }> {
    const lot = await this.prisma.lot.findUnique({ where: { lotNo }, include: { material: true } });
    if (!lot) throw new BusinessException(ErrorCode.NOT_FOUND, `批次 ${lotNo} 不存在`);

    // 一次查出与"该物料出现的所有工单"相关的流水（ISSUE + RECEIPT），内存建图
    const txs = await this.prisma.inventoryTransaction.findMany({
      where: { type: { in: ['ISSUE', 'RECEIPT'] } },
      include: {
        material: { select: { code: true, name: true } },
        lot: { select: { lotNo: true } },
      },
    });
    const woCodes = new Map<number, string>();
    const woIds = [...new Set(txs.filter((t) => t.workOrderId !== null).map((t) => t.workOrderId as number))];
    const woRows = await this.prisma.workOrder.findMany({ where: { id: { in: woIds } }, select: { id: true, code: true } });
    for (const w of woRows) woCodes.set(w.id, w.code);
    const byWorkOrder = new Map<number, typeof txs>();
    for (const t of txs) {
      if (t.workOrderId === null) continue;
      const list = byWorkOrder.get(t.workOrderId) ?? [];
      list.push(t);
      byWorkOrder.set(t.workOrderId, list);
    }
    // workOrderId → 产出的成品批次（RECEIPT 流水的 lot）
    const outputOfWo = new Map<number, { lotNo: string; materialCode: string; materialName: string; qty: number }>();
    for (const t of txs) {
      if (t.type === 'RECEIPT' && t.workOrderId !== null) {
        outputOfWo.set(t.workOrderId, {
          lotNo: t.lot.lotNo,
          materialCode: t.material.code,
          materialName: t.material.name,
          qty: t.qty,
        });
      }
    }

    const visited = new Set<string>();
    const build = (nodeLotNo: string, nodeMaterialId: number, qty: number, viaWo: string | null, depth: number): TraceNode => {
      const cycle = visited.has(nodeLotNo) && depth > 0;
      const material = lot.materialId === nodeMaterialId ? lot.material : null;
      void material;
      const node: TraceNode = {
        lotNo: nodeLotNo,
        materialCode: '',
        materialName: '',
        qty,
        viaWorkOrder: viaWo,
        children: [],
      };
      if (cycle || depth > 20) return node;
      visited.add(nodeLotNo);
      // 反向：该批次是哪个工单"产出入库"的（RECEIPT 匹配）→ 该工单"领料消耗"了哪些原料批次（ISSUE）→ 递归向上
      const producedBy = txs.filter((t) => t.type === 'RECEIPT' && t.lot.lotNo === nodeLotNo && t.workOrderId !== null);
      for (const receipt of producedBy) {
        const woId = receipt.workOrderId!;
        const issues = txs.filter((t) => t.type === 'ISSUE' && t.workOrderId === woId);
        for (const issue of issues) {
          node.children.push(build(issue.lot.lotNo, issue.materialId, Math.abs(issue.qty), woCodes.get(woId) ?? null, depth + 1));
        }
      }
      return node;
    };

    // 从成品批次向上：材料信息按 lotNo 查内存里的流水补充
    const materialOfLot = new Map<string, { code: string; name: string }>();
    for (const t of txs) {
      materialOfLot.set(t.lot.lotNo, { code: t.material.code, name: t.material.name });
    }
    materialOfLot.set(lot.lotNo, { code: lot.material.code, name: lot.material.name });
    const root = this.fillMaterial(build(lot.lotNo, lot.materialId, lot.qty, null, 0), materialOfLot);
    return { root };
  }

  async traceForward(lotNo: string): Promise<{ root: TraceNode }> {
    const lot = await this.prisma.lot.findUnique({ where: { lotNo }, include: { material: true } });
    if (!lot) throw new BusinessException(ErrorCode.NOT_FOUND, `批次 ${lotNo} 不存在`);

    const txs = await this.prisma.inventoryTransaction.findMany({
      where: { type: { in: ['ISSUE', 'RECEIPT'] } },
      include: {
        material: { select: { code: true, name: true } },
        lot: { select: { lotNo: true } },
      },
    });
    const materialOfLot = new Map<string, { code: string; name: string }>();
    for (const t of txs) materialOfLot.set(t.lot.lotNo, { code: t.material.code, name: t.material.name });
    materialOfLot.set(lot.lotNo, { code: lot.material.code, name: lot.material.name });

    const woIds2 = [...new Set(txs.filter((t) => t.workOrderId !== null).map((t) => t.workOrderId as number))];
    const woRows2 = await this.prisma.workOrder.findMany({ where: { id: { in: woIds2 } }, select: { id: true, code: true } });
    const woCodes = new Map<number, string>(woRows2.map((w) => [w.id, w.code]));
    // 正向：该批次被哪些工单领用（ISSUE）→ 工单产出的成品批次（RECEIPT）
    const build = (nodeLotNo: string, qty: number, viaWo: string | null, depth: number): TraceNode => {
      const node: TraceNode = {
        lotNo: nodeLotNo,
        materialCode: materialOfLot.get(nodeLotNo)?.code ?? '',
        materialName: materialOfLot.get(nodeLotNo)?.name ?? '',
        qty,
        viaWorkOrder: viaWo,
        children: [],
      };
      if (depth > 20) return node;
      const consumedBy = txs.filter((t) => t.type === 'ISSUE' && t.lot.lotNo === nodeLotNo && t.workOrderId !== null);
      for (const issue of consumedBy) {
        const woId = issue.workOrderId!;
        // 该工单的 RECEIPT 产出
        const receipts = txs.filter((t) => t.type === 'RECEIPT' && t.workOrderId === woId);
        for (const rec of receipts) {
          const child = build(rec.lot.lotNo, rec.qty, woCodes.get(issue.workOrderId ?? 0) ?? null, depth + 1);
          node.children.push(child);
        }
      }
      return node;
    };
    const root = build(lot.lotNo, lot.qty, null, 0);
    return { root };
  }

  private fillMaterial(node: TraceNode, materialOfLot: Map<string, { code: string; name: string }>): TraceNode {
    const info = materialOfLot.get(node.lotNo);
    node.materialCode = info?.code ?? node.materialCode;
    node.materialName = info?.name ?? node.materialName;
    for (const c of node.children) this.fillMaterial(c, materialOfLot);
    return node;
  }
}
