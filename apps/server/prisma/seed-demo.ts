/**
 * 业务演示种子：让"每个表都有数据"——主数据之外的全部业务单据/流水/日志。
 * 幂等：以业务编码 upsert / 先查后建，可反复执行不翻倍。
 * 前置：seed-rbac（用户）、seed-master（物料/BOM/路线/班次/班组/员工/仓库/缺陷代码）必须先跑。
 * 日期策略：相对 now 回退天数生成，任何时间跑出来都是"最近两周在产"的演示态。
 */
import type { PrismaClient } from '@prisma/client';

const DAY = 86_400_000;
const at = (daysAgo: number, hour = 8, minute = 0) => {
  const d = new Date(Date.now() - daysAgo * DAY);
  d.setHours(hour, minute, 0, 0);
  return d;
};
const dateStr = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10);

/** 逐日聚合日报：返回某设备过去 N 天（含今天）的聚合数组 */
function dailyAgg(days: number) {
  return Array.from({ length: days }, (_, i) => {
    const daysAgo = days - 1 - i;
    // 周末产量低；有 15% 概率故障半天
    const dow = new Date(Date.now() - daysAgo * DAY).getDay();
    const fault = (daysAgo * 7 + 3) % 13 === 0;
    const base = dow === 0 || dow === 6 ? 240 : 420;
    const down = fault ? 210 : (daysAgo % 5 === 0 ? 40 : 12);
    return { date: dateStr(daysAgo), runningMinutes: base - down, downMinutes: down, downtimeCount: fault ? 2 : down > 30 ? 1 : 0 };
  });
}

