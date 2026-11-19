/**
 * M4 对账 fixture（第 54 节）：标准种子 + 固定操作序列 → 标准答案。
 * 用法：先 npm run seed（重置到种子）再跑本脚本，然后 GET /reports/* 比对 docs/reports-reconcile.md。
 *
 * 序列（全部在对账日 D，设备 E1=EQ-SMT-01@WC-SMT、E2=EQ-SMT-02@WC-SMT）：
 *   工单 A：计划 100 → 报工 60 良 5 不良（早班 09:00，E1）→ 35 良 0 不良（中班 17:00，E1）
 *   设备 E1：停机 60 分钟（22:00-23:00，次日，不影响 D 日 480 分钟计划——为对账简单落在 D 日内）
 *   工单 B：计划 50 → 报工 20 良 10 不良（早班 10:00，E2）
 *   缺陷：B 的 FQC 检验 FAIL，缺陷记录 10 件挂 code DEF-01（若种子无缺陷码则建一个）
 *
 * 停机落在 D 日 10:00-11:00（早班内）——E1 当日计划 480 分钟，停机 60。
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** 工厂时区 D 日 HH:mm → UTC Date */
function at(day: string, hhmm: string): Date {
  return new Date(Date.parse(`${day}T${hhmm}:00+08:00`));
}
function dayStr(offset = 0): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

