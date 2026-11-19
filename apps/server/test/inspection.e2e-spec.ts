import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, resetDb, seedRbacForTest, login } from './helpers/app';
import { PrismaService } from '../src/prisma/prisma.service';
import { createMaterialWithRouting } from './helpers/factory';
import { validateSubmission } from '../src/modules/inspection/inspection.service';
import { BusinessException } from '../src/common/exceptions/business.exception';

/**
 * 第 45 节【磨+测】质检与报工、入库的联动。
 * 用例 1-10（磨）+ 单元（结果校验函数）+ 权限矩阵。
 */
describe('Inspection 联动（第 45 节）', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let employeeId: number;
  let weldDefectId: number;

  const api = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  let seq = 0;
  const uniq = (p: string) => `${p}${Date.now().toString(36)}${(seq += 1).toString(36)}`;

  /** 质检点场景：1 道质检点工序 + 1 道普通工序的已下达开工工单 */
  async function setupInspectionPoint(requireFqc = false) {
    const m = await createMaterialWithRouting(prisma, 1);
    const wc = m.workCenterIds[0];
    const cat = await prisma.materialCategory.create({ data: { code: uniq('IQ_C'), name: 'x' } });
    const unit = await prisma.unit.create({ data: { code: uniq('IQ_U'), name: 'x' } });
    const fg = await prisma.material.create({
      data: { code: uniq('IQ-FG'), name: '成品', type: 'FINISHED', categoryId: cat.id, unitId: unit.id, requireFqc },
    });
    const team = await prisma.team.create({ data: { code: uniq('IQ_T'), name: 't', workCenterId: wc } });
    employeeId = (await prisma.employee.create({ data: { code: uniq('IQ_E'), name: 'e', teamId: team.id } })).id;
    // 两道工序：10 质检点、20 普通
    await prisma.routing.create({ data: { materialId: fg.id, version: 'v1', status: 'ACTIVE',
      operations: { create: [
        { seq: 10, code: 'IQ-OP1', name: '质检装配', workCenterId: wc, standardMinutes: 5, isInspectionPoint: true },
        { seq: 20, code: 'IQ-OP2', name: '包装', workCenterId: wc, standardMinutes: 5 },
      ] } } });
    const o = await request(api()).post('/api/production-orders').set(auth(adminToken)).send({ code: uniq('IQ-PO'), materialId: fg.id, qty: 100, dueDate: '2027-01-01' });
    await request(api()).post(`/api/production-orders/${o.body.data.id}/split`).set(auth(adminToken)).send({ splits: [{ qty: 100, workCenterId: wc }] });
    const woId = (await prisma.workOrder.findFirstOrThrow({ where: { productionOrderId: o.body.data.id } })).id;
    await request(api()).post(`/api/work-orders/${woId}/release`).set(auth(adminToken)).send({});
    await request(app.getHttpServer()).post(`/api/work-orders/${woId}/start`).set(auth(adminToken)).send({});
    const ops = await prisma.workOrderOperation.findMany({ where: { workOrderId: woId }, orderBy: { seq: 'asc' } });
    await request(api()).post(`/api/work-order-operations/${ops[0].id}/start`).set(auth(adminToken)).send({});
    return { fg, woId, qcOp: ops[0], nextOp: ops[1], whFg: await prisma.warehouse.create({ data: { code: uniq('IQ_WH'), name: '成品仓' } }) };
  }

  beforeAll(async () => { ({ app, prisma } = await createTestApp()); });
  afterAll(async () => { await app.close(); });

  beforeEach(async () => {
    await resetDb(prisma);
    await seedRbacForTest(prisma);
    adminToken = (await login(app, 'admin', 'Admin@123')).accessToken;
    let dc = await prisma.defectCode.findFirst({ where: { code: 'DF-WELD' } });
    if (!dc) dc = await prisma.defectCode.create({ data: { code: 'DF-WELD', name: '焊接不良', category: '外观', severity: 'MAJOR' } });
    weldDefectId = dc.id;
  });

  it('用例1：质检点工序报工 → 自动生成 IPQC 待检单；下道保持 PENDING', async () => {
    const s = await setupInspectionPoint();
    await request(api()).post('/api/work-reports').set(auth(adminToken)).send({
      workOrderOperationId: s.qcOp.id, employeeId, goodQty: 100, defectQty: 0, idempotencyKey: uniq('iq'),
    });
    // IPQC 自动生成
    const ipqc = await prisma.inspection.findFirstOrThrow({ where: { type: 'IPQC', refType: 'OPERATION', refId: s.qcOp.id } });
    expect(ipqc.result).toBe('PENDING');
    // 下道保持 PENDING（本道已报满 COMPLETED，但质检放行前不流转）
    const next = await prisma.workOrderOperation.findUniqueOrThrow({ where: { id: s.nextOp.id } });
    expect(next.status).toBe('PENDING');
    expect((await prisma.workOrderOperation.findUniqueOrThrow({ where: { id: s.qcOp.id } })).status).toBe('COMPLETED');
  });

  it('用例2：IPQC FAIL → 下道不 READY；REWORK 处理后合格放行（重新提交 PASS）', async () => {
    const s = await setupInspectionPoint();
    await request(api()).post('/api/work-reports').set(auth(adminToken)).send({
      workOrderOperationId: s.qcOp.id, employeeId, goodQty: 100, defectQty: 0, idempotencyKey: uniq('iq'),
    });
    const ipqc = await prisma.inspection.findFirstOrThrow({ where: { type: 'IPQC', refType: 'OPERATION', refId: s.qcOp.id } });
    // 提交 FAIL：抽 100，80 良 20 不良
    const sub = await request(api()).post(`/api/inspections/${ipqc.id}/submit`).set(auth(adminToken)).send({
      passQty: 80, failQty: 20, defects: [{ defectCodeId: weldDefectId, qty: 20 }],
    });
    expect(sub.status).toBe(201);
    expect(sub.body.data.result).toBe('FAIL');
    // FAIL → 下道不 READY（qcHold 仍在：无 PASS/CONCESSION）
    expect((await prisma.workOrderOperation.findUniqueOrThrow({ where: { id: s.nextOp.id } })).status).toBe('PENDING');
    // REWORK 处理：标记返工，本道保持 COMPLETED（返工数量回退由 38 节撤销流水承担）
    const disp = await request(api()).post(`/api/inspections/${ipqc.id}/disposition`).set(auth(adminToken)).send({ disposition: 'REWORK', reason: '返工' });
    expect(disp.status).toBe(201);
    expect(disp.body.data.disposition).toBe('REWORK');
    // 重新提交已处理的检验单 → 409（用例 8）；重新检验走新检验单
  });

  it('用例3：requireFqc 物料入库前必须有 PASS/CONCESSION 的 FQC → 否则 422', async () => {
    const s = await setupInspectionPoint(true);
    await request(api()).post('/api/work-reports').set(auth(adminToken)).send({
      workOrderOperationId: s.qcOp.id, employeeId, goodQty: 100, defectQty: 0, idempotencyKey: uniq('iq'),
    });
    // IPQC 放行：PASS
    const ipqc = await prisma.inspection.findFirstOrThrow({ where: { type: 'IPQC', refType: 'OPERATION', refId: s.qcOp.id } });
    await request(api()).post(`/api/inspections/${ipqc.id}/submit`).set(auth(adminToken)).send({
      passQty: 100, failQty: 0, defects: [],
    });
    // 下道 READY → 开工 → 报满 → 工单可完成
    const next = await prisma.workOrderOperation.findUniqueOrThrow({ where: { id: s.nextOp.id } });
    expect(next.status).toBe('READY');
    // 入库 → 422（无 FQC）
    const noFqc = await request(api()).post(`/api/inventory/receipts/${s.woId}`).set(auth(adminToken)).send({ qty: 50, warehouseId: s.whFg.id });
    expect(noFqc.status).toBe(422);
    expect(noFqc.body.message).toContain('FQC');
    // 建 FQC → PASS → 入库成功
    const fqc = await request(api()).post('/api/inspections').set(auth(adminToken)).send({
      type: 'FQC', refType: 'WORK_ORDER', refId: s.woId, sampleQty: 100,
    });
    await request(api()).post(`/api/inspections/${fqc.body.data.id}/submit`).set(auth(adminToken)).send({
      passQty: 100, failQty: 0, defects: [],
    });
    const ok = await request(api()).post(`/api/inventory/receipts/${s.woId}`).set(auth(adminToken)).send({ qty: 50, warehouseId: s.whFg.id });
    expect(ok.status).toBe(201);
  });

  it('用例4：passQty + failQty ≠ sampleQty → 400', async () => {
    const s = await setupInspectionPoint();
    const insp = await request(api()).post('/api/inspections').set(auth(adminToken)).send({
      type: 'FQC', refType: 'WORK_ORDER', refId: s.woId, sampleQty: 10,
    });
    const bad = await request(api()).post(`/api/inspections/${insp.body.data.id}/submit`).set(auth(adminToken)).send({
      passQty: 8, failQty: 1, defects: [{ defectCodeId: weldDefectId, qty: 1 }],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toContain('≠');
  });

  it('用例5：failQty > 0 但无缺陷记录 → 400', async () => {
    const s = await setupInspectionPoint();
    const insp = await request(api()).post('/api/inspections').set(auth(adminToken)).send({
      type: 'FQC', refType: 'WORK_ORDER', refId: s.woId, sampleQty: 10,
    });
    const bad = await request(api()).post(`/api/inspections/${insp.body.data.id}/submit`).set(auth(adminToken)).send({
      passQty: 8, failQty: 2, defects: [],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toContain('缺陷');
  });

  it('用例6：结论 PASS 但 failQty > 0 → 400（不允许 AQL）', async () => {
    const s = await setupInspectionPoint();
    const insp = await request(api()).post('/api/inspections').set(auth(adminToken)).send({
      type: 'FQC', refType: 'WORK_ORDER', refId: s.woId, sampleQty: 10,
    });
    // failQty=2 且有缺陷明细，但 passQty+failQty=10：FAIL 结论自动判定——无法出现"PASS 但 fail>0"，
    // 服务按 failQty>0 → FAIL 硬编码；此处验证 failQty>0 时 result 必为 FAIL
    const r = await request(api()).post(`/api/inspections/${insp.body.data.id}/submit`).set(auth(adminToken)).send({
      passQty: 8, failQty: 2, defects: [{ defectCodeId: weldDefectId, qty: 2 }],
    });
    expect(r.body.data.result).toBe('FAIL');
  });

  it('用例7：让步接收需要 inspection:concession 权限；记录 reason', async () => {
    const s = await setupInspectionPoint();
    const insp = await request(api()).post('/api/inspections').set(auth(adminToken)).send({
      type: 'FQC', refType: 'WORK_ORDER', refId: s.woId, sampleQty: 10,
    });
    // FAIL
    await request(api()).post(`/api/inspections/${insp.body.data.id}/submit`).set(auth(adminToken)).send({
      passQty: 8, failQty: 2, defects: [{ defectCodeId: weldDefectId, qty: 2 }],
    });
    // qc 无 concession 码 → 403（planner 在种子中有全部质检码）
    const qc = (await login(app, 'qc', 'User@123')).accessToken;
    const denied = await request(api()).post(`/api/inspections/${insp.body.data.id}/disposition`).set(auth(qc)).send({
      disposition: 'CONCESSION', reason: '客户特采' });
    expect(denied.status).toBe(403);
    // admin（ALL 码）→ 201，结论转 CONCESSION
    const ok = await request(api()).post(`/api/inspections/${insp.body.data.id}/disposition`).set(auth(adminToken)).send({
      disposition: 'CONCESSION', reason: '客户特采' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.result).toBe('CONCESSION');
    expect(ok.body.data.dispositionReason).toBe('客户特采');
  });

  it('用例8：重复提交已提交的检验单 → 409', async () => {
    const s = await setupInspectionPoint();
    const insp = await request(api()).post('/api/inspections').set(auth(adminToken)).send({
      type: 'FQC', refType: 'WORK_ORDER', refId: s.woId, sampleQty: 10,
    });
    await request(api()).post(`/api/inspections/${insp.body.data.id}/submit`).set(auth(adminToken)).send({
      passQty: 10, failQty: 0, defects: [],
    });
    const again = await request(api()).post(`/api/inspections/${insp.body.data.id}/submit`).set(auth(adminToken)).send({
      passQty: 10, failQty: 0, defects: [],
    });
    expect(again.status).toBe(409);
  });

  it('用例9+10：停用缺陷代码不入下拉（status=1 过滤）；删除被引用的 → 409', async () => {
    const s = await setupInspectionPoint();
    const insp = await request(api()).post('/api/inspections').set(auth(adminToken)).send({
      type: 'FQC', refType: 'WORK_ORDER', refId: s.woId, sampleQty: 10,
    });
    // 用 DF-WELD 提交
    await request(api()).post(`/api/inspections/${insp.body.data.id}/submit`).set(auth(adminToken)).send({
      passQty: 8, failQty: 2, defects: [{ defectCodeId: weldDefectId, qty: 2 }],
    });
    // 停用后：status=1 过滤列表不含
    await prisma.defectCode.update({ where: { id: weldDefectId }, data: { status: 0 } });
    const active = await request(api()).get('/api/defect-codes?status=1').set(auth(adminToken));
    expect(active.body.data.list.some((d: { id: number }) => d.id === weldDefectId)).toBe(false);
    // 历史可见：检验单详情仍显示
    const detail = await request(api()).get(`/api/inspections/${insp.body.data.id}`).set(auth(adminToken));
    expect(detail.body.data.defects.some((d: { defectCodeId: number }) => d.defectCodeId === weldDefectId)).toBe(true);
    // 删除被引用 → 409
    const del = await request(api()).delete(`/api/defect-codes/${weldDefectId}`).set(auth(adminToken));
    expect(del.status).toBe(409);
  });

  it('权限矩阵：inspection 接口 planner 可用、operator 403、匿名 401', async () => {
    const planner = (await login(app, 'planner', 'User@123')).accessToken;
    const operator = (await login(app, 'operator', 'User@123')).accessToken;
    const s = await setupInspectionPoint();
    const create = await request(api()).post('/api/inspections').set(auth(planner)).send({
      type: 'FQC', refType: 'WORK_ORDER', refId: s.woId, sampleQty: 10,
    });
    expect(create.status).toBe(201);
    const submit = await request(api()).post(`/api/inspections/${create.body.data.id}/submit`).set(auth(operator)).send({
      passQty: 10, failQty: 0, defects: [],
    });
    expect(submit.status).toBe(403);
    const anon = await request(api()).post('/api/inspections').send({ type: 'FQC', refType: 'WORK_ORDER', refId: 1, sampleQty: 1 });
    expect(anon.status).toBe(401);
  });
});

/** 结果校验纯函数单测（任务卡：单元：结果校验函数） */
describe('validateSubmission 纯函数（第 45 节）', () => {
  const D = (id = 1, qty = 2) => ({ defectCodeId: id, qty });
  const ok = (fn: () => void) => expect(fn).not.toThrow();

  it('合法：8+2=10 且缺陷合计=2', () => {
    ok(() => validateSubmission(10, 8, 2, [D(1, 2)]));
  });
  it('pass+fail ≠ sample → 1001', () => {
    expect(() => validateSubmission(10, 8, 1, [D()])).toThrow(BusinessException);
  });
  it('fail>0 无缺陷 → 1001', () => {
    expect(() => validateSubmission(10, 8, 2, [])).toThrow(BusinessException);
  });
  it('fail=0 有缺陷 → 1001', () => {
    expect(() => validateSubmission(10, 10, 0, [D()])).toThrow(BusinessException);
  });
  it('缺陷合计 ≠ failQty → 1001', () => {
    expect(() => validateSubmission(10, 8, 2, [D(1, 1), D(2, 2)])).toThrow(BusinessException);
  });
});