export async function seedDemoBusiness(prisma: PrismaClient) {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
  const plannerU = await prisma.user.findUniqueOrThrow({ where: { username: 'planner' } });
  const operatorU = await prisma.user.findUniqueOrThrow({ where: { username: 'operator' } });
  const qcU = await prisma.user.findUniqueOrThrow({ where: { username: 'qc' } });

  const wcs = await prisma.workCenter.findMany({ orderBy: { id: 'asc' } });
  const eqs = await prisma.equipment.findMany({ orderBy: { id: 'asc' } });
  const eq = (code: string) => eqs.find((e) => e.code === code)!;
  const teams = await prisma.team.findMany();
  const teamByWc = new Map(wcs.map((w) => [w.id, teams.find((t) => t.workCenterId === w.id)!]));
  const shifts = await prisma.shift.findMany({ orderBy: { id: 'asc' } });
  const employees = await prisma.employee.findMany({ where: { status: 'ACTIVE' }, include: { team: true }, orderBy: { id: 'asc' } });
  const routings = await prisma.routing.findMany({ where: { status: 'ACTIVE' }, include: { operations: true }, orderBy: { materialId: 'asc' } });
  const routingByMaterial = new Map(routings.map((r) => [r.materialId, r]));
  const whFg = await prisma.warehouse.findUniqueOrThrow({ where: { code: 'WH-FG' } });
  const whRaw = await prisma.warehouse.findUniqueOrThrow({ where: { code: 'WH-RAW' } });
  const defectCodes = await prisma.defectCode.findMany({ orderBy: { id: 'asc' } });
  const finishedMaterials = await prisma.material.findMany({ where: { type: 'FINISHED' }, orderBy: { id: 'asc' } });

  const shiftOfDay = (d: Date) => {
    const h = d.getHours();
    return shifts.find((s) => (h >= 8 && h < 16 ? s.code === 'SH-EARLY' : h >= 16 ? s.code === 'SH-MID' : s.code === 'SH-NIGHT')) ?? shifts[0];
  };

  // ================= 生产订单（DRAFT/PLANNED/RELEASED/COMPLETED/CANCELLED 各态） =================
  const poStatuses = ['DRAFT', 'PLANNED', 'RELEASED', 'COMPLETED', 'CANCELLED'] as const;
  const poIds: number[] = [];
  let woCreated = 0;
  for (let i = 0; i < 5; i++) {
    const material = finishedMaterials[i % Math.min(10, finishedMaterials.length)];
    const code = `PO-DEMO-${String(i + 1).padStart(3, '0')}`;
    const po = await prisma.productionOrder.upsert({
      where: { code },
      update: {},
      create: {
        code, materialId: material.id, qty: 500 + i * 100, dueDate: at(-(14 - i * 2), 18), priority: (i % 3) + 1,
        source: 'MANUAL', status: poStatuses[i], createdBy: plannerU.username, updatedBy: plannerU.username,
      },
    });
    poIds.push(po.id);
  }

  // ================= 工单 + 工序任务 + 状态日志 =================
  // PO-DEMO-002/003 已下达：建工单（快照路线 4 道工序），状态分布在 CREATED/RELEASED/IN_PROGRESS/COMPLETED
  const routingOps = (routingId: number) => routings.find((r) => r.id === routingId)!.operations.sort((a, b) => a.seq - b.seq);
  let opCreated = 0; let reportCount = 0;
  const demoWoCodes = ['WO-DEMO-001', 'WO-DEMO-002', 'WO-DEMO-003'];
  // 只从“有生效工艺路线”的成品里造工单：否则下达会因物料无 ACTIVE 路线直接失败。
  // 不能用 `?? routings[0]` 兜底——那会把别的物料的路线挂到工单上，造成下达永远失败的脏数据。
  const routeableFinished = finishedMaterials.filter((m) => routingByMaterial.has(m.id));
  const woMaterialPool = routeableFinished.length ? routeableFinished : finishedMaterials;
  for (let w = 0; w < demoWoCodes.length; w++) {
    const po = await prisma.productionOrder.findUniqueOrThrow({ where: { code: poStatuses[2] === 'RELEASED' ? 'PO-DEMO-003' : 'PO-DEMO-002' } });
    const material = woMaterialPool[w % woMaterialPool.length];
    const routing = routingByMaterial.get(material.id);
    if (!routing) continue; // 兜底：该物料没有生效路线就不造工单，避免产生无法下达的数据
    const status = ['CREATED', 'RELEASED', 'IN_PROGRESS'][w];
    const wo = await prisma.workOrder.upsert({
      where: { code: demoWoCodes[w] },
      update: {},
      create: {
        code: demoWoCodes[w], productionOrderId: po.id, materialId: material.id, qty: po.qty,
        routingId: routing.id, workCenterId: routing.operations[0].workCenterId,
        plannedStart: at(3 - w, 8), plannedEnd: at(1 - w, 18), status, createdBy: plannerU.username,
      },
    });
    if (woCreated >= demoWoCodes.length) continue;
    woCreated += 1;
    // 工序任务快照（每工单 4 道）
    const ops = routingOps(routing.id);
    let prevStatus: string | null = null;
    for (let k = 0; k < statusLogsFor(status).length; k++) {
      const toStatus = statusLogsFor(status)[k];
      await prisma.workOrderStatusLog.create({
        data: { workOrderId: wo.id, fromStatus: prevStatus ?? 'CREATED', toStatus, action: ACTION_BY_STATUS[toStatus] ?? 'release', operatorId: plannerU.id, operatorName: plannerU.username, createdAt: at(2 - w, 9 + k) },
      });
      prevStatus = toStatus;
    }
    // CREATED 工单不预建工序任务：下达时由 release 事务统一生成；
    // 若这里先建好，用户点「下达」会撞 (workOrderId, seq) 唯一键 → 409 数据冲突。
    if (status !== 'CREATED') {
      for (let s = 0; s < ops.length; s++) {
        const o = ops[s];
        const done = status === 'COMPLETED' || (status === 'IN_PROGRESS' && s === 0);
        const opTask = await prisma.workOrderOperation.upsert({
          where: { workOrderId_seq: { workOrderId: wo.id, seq: o.seq } },
          update: {},
          create: {
            workOrderId: wo.id, seq: o.seq, operationCode: o.code, operationName: o.name,
            workCenterId: o.workCenterId, standardMinutes: o.standardMinutes, plannedQty: wo.qty,
            teamId: teamByWc.get(o.workCenterId)?.id, status: done ? 'COMPLETED' : status === 'IN_PROGRESS' && s === 1 ? 'IN_PROGRESS' : status === 'RELEASED' ? 'READY' : 'PENDING',
            startedAt: done || (status === 'IN_PROGRESS' && s === 1) ? at(2, 8) : null,
            completedAt: done ? at(1, 17) : null,
          },
        });
        opCreated += 1;
        // 已开工的工序生成报工流水（每工序 3 笔，员工按班组轮询）
        if (opTask.status === 'IN_PROGRESS' || opTask.status === 'COMPLETED') {
          const empsOfTeam = employees.filter((e) => e.team.workCenterId === o.workCenterId);
          for (let rIdx = 0; rIdx < 3; rIdx++) {
            const emp = empsOfTeam[(w * 3 + rIdx) % Math.max(1, empsOfTeam.length)] ?? employees[0];
            const good = 20 + rIdx * 5; const defect = rIdx === 2 ? 2 : 0;
            await prisma.workReport.upsert({
              where: { idempotencyKey: `demo-${wo.id}-${o.seq}-${rIdx}` },
              update: {},
              create: {
                workOrderOperationId: opTask.id, workOrderId: wo.id, employeeId: emp.id,
                teamId: emp.teamId, shiftId: shiftOfDay(at(1, 10)).id, equipmentId: eqs.find((e) => e.workCenterId === o.workCenterId)?.id,
                goodQty: good, defectQty: defect, reportedAt: at(1, 10 + rIdx),
                idempotencyKey: `demo-${wo.id}-${o.seq}-${rIdx}`, createdBy: operatorU.username,
              },
            });
            reportCount += 1;
            // 良品累计回写
            await prisma.workOrderOperation.update({ where: { id: opTask.id }, data: { completedQty: { increment: good } } });
          }
        }
      }
    }
    // 工单 completedQty 与工序口径对齐：种子直接写 op 数量、绕过了 reportOperation 的同步，
    // 不同步会出现「工序已完成 X 件、工单却显示 0/Y」，完工数量校验也会误判。
    if (status !== 'CREATED') {
      const opsNow = await prisma.workOrderOperation.findMany({ where: { workOrderId: wo.id }, orderBy: { seq: 'asc' } });
      const withOutput = [...opsNow].reverse().find((o) => o.completedQty > 0);
      if (withOutput) {
        await prisma.workOrder.update({ where: { id: wo.id }, data: { completedQty: withOutput.completedQty } });
      }
    }
    // 完工工单回写 completedQty 并生成成品批次 + 成品仓余额（入库流水）
    if (status === 'COMPLETED') {
      const total = await prisma.workReport.aggregate({ where: { workOrderId: wo.id }, _sum: { goodQty: true } });
      await prisma.workOrder.update({ where: { id: wo.id }, data: { completedQty: total._sum.goodQty ?? 0 } });
      const lotNo = `${wo.code}-FG`;
      const lot = await prisma.lot.upsert({
        where: { lotNo }, update: {},
        create: { lotNo, materialId: wo.materialId, qty: total._sum.goodQty ?? 0, sourceWorkOrderId: wo.id, producedAt: at(1, 18) },
      });
      const hasBalance = await prisma.inventoryBalance.findFirst({ where: { warehouseId: whFg.id, materialId: wo.materialId, lotId: lot.id } });
      if (!hasBalance) {
        await prisma.inventoryBalance.create({ data: { warehouseId: whFg.id, materialId: wo.materialId, lotId: lot.id, qty: lot.qty } });
        await prisma.inventoryTransaction.create({ data: { type: 'RECEIPT', warehouseId: whFg.id, materialId: wo.materialId, lotId: lot.id, qty: lot.qty, refType: 'WORK_ORDER', refId: wo.id, operatorName: 'seed', remark: `工单 ${wo.code} 完工入库` } });
      }
    }
  }

  // 领料单：给 RELEASED 工单生成一张 ISSUED 领料单（BOM 子件从原料仓扣）——数量口径演示用，不动余额（演示批次从期初 INIT 已有余额）
  const relWo = await prisma.workOrder.findUniqueOrThrow({ where: { code: 'WO-DEMO-002' } });
  const issue = await prisma.materialIssue.upsert({
    where: { code: 'MI-DEMO-001' }, update: {},
    create: { code: 'MI-DEMO-001', workOrderId: relWo.id, status: 'ISSUED', createdBy: plannerU.username },
  });
  const bom = await prisma.bom.findFirstOrThrow({ where: { materialId: relWo.materialId, status: 'ACTIVE' }, include: { items: true } });
  // 只对有期初批次的子件（RAW）出领料明细：半成品子件无库存批次，演示数据不为它们虚构库存
  for (const item of bom.items) {
    if ((await prisma.materialIssueItem.count({ where: { issueId: issue.id } })) >= 5) break;
    const rawLot = await prisma.lot.findFirst({ where: { materialId: item.childMaterialId } });
    if (!rawLot) continue;
    const exists = await prisma.materialIssueItem.findFirst({ where: { issueId: issue.id, materialId: item.childMaterialId } });
    if (exists) continue;
      await prisma.materialIssueItem.create({
        data: { issueId: issue.id, materialId: item.childMaterialId, requiredQty: item.qty * relWo.qty, lotId: rawLot.id },
      });
      await prisma.inventoryTransaction.create({
        data: { type: 'ISSUE', warehouseId: whRaw.id, materialId: item.childMaterialId, lotId: rawLot.id, qty: -item.qty * relWo.qty, refType: 'MATERIAL_ISSUE', refId: issue.id, operatorName: 'seed', remark: `领料单 ${issue.code}` },
      });
  }

  // ================= 检验单 + 缺陷明细 =================
  const inspectionDefs = [
    { code: 'QC-DEMO-001', type: 'IQC', refType: 'LOT', result: 'PASS' },
    { code: 'QC-DEMO-002', type: 'IPQC', refType: 'OPERATION', result: 'FAIL' },
    { code: 'QC-DEMO-003', type: 'FQC', refType: 'WORK_ORDER', result: 'CONCESSION' },
    { code: 'QC-DEMO-004', type: 'FQC', refType: 'WORK_ORDER', result: 'PENDING' },
  ] as const;
  const inProgressWo = await prisma.workOrder.findUniqueOrThrow({ where: { code: 'WO-DEMO-003' } });
  // IQC 引用成品批次：完工工单可能没有产生该物料的批次（演示数据轮转），降级取任意一个成品/原料批次
  const anyLot = await prisma.lot.findFirst({ where: { material: { type: 'FINISHED' } } }) ?? await prisma.lot.findFirstOrThrow({ where: { sourceWorkOrderId: null } });
  const ipqcOp = await prisma.workOrderOperation.findFirstOrThrow({ where: { workOrderId: inProgressWo.id, status: 'COMPLETED' } });
  for (const d of inspectionDefs) {
    const insp = await prisma.inspection.upsert({
      where: { code: d.code }, update: {},
      create: {
        code: d.code, type: d.type, refType: d.refType,
        refId: d.refType === 'LOT' ? anyLot.id : d.refType === 'OPERATION' ? ipqcOp.id : inProgressWo.id,
        sampleQty: 50, passQty: d.result === 'FAIL' ? 44 : 48, failQty: d.result === 'FAIL' ? 6 : 2,
        result: d.result, inspectorId: qcU.id, inspectedAt: d.result === 'PENDING' ? null : at(1, 15),
        disposition: d.result === 'FAIL' ? 'REWORK' : d.result === 'CONCESSION' ? 'CONCESSION' : null,
        dispositionReason: d.result === 'FAIL' ? '虚焊数量超限，返工' : d.result === 'CONCESSION' ? '外观轻微划伤，让步接收' : null,
        createdBy: qcU.username,
      },
    });
    if (d.result === 'FAIL' || d.result === 'CONCESSION') {
      const has = await prisma.inspectionDefect.findFirst({ where: { inspectionId: insp.id } });
      if (!has) {
        await prisma.inspectionDefect.createMany({
          data: [
            { inspectionId: insp.id, defectCodeId: defectCodes[1 % defectCodes.length].id, qty: d.result === 'FAIL' ? 4 : 1 },
            { inspectionId: insp.id, defectCodeId: defectCodes[2 % defectCodes.length].id, qty: d.result === 'FAIL' ? 2 : 1 },
          ],
        });
      }
    }
  }

  // ================= 设备：状态日志 / 停机 / 日报 =================
  for (const equipment of eqs) {
    // 状态日志：一周内两次切换，当前态与设备 status 一致
    const hasLog = await prisma.equipmentStatusLog.findFirst({ where: { equipmentId: equipment.id } });
    if (!hasLog) {
      await prisma.equipmentStatusLog.createMany({
        data: [
          { equipmentId: equipment.id, fromStatus: 'IDLE', toStatus: 'RUNNING', operatorId: admin.id, operatorName: admin.username, reason: '班前点检完成', changedAt: at(6, 8) },
          { equipmentId: equipment.id, fromStatus: 'RUNNING', toStatus: fault(equipment.id) ? 'FAULT' : 'RUNNING', operatorId: admin.id, operatorName: admin.username, reason: fault(equipment.id) ? '主轴异响报警' : '正常生产', changedAt: at(3, 14) },
        ],
      });
    }
    // 停机记录：故障设备一条未结束的 + 正常设备一条已结束的
    const hasDt = await prisma.downtime.findFirst({ where: { equipmentId: equipment.id } });
    if (!hasDt) {
      const broken = fault(equipment.id);
      await prisma.downtime.create({
        data: {
          equipmentId: equipment.id, reasonCode: broken ? 'FAULT' : 'CHANGEOVER',
          startedAt: broken ? at(0, 6) : at(2, 10), endedAt: broken ? null : at(2, 11),
          durationMinutes: broken ? null : 60, remark: broken ? '待维修' : '换型 45 分钟 + 准备 15 分钟',
          workOrderId: relWo.id,
        },
      });
    }
  }
  // 日报：12 台设备 × 14 天
  for (const equipment of eqs) {
    for (const agg of dailyAgg(14)) {
      await prisma.equipmentDailyReport.upsert({
        where: { equipmentId_date: { equipmentId: equipment.id, date: agg.date } },
        update: {},
        create: {
          equipmentId: equipment.id, date: agg.date, runningMinutes: agg.runningMinutes,
          downMinutes: agg.downMinutes, downtimeCount: agg.downtimeCount, open: agg.downMinutes > 120,
        },
      });
    }
  }

  // ================= 安灯呼叫（四种状态 × 三种类型） =================
  const andonDefs = [
    { code: 'AD-DEMO-001', type: 'MATERIAL', status: 'OPEN' },
    { code: 'AD-DEMO-002', type: 'EQUIPMENT', status: 'RESPONDED' },
    { code: 'AD-DEMO-003', type: 'QUALITY', status: 'CLOSED' },
    { code: 'AD-DEMO-004', type: 'OTHER', status: 'CANCELLED' },
  ] as const;
  const maintainerU = await prisma.user.findUniqueOrThrow({ where: { username: 'maintainer' } });
  for (const d of andonDefs) {
    const exists = await prisma.andonCall.findUnique({ where: { code: d.code } });
    if (exists) continue;
    await prisma.andonCall.create({
      data: {
        code: d.code, type: d.type, workCenterId: wcs[d.code.length % wcs.length].id,
        equipmentId: d.type === 'EQUIPMENT' ? eq('EQ-SMT-01').id : null,
        workOrderId: relWo.id,
        description: { MATERIAL: 'OP20 插件工位 0603 电容缺料', EQUIPMENT: 'SMT-01 贴片机吸嘴堵塞', QUALITY: 'AOI 误报率高，请求质量确认', OTHER: '车间空调温度过高' }[d.type],
        callerId: operatorU.id, status: d.status,
        responderId: d.status === 'OPEN' ? null : d.type === 'EQUIPMENT' ? maintainerU.id : qcU.id,
        respondedAt: d.status === 'OPEN' ? null : at(1, 10),
        closedAt: d.status === 'CLOSED' ? at(1, 11) : null,
        resolution: d.status === 'CLOSED' ? '已补料，恢复生产' : null,
        cancelReason: d.status === 'CANCELLED' ? '误报，现场核实无需呼叫' : null,
        calledAt: at(1, 9),
      },
    });
    // 站内信：呼叫通知责任角色用户（planner/maintainer/qc/admin 各自收到对应类型）
    const responderByType: Record<string, number> = { MATERIAL: plannerU.id, EQUIPMENT: maintainerU.id, QUALITY: qcU.id, OTHER: admin.id };
    const hasNotif = await prisma.notification.findFirst({ where: { userId: responderByType[d.type], refType: 'AndonCall', title: `安灯呼叫 ${d.code}` } });
    if (!hasNotif) {
      await prisma.notification.create({
        data: {
          userId: responderByType[d.type], type: 'ANDON', refType: 'AndonCall',
          title: `安灯呼叫 ${d.code}`, content: `${d.type} 类呼叫：${{ MATERIAL: '缺料', EQUIPMENT: '设备异常', QUALITY: '质量问题', OTHER: '其他' }[d.type]}`,
        },
      });
    }
  }

  // ================= 附件（引用路线工序的 SOP 说明，不落盘演示文件） =================
  const sopOps = await prisma.routingOperation.findMany({ where: { isInspectionPoint: true }, take: 2 });
  for (const ro of sopOps) {
    const path = `uploads/demo-sop-${ro.id}.pdf`;
    const has = await prisma.attachment.findUnique({ where: { path } });
    if (!has) {
      await prisma.attachment.create({
        data: { fileName: `SOP-${ro.name}.pdf`, path, mimeType: 'application/pdf', size: 204800, refType: 'ROUTING_OPERATION', refId: ro.id, uploadedBy: 'admin' },
      });
    }
  }

  // ================= 员工技能 / 调岗记录 =================
  for (const employee of employees.slice(0, 6)) {
    const hasSkill = await prisma.employeeSkill.findFirst({ where: { employeeId: employee.id } });
    if (!hasSkill) {
      await prisma.employeeSkill.create({ data: { employeeId: employee.id, workCenterId: employee.team.workCenterId } });
    }
  }
  const firstEmp = employees[0];
  const hasTransfer = await prisma.employeeTransfer.findFirst({ where: { employeeId: firstEmp.id } });
  if (!hasTransfer) {
    const fromTeam = firstEmp.team;
    const toTeam = teams.find((t) => t.id !== fromTeam.id)!;
    await prisma.employeeTransfer.create({
      data: { employeeId: firstEmp.id, fromTeamId: fromTeam.id, toTeamId: toTeam.id, at: at(7, 9) },
    });
  }

  // ================= 审计日志（登录/关键操作样本） =================
  const hasAudit = await prisma.auditLog.findFirst({ where: { path: '/api/auth/login', userId: admin.id } });
  if (!hasAudit) {
    await prisma.auditLog.createMany({
      data: [
        { userId: admin.id, username: admin.username, method: 'POST', path: '/api/auth/login', module: 'auth', action: 'login', result: 'success', durationMs: 45, ip: '127.0.0.1' },
        { userId: plannerU.id, username: plannerU.username, method: 'POST', path: '/api/production-orders', module: 'production-order', action: 'create', result: 'success', durationMs: 88, ip: '127.0.0.1' },
        { userId: operatorU.id, username: operatorU.username, method: 'GET', path: '/api/andon-calls', module: 'andon', action: 'list', result: 'success', durationMs: 32, ip: '127.0.0.1' },
        { userId: qcU.id, username: qcU.username, method: 'POST', path: '/api/inspections', module: 'inspection', action: 'create', result: 'success', durationMs: 61, ip: '127.0.0.1' },
      ],
    });
  }

  console.log(`seed-demo: 订单 5、工单 ${woCreated}、工序 ${opCreated}、报工 ${reportCount}、检验 4、设备日志/停机/日报（14 天）、安灯 4、通知、附件 2、技能/调岗、审计 4`);
}

const ACTION_BY_STATUS: Record<string, string> = {
  RELEASED: 'release', IN_PROGRESS: 'start', PAUSED: 'pause', COMPLETED: 'complete', CLOSED: 'close', CANCELLED: 'cancel',
};
function statusLogsFor(status: string): string[] {
  if (status === 'CREATED') return [];
  if (status === 'RELEASED') return ['RELEASED'];
  if (status === 'IN_PROGRESS') return ['RELEASED', 'IN_PROGRESS'];
  if (status === 'COMPLETED') return ['RELEASED', 'IN_PROGRESS', 'COMPLETED'];
  if (status === 'PAUSED') return ['RELEASED', 'IN_PROGRESS', 'PAUSED'];
  return [];
}
function fault(equipmentId: number): boolean {
  return equipmentId % 4 === 0; // 每 4 台有 1 台处于故障态演示
}
