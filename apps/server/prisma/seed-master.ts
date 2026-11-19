/**
 * 主数据种子（第 22 节 M2 对齐）：数量必须与验收一致——
 * 物料 200、BOM 20、工艺路线 10、设备 12、工作中心 4、用户 5（用户在 seed-rbac）。
 * 幂等：全部 upsert / findFirst-or-create，可反复执行，数据不翻倍。
 */
import type { PrismaClient } from '@prisma/client';

export async function seedMasterData(prisma: PrismaClient) {
  // ---- 工作中心 4：SMT / 插件 / 组装 / 包装 ----
  const wcDefs = [
    { code: 'WC-SMT', name: 'SMT 车间', type: 'LINE', dailyCapacity: 20000 },
    { code: 'WC-TH', name: '插件车间', type: 'LINE', dailyCapacity: 8000 },
    { code: 'WC-ASM', name: '组装车间', type: 'LINE', dailyCapacity: 5000 },
    { code: 'WC-PKG', name: '包装工位', type: 'CELL', dailyCapacity: 6000 },
  ];
  const wcIds: Record<string, number> = {};
  for (const wc of wcDefs) {
    const row = await prisma.workCenter.upsert({
      where: { code: wc.code },
      update: { name: wc.name, type: wc.type, dailyCapacity: wc.dailyCapacity },
      create: wc,
    });
    wcIds[wc.code] = row.id;
  }

  // ---- 设备 12：SMT×4 / 插件×3 / 组装×3 / 包装×2 ----
  const eqDefs = [
    ['EQ-SMT-01', '贴片机 1 号', 'WC-SMT', 'YSM20'],
    ['EQ-SMT-02', '贴片机 2 号', 'WC-SMT', 'YSM20'],
    ['EQ-SMT-03', '回流焊炉', 'WC-SMT', 'RF-07'],
    ['EQ-SMT-04', 'AOI 检测仪', 'WC-SMT', 'AOI-3'],
    ['EQ-TH-01', '插件线 1', 'WC-TH', 'INL-1'],
    ['EQ-TH-02', '波峰焊', 'WC-TH', 'WS-2'],
    ['EQ-TH-03', '剪脚机', 'WC-TH', 'CL-1'],
    ['EQ-ASM-01', '组装台 1', 'WC-ASM', 'ASM-T'],
    ['EQ-ASM-02', '组装台 2', 'WC-ASM', 'ASM-T'],
    ['EQ-ASM-03', '老化房', 'WC-ASM', 'BURN-1'],
    ['EQ-PKG-01', '包装机 1', 'WC-PKG', 'PKG-A'],
    ['EQ-PKG-02', '贴标机', 'WC-PKG', 'LBL-1'],
  ] as const;
  for (const [code, name, wcCode, model] of eqDefs) {
    await prisma.equipment.upsert({
      where: { code },
      update: { name, model, workCenterId: wcIds[wcCode] },
      create: { code, name, model, workCenterId: wcIds[wcCode] },
    });
  }

  // ---- 物料 200：分类 4 + 单位 2；编码 M00001–M00200（成品 20 / 半成品 40 / 原料 140） ----
  const unitPcs = await prisma.unit.upsert({ where: { code: 'SEED-PCS' }, update: {}, create: { code: 'SEED-PCS', name: '个' } });
  const unitM = await prisma.unit.upsert({ where: { code: 'SEED-M' }, update: {}, create: { code: 'SEED-M', name: '米' } });
  const catElec = await prisma.materialCategory.upsert({ where: { code: 'SEED-ELEC' }, update: {}, create: { code: 'SEED-ELEC', name: '电子料', isDeleted: false } });
  const catPack = await prisma.materialCategory.upsert({ where: { code: 'SEED-PACK' }, update: {}, create: { code: 'SEED-PACK', name: '包材', isDeleted: false } });

  const materialIds: number[] = [];
  for (let i = 1; i <= 200; i++) {
    const code = `M${String(i).padStart(5, '0')}`;
    // 编号规则：1-20 成品（前缀 IC-），21-60 半成品（PCB-），61-200 原料（RAW-/BOX-）
    let prefix: string; let type: string; let catId: number; let unitId: number;
    if (i <= 20) { prefix = 'IC-'; type = 'FINISHED'; catId = catElec.id; unitId = unitPcs.id; }
    else if (i <= 60) { prefix = 'PCB-'; type = 'SEMI'; catId = catElec.id; unitId = unitPcs.id; }
    else if (i <= 180) { prefix = 'RAW-'; type = 'RAW'; catId = catElec.id; unitId = unitM.id; }
    else { prefix = 'BOX-'; type = 'RAW'; catId = catPack.id; unitId = unitPcs.id; }
    const m = await prisma.material.upsert({
      where: { code: prefix + code },
      update: {},
      create: { code: prefix + code, name: `种子物料${i}`, type, categoryId: catId, unitId },
    });
    materialIds.push(m.id);
  }

  // ---- BOM 20：每个成品（前 20 个物料）一个 ACTIVE v1，10 条明细（半成品/原料） ----
  for (let b = 0; b < 20; b++) {
    const parent = materialIds[b];
    const existing = await prisma.bom.findFirst({ where: { materialId: parent, version: 'v1' } });
    if (existing) continue; // 幂等
    await prisma.bom.create({
      data: {
        materialId: parent, version: 'v1', status: 'ACTIVE', effectiveFrom: new Date('2026-01-01'),
        items: {
          create: Array.from({ length: 10 }, (_, k) => ({
            // 明细取半成品与原料段，避免引用其他成品 BOM 造成深链（M2 展开答案可手算）
            childMaterialId: materialIds[20 + ((b * 10 + k) % 180)],
            qty: k + 1,
            scrapRate: k % 4 === 0 ? 300 : 0,
          })),
        },
      },
    });
  }

  // ---- 工艺路线 10：前 10 个成品各一条 ACTIVE v1，4 道工序走四个车间 ----
  for (let r = 0; r < 10; r++) {
    const parent = materialIds[r];
    const existing = await prisma.routing.findFirst({ where: { materialId: parent, version: 'v1' } });
    if (existing) continue;
    await prisma.routing.create({
      data: {
        materialId: parent, version: 'v1', status: 'ACTIVE', effectiveFrom: new Date('2026-01-01'),
        operations: {
          create: [
            { seq: 10, code: 'OP10', name: '贴片', workCenterId: wcIds['WC-SMT'], standardMinutes: 5 },
            { seq: 20, code: 'OP20', name: '插件', workCenterId: wcIds['WC-TH'], standardMinutes: 8 },
            { seq: 30, code: 'OP30', name: '组装', workCenterId: wcIds['WC-ASM'], standardMinutes: 12, isInspectionPoint: true },
            { seq: 40, code: 'OP40', name: '包装', workCenterId: wcIds['WC-PKG'], standardMinutes: 3 },
          ],
        },
      },
    });
  }

  // ---- 班次 3：早 08-16 / 中 16-24 / 晚 00-08（跨天） ----
  const shiftDefs = [
    { code: 'SH-EARLY', name: '早班', startTime: '08:00', endTime: '16:00', crossDay: false },
    { code: 'SH-MID', name: '中班', startTime: '16:00', endTime: '23:59', crossDay: false },
    { code: 'SH-NIGHT', name: '晚班', startTime: '00:00', endTime: '08:00', crossDay: true },
  ];
  for (const sh of shiftDefs) {
    await prisma.shift.upsert({ where: { code: sh.code }, update: {}, create: sh });
  }

  // ---- 班组 4：绑定四个工作中心 ----
  const teamDefs = [
    { code: 'TEAM-SMT', name: 'SMT 班组', wc: 'WC-SMT' },
    { code: 'TEAM-TH', name: '插件班组', wc: 'WC-TH' },
    { code: 'TEAM-ASM', name: '组装班组', wc: 'WC-ASM' },
    { code: 'TEAM-PKG', name: '包装班组', wc: 'WC-PKG' },
  ];
  const teamIds: Record<string, number> = {};
  for (const t of teamDefs) {
    const row = await prisma.team.upsert({
      where: { code: t.code }, update: {},
      create: { code: t.code, name: t.name, workCenterId: wcIds[t.wc] },
    });
    teamIds[t.code] = row.id;
  }

  // ---- 员工 30：EMP001-EMP030 轮流派 4 个班组 ----
  const teamCodes = ['TEAM-SMT', 'TEAM-TH', 'TEAM-ASM', 'TEAM-PKG'];
  const names = ['王', '李', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴'];
  for (let i = 1; i <= 30; i++) {
    const code = `EMP${String(i).padStart(3, '0')}`;
    const exists = await prisma.employee.findUnique({ where: { code } });
    if (exists) continue;
    await prisma.employee.create({
      data: {
        code, name: `${names[i % names.length]}工${i}`,
        teamId: teamIds[teamCodes[i % 4]],
      },
    });
  }

  console.log('seed-master: 工作中心 4、设备 12、物料 200、BOM 20、路线 10、班次 3、班组 4、员工 30');
}

/** 字典种子：工单状态（第 31 节用例 12：label 与颜色由前端按 value 映射，value 是正本） */
export async function seedDicts(prisma: PrismaClient) {
  const dict = await prisma.dict.upsert({
    where: { code: 'work_order_status' },
    update: {},
    create: { code: 'work_order_status', name: '工单状态', remark: '工单状态机状态字典（第 30 节）' },
  });
  const items: [string, string, number][] = [
    ['CREATED', '已创建', 1],
    ['RELEASED', '已下达', 2],
    ['IN_PROGRESS', '进行中', 3],
    ['PAUSED', '已暂停', 4],
    ['COMPLETED', '已完工', 5],
    ['CLOSED', '已关闭', 6],
    ['CANCELLED', '已取消', 7],
  ];
  for (const [value, label, sort] of items) {
    await prisma.dictItem.upsert({
      where: { dictId_value: { dictId: dict.id, value } },
      update: { label, sort },
      create: { dictId: dict.id, value, label, sort },
    });
  }
}


/** 库存种子（第 41 节）：原料仓/成品仓 + 原料期初批次（INIT 流水） */
export async function seedInventory(prisma: PrismaClient) {
  const whRaw = await prisma.warehouse.upsert({
    where: { code: 'WH-RAW' }, update: {},
    create: { code: 'WH-RAW', name: '原料仓' },
  });
  await prisma.warehouse.upsert({
    where: { code: 'WH-FG' }, update: {},
    create: { code: 'WH-FG', name: '成品仓' },
  });
  // 原料（RAW-/BOX- 前缀，即 61 号以后的种子物料）每种一个批次 10000，INIT 流水 + 余额
  const raws = await prisma.material.findMany({ where: { type: 'RAW' } });
  let seq = 0;
  for (const m of raws) {
    seq += 1;
    const lotNo = `${m.code}-INIT`;
    const lot = await prisma.lot.upsert({
      where: { lotNo },
      update: {},
      create: { lotNo, materialId: m.id, qty: 10000, sourceType: 'PURCHASE', producedAt: new Date('2026-01-01') },
    });
    const exists = await prisma.inventoryBalance.findFirst({ where: { warehouseId: whRaw.id, materialId: m.id, lotId: lot.id } });
    if (!exists) {
      await prisma.inventoryBalance.create({ data: { warehouseId: whRaw.id, materialId: m.id, lotId: lot.id, qty: 10000 } });
      await prisma.inventoryTransaction.create({
        data: { type: 'INIT', warehouseId: whRaw.id, materialId: m.id, lotId: lot.id, qty: 10000, refType: 'INIT', operatorName: 'seed', remark: '期初' },
      });
    }
  }
  void seq;
}

/** 缺陷代码种子（第 44 节）：15 个，5 类 × 3 严重度 */
export async function seedDefectCodes(prisma: PrismaClient) {
  const defs: [string, string, string, string][] = [
    ['DF-WELD', '焊接不良', '外观', 'MAJOR'],
    ['DF-SOLDER', '虚焊', '外观', 'CRITICAL'],
    ['DF-SCRATCH', '划伤', '外观', 'MINOR'],
    ['DF-DIRT', '脏污', '外观', 'MINOR'],
    ['DF-CRACK', '裂纹', '结构', 'CRITICAL'],
    ['DF-SHORT', '短路', '功能', 'CRITICAL'],
    ['DF-OPEN', '开路', '功能', 'CRITICAL'],
    ['DF-DRIFT', '参数漂移', '功能', 'MAJOR'],
    ['DF-DIM', '尺寸超差', '尺寸', 'MAJOR'],
    ['DF-HOLE', '孔位偏移', '尺寸', 'MAJOR'],
    ['DF-MISS', '漏装', '装配', 'CRITICAL'],
    ['DF-REVERSE', '反装', '装配', 'MAJOR'],
    ['DF-LOOSE', '松动', '装配', 'MAJOR'],
    ['DF-LABEL', '标签错误', '其他', 'MINOR'],
    ['DF-PACK', '包装破损', '其他', 'MINOR'],
  ];
  for (const [code, name, category, severity] of defs) {
    await prisma.defectCode.upsert({
      where: { code }, update: { name, category, severity },
      create: { code, name, category, severity },
    });
  }
}

/** 安灯字典种子（第 50 节）：andon_type 呼叫类型、andon_responder_role 责任角色映射、andon_timeout_minutes 超时升级 */
export async function seedAndonDicts(prisma: PrismaClient) {
  const typeDict = await prisma.dict.upsert({
    where: { code: 'andon_type' },
    update: {},
    create: { code: 'andon_type', name: '安灯呼叫类型', remark: '安灯呼叫类型（第 50 节）' },
  });
  const types: [string, string, number][] = [
    ['MATERIAL', '缺料', 1],
    ['EQUIPMENT', '设备异常', 2],
    ['QUALITY', '质量问题', 3],
    ['OTHER', '其他', 9],
  ];
  for (const [value, label, sort] of types) {
    await prisma.dictItem.upsert({
      where: { dictId_value: { dictId: typeDict.id, value } },
      update: { label, sort },
      create: { dictId: typeDict.id, value, label, sort },
    });
  }

  const roleDict = await prisma.dict.upsert({
    where: { code: 'andon_responder_role' },
    update: {},
    create: { code: 'andon_responder_role', name: '安灯责任角色', remark: '呼叫类型 → 责任角色 code（第 50 节）' },
  });
  const roleMap: [string, string, number][] = [
    ['MATERIAL', 'planner', 1],
    ['EQUIPMENT', 'maintainer', 2],
    ['QUALITY', 'qc', 3],
    ['OTHER', 'admin', 9],
  ];
  for (const [value, label, sort] of roleMap) {
    await prisma.dictItem.upsert({
      where: { dictId_value: { dictId: roleDict.id, value } },
      update: { label, sort },
      create: { dictId: roleDict.id, value, label, sort },
    });
  }

  const cfg = await prisma.dict.upsert({
    where: { code: 'andon_config' },
    update: {},
    create: { code: 'andon_config', name: '安灯配置', remark: '安灯参数（第 51 节）' },
  });
  await prisma.dictItem.upsert({
    where: { dictId_value: { dictId: cfg.id, value: 'andon_timeout_minutes' } },
    update: { label: '10' },
    create: { dictId: cfg.id, value: 'andon_timeout_minutes', label: '10', sort: 1 },
  });
}

/** 停机原因字典种子（第 46 节）：downtime_reason */
export async function seedDowntimeReasons(prisma: PrismaClient) {
  const dict = await prisma.dict.upsert({
    where: { code: 'downtime_reason' },
    update: {},
    create: { code: 'downtime_reason', name: '停机原因', remark: '设备停机原因代码（第 46 节）' },
  });
  const items: [string, string, number][] = [
    ['FAULT', '设备故障', 1],
    ['CHANGEOVER', '换型', 2],
    ['MAINTENANCE', '保养', 3],
    ['NO_MATERIAL', '待料', 4],
    ['NO_ORDER', '无订单', 5],
    ['OTHER', '其他', 9],
  ];
  for (const [value, label, sort] of items) {
    await prisma.dictItem.upsert({
      where: { dictId_value: { dictId: dict.id, value } },
      update: { label, sort },
      create: { dictId: dict.id, value, label, sort },
    });
  }
}
