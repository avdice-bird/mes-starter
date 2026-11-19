/** M4（第 54 节）：3 个报表数值与标准答案一致；WebSocket 推送可达；安灯流转；检验不合格阻止入库。
 *  前置：npm run seed + npx ts-node scripts/m4-fixture.ts（标准答案见 docs/reports-reconcile.md）。
 */
import { io } from 'socket.io-client';

let seq = 0;
const uniq = (p) => `${p}${Date.now().toString(36)}${(seq += 1).toString(36)}`;

/** 从 localStorage/环境取 socket token：verify 只走 HTTP，所以先 HTTP 登录拿 access token */
export default [
  { name: '登录', async run(c) {
    await c.login('admin', 'Admin@123');
  } },

  { name: '报表数值与标准答案一致（fixture 对账）', async run(c) {
    const today = new Date().toISOString().slice(0, 10);
    const qs = `from=${today}&to=${today}`;

    // A 进度 95%
    const prog = await c.call('GET', `/reports/work-order-progress?${qs}`, { token: c.tokens.admin });
    c.expect(prog.status === 200, '进度接口失败');
    const a = (prog.body.data ?? []).find((r) => r.code.startsWith('M4-WO-A'));
    c.expect(!!a, `找不到对账工单 A（先跑 m4-fixture）`);
    c.expect(a.completedQty === 95 && a.progressPct === 95, `A 进度应为 95%，实际 ${a.completedQty}/${a.progressPct}`);

    // 早班良率 84.2%（80/95）
    const yd = await c.call('GET', `/reports/yield?${qs}&groupBy=shift`, { token: c.tokens.admin });
    const early = (yd.body.data ?? []).find((r) => r.label === '早班');
    c.expect(!!early, '找不到早班行');
    c.expect(early.goodQty === 80 && early.defectQty === 15 && early.yieldRate === 84.2,
      `早班应为 80/15 → 84.2%，实际 ${early.goodQty}/${early.defectQty} → ${early.yieldRate}`);

    // 缺陷 TOP1 = 划伤 10
    const top = await c.call('GET', `/reports/yield/defect-top?${qs}`, { token: c.tokens.admin });
    c.expect(top.body.data?.[0]?.qty === 10, `缺陷 TOP1 应 10 件，实际 ${JSON.stringify(top.body.data?.[0])}`);

    // E1 可用率 87.5 / 良率 95 / OEE 94.0
    const oee = await c.call('GET', `/reports/oee?${qs}`, { token: c.tokens.admin });
    const e1 = (oee.body.data ?? []).find((r) => r.equipmentCode === 'EQ-SMT-01');
    c.expect(!!e1, '找不到 EQ-SMT-01');
    c.expect(e1.availability === 87.5 && e1.yieldRate === 95 && e1.oee === 94,
      `E1 应 87.5/95/94，实际 ${e1.availability}/${e1.yieldRate}/${e1.oee}`);
  } },

  { name: 'WebSocket 推送可达（报工 → /board 收到 work-report.created）', async run(c) {
    // 找进行中且有余量的工序，员工须在该工序派工班组内（第 38 节一致性校验）
    const wos = await c.call('GET', '/work-orders?status=IN_PROGRESS&pageSize=20', { token: c.tokens.admin });
    let opId = null;
    let employeeId = null;
    for (const wo of wos.body.data.list) {
      const ops = await c.call('GET', `/work-order-operations/work-order/${wo.id}`, { token: c.tokens.admin });
      const open = (ops.body.data ?? []).find((o) => o.status === 'IN_PROGRESS' && o.plannedQty - o.completedQty >= 1);
      if (!open) continue;
      if (open.teamId) {
        const emps = await c.call('GET', `/employees?pageSize=5&teamId=${open.teamId}`, { token: c.tokens.admin });
        const emp = (emps.body.data?.list ?? []).find((e) => e.status === 'ACTIVE');
        if (!emp) continue;
        opId = open.id; employeeId = emp.id; break;
      } else {
        const emps = await c.call('GET', '/employees?pageSize=1', { token: c.tokens.admin });
        opId = open.id; employeeId = emps.body.data.list[0].id; break;
      }
    }
    c.expect(opId !== null, '无进行中且有余量、可配到班组员工的工序');

    // 连 /board（token 走握手鉴权），收到事件后再报工
    const got = await new Promise((resolve) => {
      let socket = null;
      const timer = setTimeout(() => { resolve(false); socket?.disconnect(); }, 8000);
      // c.base 含 /api 前缀——socket 命名空间挂在服务根上，须剥掉
      const wsBase = c.base.replace(/\/api$/, '').replace(/^http/, 'ws');
      socket = io(`${wsBase}/board`, {
        path: '/board/socket.io', auth: { token: c.tokens.admin }, transports: ['websocket'], reconnection: false,
      });
      socket.on('connect', async () => {
        const rep = await c.call('POST', '/work-reports', { body: {
          workOrderOperationId: opId, employeeId, goodQty: 1, defectQty: 0,
          idempotencyKey: `m4-ws-${Date.now()}`,
        }, token: c.tokens.admin });
        if (rep.status !== 201) { clearTimeout(timer); resolve(false); socket.disconnect(); }
      });
      socket.on('work-report.created', () => { clearTimeout(timer); resolve(true); socket.disconnect(); });
      socket.on('connect_error', () => { clearTimeout(timer); resolve(false); });
    });
    c.expect(got === true, '报工后 8s 内未收到 work-report.created 推送');
  } },

  { name: '安灯 OPEN → RESPONDED → CLOSED', async run(c) {
    const wcs = await c.call('GET', '/work-centers?pageSize=1', { token: c.tokens.admin });
    const wcId = wcs.body.data.list[0].id;
    const created = await c.call('POST', '/andon-calls', { body: {
      type: 'OTHER', workCenterId: wcId, description: `M4 验收呼叫 ${uniq('')}` }, token: c.tokens.admin });
    c.expect(created.status === 201, '创建安灯失败');
    const id = created.body.data.id;

    const responded = await c.call('POST', `/andon-calls/${id}/respond`, { body: {}, token: c.tokens.admin });
    c.expect(responded.status === 201 && responded.body.data.status === 'RESPONDED', '响应失败');

    const closed = await c.call('POST', `/andon-calls/${id}/close`, { body: { resolution: 'M4 验收处理' }, token: c.tokens.admin });
    c.expect(closed.status === 201 && closed.body.data.status === 'CLOSED', '关闭失败');
  } },

  { name: '检验不合格阻止入库（422）', async run(c) {
    // fixture：工单 B 的物料 requireFqc=true 且 FQC 结论 FAIL → 完工入库应 422（2004）
    const wos = await c.call('GET', '/work-orders?pageSize=50', { token: c.tokens.admin });
    const woB = (wos.body.data.list ?? []).find((w) => w.code.startsWith('M4-WO-B'));
    c.expect(!!woB, '找不到对账工单 B（先跑 m4-fixture）');
    const whs = await c.call('GET', '/inventory/warehouses', { token: c.tokens.admin });
    const warehouses = Array.isArray(whs.body.data) ? whs.body.data : whs.body.data.list;
    const wh = warehouses.find((w) => w.code === 'WH-FG') ?? warehouses[0];
    const receipt = await c.call('POST', `/inventory/receipts/${woB.id}`, { body: {
      qty: 10, warehouseId: wh.id }, token: c.tokens.admin });
    c.expect(receipt.status === 422, `FQC 未合格入库应 422，实际 ${receipt.status} ${JSON.stringify(receipt.body).slice(0, 120)}`);
    c.expect(receipt.body.code === 2004, `应 2004（FQC 未就绪），实际 ${receipt.body.code}`);
  } },
];
