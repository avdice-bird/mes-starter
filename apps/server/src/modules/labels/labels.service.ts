import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** 标签数据（第 55 节）：物料/工单/批次。二维码内容约定见 docs/acceptance/labels-sop.md。 */
@Injectable()
export class LabelsService {
  constructor(private prisma: PrismaService) {}

  async material(id: number) {
    const m = await this.prisma.material.findFirst({
      where: { id, isDeleted: false },
      select: { code: true, name: true, spec: true, unit: { select: { code: true } } },
    });
    if (!m) throw new NotFoundException(`物料 ${id} 不存在`);
    return {
      type: 'MATERIAL',
      qr: `MAT:${m.code}`,
      code: m.code,
      name: m.name,
      spec: m.spec ?? null,
      qtyLabel: '计量单位',
      qty: m.unit.code,
      date: new Date().toISOString().slice(0, 10),
    };
  }

  async workOrder(id: number) {
    const w = await this.prisma.workOrder.findUnique({
      where: { id },
      select: {
        code: true, qty: true, status: true, plannedStart: true,
        material: { select: { code: true, name: true } },
        productionOrder: { select: { code: true } },
      },
    });
    if (!w) throw new NotFoundException(`工单 ${id} 不存在`);
    return {
      type: 'WORK_ORDER',
      qr: `WO:${w.code}`,
      code: w.code,
      name: `${w.material.name}（${w.productionOrder.code}）`,
      spec: null,
      qtyLabel: '计划数',
      qty: w.qty,
      date: (w.plannedStart ?? new Date()).toISOString().slice(0, 10),
    };
  }

  async lot(lotNo: string) {
    const l = await this.prisma.lot.findUnique({
      where: { lotNo },
      select: {
        lotNo: true, sourceType: true, createdAt: true,
        material: { select: { code: true, name: true } },
      },
    });
    if (!l) throw new NotFoundException(`批次 ${lotNo} 不存在`);
    return {
      type: 'LOT',
      qr: `LOT:${l.lotNo}`,
      code: l.lotNo,
      name: l.material.name,
      spec: `物料 ${l.material.code}`,
      qtyLabel: '来源',
      qty: l.sourceType === 'PRODUCTION' ? '生产' : '采购',
      date: l.createdAt.toISOString().slice(0, 10),
    };
  }

  /** 批量：同类型多 id 一次取齐（打印页一页多标签）；单个不存在不阻断整批 */
  async batch(kind: 'material' | 'work-order' | 'lot', ids: (number | string)[]) {
    const out = [];
    for (const id of ids) {
      try {
        out.push(kind === 'lot'
          ? await this.lot(String(id))
          : kind === 'material' ? await this.material(Number(id)) : await this.workOrder(Number(id)));
      } catch { /* 缺失跳过 */ }
    }
    return out;
  }
}
