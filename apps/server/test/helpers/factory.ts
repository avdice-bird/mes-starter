import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * 第 36 节【测】测试脚手架：流程类测试的公共工厂。
 * 报工（39 节）、库存、追溯的测试都复用；检查标准：≥ 3 个测试文件复用。
 */

let counter = 0;
function uniq(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export interface MaterialWithRouting {
  materialId: number;
  routingId: number;
  workCenterIds: number[];
  catId: number;
  unitId: number;
}

/** 建物料 + ACTIVE 路线（默认 4 道工序，seq 10/20/30/40，工作中心交替） */
export async function createMaterialWithRouting(
  prisma: PrismaService,
  ops = 4,
): Promise<MaterialWithRouting> {
  const cat = await prisma.materialCategory.create({ data: { code: uniq('F_CAT'), name: 'x' } });
  const unit = await prisma.unit.create({ data: { code: uniq('F_U'), name: 'x' } });
  const mat = await prisma.material.create({
    data: { code: uniq('F-FG'), name: '工厂成品', type: 'FINISHED', categoryId: cat.id, unitId: unit.id },
  });
  const workCenterIds: number[] = [];
  for (let i = 0; i < Math.max(1, ops); i++) {
    const wc = await prisma.workCenter.create({
      data: { code: uniq(`F_WC${i}`), name: `工厂产线${i}`, dailyCapacity: 1000 },
    });
    workCenterIds.push(wc.id);
  }
  const routing = await prisma.routing.create({
    data: {
      materialId: mat.id, version: 'v1', status: 'ACTIVE',
      operations: {
        create: Array.from({ length: ops }, (_, i) => ({
          seq: (i + 1) * 10,
          code: `FOP${i + 1}`,
          name: `工序${i + 1}`,
          workCenterId: workCenterIds[i % workCenterIds.length],
          standardMinutes: 5,
        })),
      },
    },
  });
  return { materialId: mat.id, routingId: routing.id, workCenterIds, catId: cat.id, unitId: unit.id };
}

export interface ReleasedWorkOrder {
  workOrderId: number;
  operationIds: number[]; // 按 seq 升序
  orderId: number;
  qty: number;
  routing: MaterialWithRouting;
}

/** 建单 → 拆单 → 下达；返回工单与工序任务 id（按 seq 排序） */
export async function createReleasedWorkOrder(
  prisma: PrismaService,
  app: INestApplication,
  adminToken: string,
  options: { qty?: number; ops?: number; material?: MaterialWithRouting } = {},
): Promise<ReleasedWorkOrder> {
  const qty = options.qty ?? 100;
  const routing = options.material ?? (await createMaterialWithRouting(prisma, options.ops ?? 4));
  const api = () => app.getHttpServer();
  const auth = { Authorization: `Bearer ${adminToken}` };

  const o = await request(api()).post('/api/production-orders').set(auth)
    .send({ code: uniq('F-PO'), materialId: routing.materialId, qty, dueDate: '2027-01-01' });
  if (o.status !== 201) throw new Error(`工厂建单失败: ${JSON.stringify(o.body)}`);
  const s = await request(api()).post(`/api/production-orders/${o.body.data.id}/split`).set(auth)
    .send({ splits: [{ qty }] });
  if (s.status !== 201) throw new Error(`工厂拆分失败: ${JSON.stringify(s.body)}`);
  const workOrderId = (await prisma.workOrder.findFirstOrThrow({ where: { productionOrderId: o.body.data.id } })).id;
  const rel = await request(api()).post(`/api/work-orders/${workOrderId}/release`).set(auth).send({});
  if (rel.status !== 201) throw new Error(`工厂下达失败: ${JSON.stringify(rel.body)}`);

  const ops = await prisma.workOrderOperation.findMany({ where: { workOrderId }, orderBy: { seq: 'asc' } });
  return { workOrderId, operationIds: ops.map((op) => op.id), orderId: o.body.data.id, qty, routing };
}
