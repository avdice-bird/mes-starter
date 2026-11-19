import { BomExplodeService, applyScrap } from './bom-explode.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/exceptions/business.exception';

/**
 * 第 18 节【测】展开算法单测：纯内存图，不碰数据库，期望值全部手算。
 *
 * 测试图（codes 用 M{n}）：
 *   FINISHED(1000) ──2× SEMI_A ──3× SCREW(损耗3%)
 *        └──────4× SCREW（直用）
 *   菱形：SEMI_A 与 SEMI_B 都用 SCREW
 *   环：CY_A ──1× CY_B ──1× CY_A
 *
 * 手算：FINISHED×1 → SEMI_A 需 2（无损耗）→ SCREW 需 2×3×1.03 = 6.18 → 取整 6；
 *       直用 SCREW 4×1.00 = 4；汇总 SCREW = 6 + 4 = 10。
 */

/** 手搭内存图的工具：materialId → items */
function makeGraph(edges: Record<number, { childMaterialId: number; qty: number; scrapRate: number }[]>) {
  const byMaterial = new Map(
    Object.entries(edges).map(([mid, items]) => [
      Number(mid),
      { materialId: Number(mid), bomId: Number(mid) * 10, items },
    ]),
  );
  return { byMaterial };
}

/** 测试物料表 */

function materialsOf(...defs: { id: number; code: string; type?: string }[]) {
  return new Map(defs.map((m) => [m.id, { code: m.code, name: `物料${m.code}`, type: m.type ?? 'RAW' }]));
}

const svc = new BomExplodeService({} as PrismaService);