async function main() {
  const D = dayStr(0);
  const yesterday = dayStr(-1);
  console.log('对账日（工厂时区）:', D);

  // 0. 准备：找种子 SMT 车间设备 E1/E2、员工、早中班
  const wc = await prisma.workCenter.findFirst({ where: { code: 'WC-SMT' } });
  if (!wc) throw new Error('种子缺 WC-SMT');
  const e1 = await prisma.equipment.findFirst({ where: { code: 'EQ-SMT-01' } });
  const e2 = await prisma.equipment.findFirst({ where: { code: 'EQ-SMT-02' } });
  if (!e1 || !e2) throw new Error('种子缺 EQ-SMT-01/02');
  const emp = await prisma.employee.findFirst({ where: { status: 'ACTIVE' } });
  if (!emp) throw new Error('无在职员工');
  const early = await prisma.shift.findUnique({ where: { code: 'SH-EARLY' } });
  const mid = await prisma.shift.findUnique({ where: { code: 'SH-MID' } });

  // 1. 物料 + BOM + 路线（工序 standardMinutes=5，工作中心 SMT）+ 订单
  const cat = await prisma.materialCategory.upsert({
    where: { code: 'M4-CAT' }, update: {}, create: { code: 'M4-CAT', name: '对账分类' },
  });
  const unit = await prisma.unit.upsert({
    where: { code: 'M4-U' }, update: {}, create: { code: 'M4-U', name: '个' },
  });
  const matA = await prisma.material.upsert({
    where: { code: 'M4-MAT-A' },
    update: { requireFqc: true }, // M4 用例：FQC 未合格前入库 → 422
    create: { code: 'M4-MAT-A', name: '对账物料A', type: 'FINISHED', categoryId: cat.id, unitId: unit.id, requireFqc: true },
  });
  await prisma.bom.create({
    data: { materialId: matA.id, version: `m4-${Date.now()}`, status: 'ACTIVE', effectiveFrom: new Date(yesterday) },
  });
  const routing = await prisma.routing.create({
    data: { materialId: matA.id, version: `m4-${Date.now()}`, status: 'ACTIVE' },
  });
  await prisma.routingOperation.create({
    data: { routingId: routing.id, seq: 10, code: 'M4-OP1', name: '对账工序', workCenterId: wc.id, standardMinutes: 5 },
  });

  const mkOrder = async (code: string, qty: number) =>
    prisma.productionOrder.create({
      data: { code, materialId: matA.id, qty, dueDate: new Date(Date.now() + 30 * 86_400_000), status: 'PLANNED' },
    });
  const orderA = await mkOrder(`M4-PO-A-${Date.now().toString(36)}`, 100);
  const orderB = await mkOrder(`M4-PO-B-${Date.now().toString(36)}`, 50);

  // 2. 工单（直接建 RELEASED 状态，绕开拆单/下达——fixture 只服务报表对账）
  const woA = await prisma.workOrder.create({
    data: {
      code: `M4-WO-A-${Date.now().toString(36)}`, productionOrderId: orderA.id, materialId: matA.id,
      qty: 100, workCenterId: wc.id, routingId: routing.id, status: 'IN_PROGRESS',
    },
  });
  const woB = await prisma.workOrder.create({
    data: {
      code: `M4-WO-B-${Date.now().toString(36)}`, productionOrderId: orderB.id, materialId: matA.id,
      qty: 50, workCenterId: wc.id, routingId: routing.id, status: 'IN_PROGRESS',
    },
  });
  const team = await prisma.team.findFirst({ where: { workCenterId: wc.id } });
  const mkOp = async (woId: number, qty: number) =>
    prisma.workOrderOperation.create({
      data: {
        workOrderId: woId, seq: 10, operationCode: 'M4-OP1', operationName: '对账工序',
        workCenterId: wc.id, standardMinutes: 5, plannedQty: qty, status: 'IN_PROGRESS',
        teamId: team?.id, startedAt: at(D, '08:00'),
      },
    });
  const opA = await mkOp(woA.id, 100);
  const opB = await mkOp(woB.id, 50);

  // 3. 报工（直接插流水 + 累计，绕过 API 的时间窗校验；幂等键对账前缀）
  const mkReport = async (op: { id: number; workOrderId: number; teamId: number | null }, equipmentId: number, good: number, defect: number, time: string, shiftId: number | null, key: string) => {
    await prisma.workReport.create({
      data: {
        workOrderOperationId: op.id, workOrderId: op.workOrderId, employeeId: emp.id,
        teamId: op.teamId, equipmentId, shiftId,
        goodQty: good, defectQty: defect, reportedAt: at(D, time),
        idempotencyKey: `m4-${key}-${Date.now()}`,
      },
    });
    await prisma.workOrderOperation.update({
      where: { id: op.id },
      data: { completedQty: { increment: good }, defectQty: { increment: defect } },
    });
    // 末道工序完工回写工单 completedQty
    await prisma.workOrder.update({
      where: { id: op.workOrderId },
      data: { completedQty: { increment: good } },
    });
  };
  // 工单 A：60 良 5 不良（早班 09:00，E1）→ 35 良 0（中班 17:00，E1）
  await mkReport(opA, e1.id, 60, 5, '09:00', early?.id ?? null, 'a1');
  await mkReport(opA, e1.id, 35, 0, '17:00', mid?.id ?? null, 'a2');
  // 工单 B：20 良 10 不良（早班 10:00，E2）
  await mkReport(opB, e2.id, 20, 10, '10:00', early?.id ?? null, 'b1');

  // 4. E1 停机 60 分钟（D 日 22:00-23:00）
  await prisma.downtime.create({
    data: {
      equipmentId: e1.id, reasonCode: 'FAULT',
      startedAt: at(D, '22:00'), endedAt: at(D, '23:00'),
    },
  });

  // 5. 缺陷：FQC 检验单 FAIL，10 件挂缺陷码
  const defCode = await prisma.defectCode.upsert({
    where: { code: 'DEF-SCRATCH' },
    update: {},
    create: { code: 'DEF-SCRATCH', name: '划伤', category: '外观', severity: 'MINOR' },
  });
  const insp = await prisma.inspection.create({
    data: {
      code: `M4-FQC-${Date.now().toString(36)}`, type: 'FQC', refType: 'WORK_ORDER', refId: woB.id,
      sampleQty: 30, passQty: 20, failQty: 10, result: 'FAIL', inspectedAt: at(D, '11:00'),
    },
  });
  await prisma.inspectionDefect.create({
    data: { inspectionId: insp.id, defectCodeId: defCode.id, qty: 10 },
  });

  console.log('fixture 完成：');
  console.log(`  工单 A = ${woA.id}（60+5 早班 E1 / 35 中班 E1）`);
  console.log(`  工单 B = ${woB.id}（20+10 早班 E2）`);
  console.log(`  E1 = ${e1.id} 停机 60min；缺陷 10 件 DEF-SCRATCH`);
  console.log(`  对账 from=${D} to=${D}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
