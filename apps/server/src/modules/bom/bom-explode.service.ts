import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../prisma/prisma.service';

/** 展开深度上限：防御漏检的循环引用（正常 BOM 不会超过 20 级） */
const MAX_DEPTH = 20;

/** 损耗率口径：实际需求 = 用量 × (1 + 损耗率bp / 10000)。选乘法口径：损耗是"额外多备"的部分 */
export function applyScrap(qty: number, scrapRate: number): number {
  return Math.round(qty * (1 + scrapRate / 10_000));
}

export interface BomTreeNode {
  materialId: number;
  code: string;
  name: string;
  type: string;
  qty: number; // 本层需求量（已含本层损耗、已乘父数量）
  scrapRate: number;
  unitQty: number; // 单位用量（BomItem.qty 原值）
  children: BomTreeNode[];
}

export interface ExplodeResult {
  tree: BomTreeNode;
  /** 叶子物料汇总需求：materialId → { code, name, qty }（多路径累加，数量已含各级损耗） */
  summary: { materialId: number; code: string; name: string; qty: number }[];
  depth: number;
}

/** 内存 BOM 图（第 19 节消除 N+1 的核心）：一次性从库里装下全部 ACTIVE BOM 与明细 */
interface GraphNode {
  materialId: number;
  bomId: number;
  items: { childMaterialId: number; qty: number; scrapRate: number }[];
}

export interface BomGraph {
  /** materialId → 该物料当前生效的 ACTIVE BOM 图节点（无 BOM = 采购叶子） */
  byMaterial: Map<number, GraphNode>;
}

@Injectable()
export class BomExplodeService {
  constructor(private prisma: PrismaService) {}

  /**
   * 一次查 BOM + 明细，在内存建图（查询次数固定 1，见 ADR-002）。
   * scope=active（默认，展开用）：只装 ACTIVE——展开语义是"当前生效"；
   * scope=all-live（保存明细的环检测用）：装 DRAFT + ACTIVE——跨 DRAFT BOM 的环也要拦。
   */
  async loadGraph(tx?: Prisma.TransactionClient, scope: 'active' | 'all-live' = 'active'): Promise<BomGraph> {
    const db = tx ?? this.prisma;
    const boms = await db.bom.findMany({
      where: scope === 'active' ? { status: 'ACTIVE' } : { status: { in: ['DRAFT', 'ACTIVE'] } },
      include: { items: { select: { childMaterialId: true, qty: true, scrapRate: true } } },
    });
    const byMaterial = new Map<number, GraphNode>();
    for (const bom of boms) {
      byMaterial.set(bom.materialId, {
        materialId: bom.materialId,
        bomId: bom.id,
        items: bom.items.map((it) => ({ childMaterialId: it.childMaterialId, qty: it.qty, scrapRate: it.scrapRate })),
      });
    }
    return { byMaterial };
  }

  /**
   * 展开：从 rootBomId 的 BOM 出发（树接口用），qty 为父数量。
   * 图内环在 loadGraph 后的图上是可达环——用"当前路径"检测（A→B→A），并做深度防御。
   */
  explodeFromBom(
    graph: BomGraph,
    rootBom: { id: number; materialId: number; items: { childMaterialId: number; qty: number; scrapRate: number }[] },
    materials: Map<number, { code: string; name: string; type: string }>,
    parentQty: number,
  ): ExplodeResult {
    const summary = new Map<number, { code: string; name: string; qty: number }>();
    let maxDepth = 0;
    const path = new Set<number>();

    const build = (node: GraphNode, qty: number, depth: number): BomTreeNode => {
      if (depth > MAX_DEPTH) throw new BusinessException(ErrorCode.BOM_CYCLE, `BOM 展开深度超过 ${MAX_DEPTH} 层，疑似循环引用`);
      maxDepth = Math.max(maxDepth, depth);
      const mat = materials.get(node.materialId)!;
      if (path.has(node.materialId)) {
        throw new BusinessException(ErrorCode.BOM_CYCLE, `BOM 存在循环引用：物料 ${mat.code} 在展开路径上重复出现`);
      }
      path.add(node.materialId);
      const children: BomTreeNode[] = [];
      for (const item of node.items) {
        if (item.childMaterialId === node.materialId) {
          throw new BusinessException(ErrorCode.BOM_CYCLE, `BOM 明细不能包含父物料自身（物料 ${mat.code}）`);
        }
        // 需求量 = 父数量 × 单位用量 × (1 + 损耗)
        const need = applyScrap(Math.round(qty * item.qty), item.scrapRate);
        const childGraph = graph.byMaterial.get(item.childMaterialId);
        const childMat = materials.get(item.childMaterialId);
        const childNode: BomTreeNode = {
          materialId: item.childMaterialId,
          code: childMat?.code ?? `#${item.childMaterialId}`,
          name: childMat?.name ?? '',
          type: childMat?.type ?? '',
          qty: need,
          scrapRate: item.scrapRate,
          unitQty: item.qty,
          children: [],
        };
        if (childGraph) {
          // 子件有生效 BOM：递归展开
          const sub = build(childGraph, need, depth + 1);
          childNode.children = sub.children;
        }
        // 无生效 BOM = 采购叶子：进汇总
        const acc = summary.get(item.childMaterialId);
        if (acc) acc.qty += need;
        else summary.set(item.childMaterialId, { code: childNode.code, name: childNode.name, qty: need });
        children.push(childNode);
      }
      path.delete(node.materialId);
      return { materialId: node.materialId, code: mat.code, name: mat.name, type: mat.type, qty, scrapRate: 0, unitQty: 0, children };
    };

    const tree = build({ materialId: rootBom.materialId, bomId: rootBom.id, items: rootBom.items }, parentQty, 1);
    return {
      tree,
      summary: [...summary.entries()].map(([materialId, v]) => ({ materialId, ...v })).sort((a, b) => a.code.localeCompare(b.code)),
      depth: maxDepth,
    };
  }

  /** 给定父物料 + 日期：取该日生效的 ACTIVE 版本（effectiveFrom ≤ date ≤ effectiveTo ?? ∞） */
  async findActiveBomByDate(materialId: number, date: Date, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const boms = await db.bom.findMany({
      where: { materialId, status: 'ACTIVE', effectiveFrom: { lte: date }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] },
      orderBy: { effectiveFrom: 'desc' },
      take: 1,
    });
    return boms[0] ?? null;
  }
}