describe('BomExplodeService 展开算法（内存图，期望值手算）', () => {
  it('三级链式 + 多路径累加：SCREW 汇总 = 2×3×1.03 取整 6 + 4 = 10', () => {
    // FINISHED: 2×SEMI_A(0损耗), 4×SCREW(0)；SEMI_A: 3×SCREW(300bp=3%)
    const graph = makeGraph({
      1000: [
        { childMaterialId: 2000, qty: 2, scrapRate: 0 },
        { childMaterialId: 3000, qty: 4, scrapRate: 0 },
      ],
      2000: [{ childMaterialId: 3000, qty: 3, scrapRate: 300 }],
    });
    const materials = materialsOf(
      { id: 1000, code: 'FINISHED', type: 'FINISHED' },
      { id: 2000, code: 'SEMI_A', type: 'SEMI' },
      { id: 3000, code: 'SCREW' },
    );
    const root = { id: 10000, materialId: 1000, items: graph.byMaterial.get(1000)!.items };
    const r = svc.explodeFromBom(graph, root, materials, 1);

    const screw = r.summary.find((s) => s.code === 'SCREW')!;
    expect(screw.qty).toBe(10); // 2×3×1.03=6.18→6，+4 = 10
    expect(r.summary.find((s) => s.code === 'SEMI_A')!.qty).toBe(2);
    expect(r.tree.children).toHaveLength(2);
    expect(r.tree.children[0].children).toHaveLength(1); // SEMI_A 下有 SCREW
    expect(r.depth).toBe(2);
  });

  it('数量放大：父数量 5 时叶子按比例放大（手算 50）', () => {
    const graph = makeGraph({
      1000: [
        { childMaterialId: 2000, qty: 2, scrapRate: 0 },
        { childMaterialId: 3000, qty: 4, scrapRate: 0 },
      ],
      2000: [{ childMaterialId: 3000, qty: 3, scrapRate: 300 }],
    });
    const materials = materialsOf({ id: 1000, code: 'F', type: 'FINISHED' }, { id: 2000, code: 'SA', type: 'SEMI' }, { id: 3000, code: 'SC' });
    const root = { id: 10000, materialId: 1000, items: graph.byMaterial.get(1000)!.items };
    const r = svc.explodeFromBom(graph, root, materials, 5);
    // 手算：SEMI_A = 5×2 = 10（无损耗）；SCREW = round(10×3) = 30 → 含损耗 round(30×1.03) = 31；直用 5×4 = 20 → 51
    // 注意损耗是"每层应用后立即四舍五入"（与逐层 MRP 口径一致），不是最后统一取整
    expect(r.summary.find((s) => s.code === 'SC')!.qty).toBe(51);
  });

  it('损耗率口径：applyScrap(100, 500) = 105（乘法口径 1+5%）', () => {
    expect(applyScrap(100, 0)).toBe(100);
    expect(applyScrap(100, 500)).toBe(105); // 5% 损耗
    expect(applyScrap(3, 300)).toBe(3); // 3×1.03=3.09→3（四舍五入到最小单位）
  });

  it('环 A→B→A 抛 2003（跨两个 BOM 形成环）', () => {
    const graph = makeGraph({
      4000: [{ childMaterialId: 5000, qty: 1, scrapRate: 0 }],
      5000: [{ childMaterialId: 4000, qty: 1, scrapRate: 0 }],
    });
    const materials = materialsOf({ id: 4000, code: 'CY_A' }, { id: 5000, code: 'CY_B' });
    const root = { id: 40000, materialId: 4000, items: graph.byMaterial.get(4000)!.items };
    expect(() => svc.explodeFromBom(graph, root, materials, 1)).toThrow(BusinessException);
    try {
      svc.explodeFromBom(graph, root, materials, 1);
    } catch (e) {
      expect((e as BusinessException).code).toBe(2003);
    }
  });

  it('自引用（明细含父物料自己）抛 2003', () => {
    const graph = makeGraph({ 6000: [{ childMaterialId: 6000, qty: 1, scrapRate: 0 }] });
    const materials = materialsOf({ id: 6000, code: 'SELF' });
    const root = { id: 60000, materialId: 6000, items: graph.byMaterial.get(6000)!.items };
    expect(() => svc.explodeFromBom(graph, root, materials, 1)).toThrow(/父物料自身/);
  });

  it('深度超过 20 抛 2003（防御漏检的环）', () => {
    // 造一条 22 级链
    const edges: Record<number, { childMaterialId: number; qty: number; scrapRate: number }[]> = {};
    for (let i = 1; i <= 22; i++) edges[i] = [{ childMaterialId: i + 1, qty: 1, scrapRate: 0 }];
    const graph = makeGraph(edges);
    const mats = new Map(
      Array.from({ length: 24 }, (_, i) => [i + 1, { code: `L${i + 1}`, name: '', type: 'SEMI' } as const]),
    );
    const root = { id: 1, materialId: 1, items: edges[1] };
    expect(() => svc.explodeFromBom(graph as never, root, mats as never, 1)).toThrow(/深度超过/);
  });

  it('子件无 ACTIVE BOM 视为叶子（只进汇总，不报错）', () => {
    const graph = makeGraph({ 7000: [{ childMaterialId: 8000, qty: 2, scrapRate: 0 }] }); // 8000 无图节点
    const materials = materialsOf({ id: 7000, code: 'P' }, { id: 8000, code: 'LEAF' });
    const root = { id: 70000, materialId: 7000, items: graph.byMaterial.get(7000)!.items };
    const r = svc.explodeFromBom(graph, root, materials, 1);
    expect(r.summary.find((s) => s.code === 'LEAF')!.qty).toBe(2);
    expect(r.tree.children[0].children).toHaveLength(0);
  });

  it('父数量 0：全部为 0，不报错', () => {
    const graph = makeGraph({ 9000: [{ childMaterialId: 9001, qty: 3, scrapRate: 300 }] });
    const materials = materialsOf({ id: 9000, code: 'P' }, { id: 9001, code: 'C' });
    const root = { id: 90000, materialId: 9000, items: graph.byMaterial.get(9000)!.items };
    const r = svc.explodeFromBom(graph, root, materials, 0);
    expect(r.summary.find((s) => s.code === 'C')!.qty).toBe(0);
  });

  it('菱形（两条路径到同一叶子）累加：1×2 + 1×3 = 5', () => {
    // ROOT → A(×1) → SCREW(×2)；ROOT → B(×1) → SCREW(×3)
    const graph = makeGraph({
      1: [
        { childMaterialId: 2, qty: 1, scrapRate: 0 },
        { childMaterialId: 3, qty: 1, scrapRate: 0 },
      ],
      2: [{ childMaterialId: 9, qty: 2, scrapRate: 0 }],
      3: [{ childMaterialId: 9, qty: 3, scrapRate: 0 }],
    });
    const materials = materialsOf({ id: 1, code: 'R', type: 'FINISHED' }, { id: 2, code: 'A', type: 'SEMI' }, { id: 3, code: 'B', type: 'SEMI' }, { id: 9, code: 'S' });
    const root = { id: 10, materialId: 1, items: graph.byMaterial.get(1)!.items };
    const r = svc.explodeFromBom(graph, root, materials, 1);
    expect(r.summary.find((s) => s.code === 'S')!.qty).toBe(5);
  });
});
