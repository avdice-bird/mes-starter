import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, resetDb, seedRbacForTest, login } from './helpers/app';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * 第 8 节【测】越权测试矩阵：[方法, 路径, 角色, 期望状态码] 表驱动。
 * 覆盖 auth / user / role / permission / menu 全部接口 × 5 个种子角色 × 未登录。
 * 以后每加一个接口，只需要往 cases 里加几行。期望值的判断口径：
 * - 公开接口（登录/健康检查）：任何角色都 200；
 * - 业务接口：admin 200/201，其他角色（含未登录）按 403/401 拦截；
 * - 删除类用例放在最后，避免影响前面的用例。
 */

type RoleName = 'admin' | 'planner' | 'operator' | 'qc' | 'maintainer';
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

describe('权限矩阵（每接口 × 每角色 × 未登录）', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let ctx: {
    plannerUserId: number; maintainerUserId: number; delUserId: number;
    plannerRoleId: number; operatorRoleId: number; qcRoleId: number; tempRoleId: number;
    userViewPermId: number; tmpMenuId: number; tempDictId: number; tempDictItemId: number;
    bomDraftId: number; bomActiveId: number; bomObsoleteId: number; bomRawId: number; mxMaterialId: number; rtMaterialId: number; rtDraftId: number; rtWcId: number;
  };
  let mxUnitId: number; let mxCatId: number; let mxMaterialId: number;
  let mxPoId: number; let mxDelPoId: number; let mxWoId: number; let mxWrOpId: number; let mxEmpId: number;
  let bomRawId: number; let bomDraftId: number; let bomActiveId: number; let bomObsoleteId: number;
  let rtMaterialId: number; let rtDraftId: number; let rtWcId: number;
  const tokens: Partial<Record<RoleName, string>> = {};

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await resetDb(prisma);
    await seedRbacForTest(prisma);

    // 固定夹具：一个待删角色（无用户）、一个待删用户、一个待删菜单
    await prisma.role.create({ data: { code: 'temp_role', name: '待删角色' } });
    await prisma.user.create({ data: { username: 'del-user', password: '$2a$10$abcdefghij', name: '待删用户' } });
    await prisma.menu.create({ data: { path: '/matrix-tmp', name: '临时菜单', sort: 99 } });
    await prisma.dict.create({ data: { code: 'temp_dict', name: '待删字典' } });
    // 物料夹具：分类/单位/物料各一（供 material 模块的矩阵行引用；自增 id 不假设为 1）
    const mxUnit = await prisma.unit.create({ data: { code: 'MX_PCS', name: '矩阵单位' } });
    const mxCat = await prisma.materialCategory.create({ data: { code: 'MX_CAT', name: '矩阵分类' } });
    const mxMaterial = await prisma.material.create({
      data: {
        code: 'MX-MAT', name: '矩阵物料', categoryId: mxCat.id, unitId: mxUnit.id, type: 'RAW',
      },
    });
    mxUnitId = mxUnit.id; mxCatId = mxCat.id; mxMaterialId = mxMaterial.id;

    // BOM 夹具：raw 物料 + 三个状态的 BOM（draft 可改可激活、active 拒删改、obsolete 可删）
    const bomRaw = await prisma.material.create({
      data: { code: 'MX-RAW', name: '矩阵原料', categoryId: mxCat.id, unitId: mxUnit.id, type: 'RAW' },
    });
    bomRawId = bomRaw.id;
    bomDraftId = (
      await prisma.bom.create({
        data: { materialId: bomRaw.id, version: 'draft', effectiveFrom: new Date('2026-01-01') },
      })
    ).id;
    bomActiveId = (
      await prisma.bom.create({
        data: { materialId: bomRaw.id, version: 'active', effectiveFrom: new Date('2026-01-01') },
      })
    ).id;
    bomObsoleteId = (
      await prisma.bom.create({
        data: { materialId: bomRaw.id, version: 'obsolete', effectiveFrom: new Date('2026-01-01'), status: 'OBSOLETE' },
      })
    ).id;

    tokens.admin = (await login(app, 'admin', 'Admin@123')).accessToken;
    tokens.planner = (await login(app, 'planner', 'User@123')).accessToken;
    tokens.operator = (await login(app, 'operator', 'User@123')).accessToken;
    tokens.qc = (await login(app, 'qc', 'User@123')).accessToken;
    tokens.maintainer = (await login(app, 'maintainer', 'User@123')).accessToken;

    const [plannerUser, maintainerUser, delUser] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { username: 'planner' } }),
      prisma.user.findUniqueOrThrow({ where: { username: 'maintainer' } }),
      prisma.user.findUniqueOrThrow({ where: { username: 'del-user' } }),
    ]);
    const [plannerRole, operatorRole, qcRole, tempRole] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { code: 'planner' } }),
      prisma.role.findUniqueOrThrow({ where: { code: 'operator' } }),
      prisma.role.findUniqueOrThrow({ where: { code: 'qc' } }),
      prisma.role.findUniqueOrThrow({ where: { code: 'temp_role' } }),
    ]);
    const perm = await prisma.permission.findUniqueOrThrow({ where: { code: 'user:view' } });
    const menu = await prisma.menu.findUniqueOrThrow({ where: { path: '/matrix-tmp' } });
    ctx = {
      plannerUserId: plannerUser.id, maintainerUserId: maintainerUser.id, delUserId: delUser.id,
      plannerRoleId: plannerRole.id, operatorRoleId: operatorRole.id, qcRoleId: qcRole.id,
      tempRoleId: tempRole.id, userViewPermId: perm.id, tmpMenuId: menu.id,
      tempDictId: (await prisma.dict.findUniqueOrThrow({ where: { code: 'temp_dict' } })).id,
      tempDictItemId: 0,
      bomDraftId: 0, bomActiveId: 0, bomObsoleteId: 0, bomRawId: 0, mxMaterialId: 0, rtMaterialId: 0, rtDraftId: 0, rtWcId: 0,
    };
    ctx.bomRawId = bomRawId;
    ctx.bomDraftId = bomDraftId;
    ctx.bomActiveId = bomActiveId;
    ctx.bomObsoleteId = bomObsoleteId;
    ctx.mxMaterialId = mxMaterialId;

    // routing 夹具：物料 + 工作中心 + DRAFT 路线
    const rtMaterial = await prisma.material.create({
      data: { code: 'MX-RT', name: '矩阵路线物料', categoryId: mxCat.id, unitId: mxUnit.id, type: 'FINISHED' },
    });
    rtMaterialId = rtMaterial.id;
    const rtWc = await prisma.workCenter.create({ data: { code: 'MX-WC', name: '矩阵工作中心' } });
    rtWcId = rtWc.id;
    rtDraftId = (await prisma.routing.create({ data: { materialId: rtMaterial.id, version: 'draft' } })).id;
    ctx.rtMaterialId = rtMaterialId;
    ctx.rtDraftId = rtDraftId;
    ctx.rtWcId = rtWcId;
    const item = await prisma.dictItem.create({
      data: { dictId: ctx.tempDictId, label: '矩阵项', value: 'MV' },
    });
    ctx.tempDictItemId = item.id;

    // schedule 夹具：DRAFT 生产订单（拆分/编辑行引用）+ 一张待删订单（删除行放最后）
    mxPoId = (
      await prisma.productionOrder.create({
        data: { code: 'MX-PO', materialId: rtMaterial.id, qty: 100, dueDate: new Date('2027-01-01') },
      })
    ).id;
    mxDelPoId = (
      await prisma.productionOrder.create({
        data: { code: 'MX-PO-DEL', materialId: rtMaterial.id, qty: 10, dueDate: new Date('2027-01-01') },
      })
    ).id;
    // 状态机夹具：独立物料（带 ACTIVE 路线，供 release 走通）下的 CREATED 工单。
    // 注意不能给 rtMaterial 加 ACTIVE 路线——矩阵 82 行依赖"MX-RT 无 ACTIVE 路线 → 404"。
    const smMaterial = await prisma.material.create({
      data: { code: 'MX-SM', name: '状态机物料', categoryId: mxCat.id, unitId: mxUnit.id, type: 'FINISHED' },
    });
    await prisma.routing.create({
      data: {
        materialId: smMaterial.id, version: 'mx-active', status: 'ACTIVE',
        operations: { create: [{ seq: 10, code: 'MX-OP1', name: '矩阵工序', workCenterId: rtWc.id, standardMinutes: 5 }] },
      },
    });
    mxWoId = (
      await prisma.workOrder.create({
        data: { code: 'MX-PO-W1', productionOrderId: mxPoId, materialId: smMaterial.id, qty: 100 },
      })
    ).id;
    // 报工夹具：已下达+开工的工单任务（work-reports 行用）
    const wrOrder = await prisma.productionOrder.create({
      data: { code: 'MX-PO-WR', materialId: smMaterial.id, qty: 100, dueDate: new Date('2027-01-01') },
    });
    const wrWo = await prisma.workOrder.create({
      data: { code: 'MX-PO-WR-W1', productionOrderId: wrOrder.id, materialId: smMaterial.id, qty: 100, status: 'IN_PROGRESS' },
    });
    mxWrOpId = (
      await prisma.workOrderOperation.create({
        data: { workOrderId: wrWo.id, seq: 10, operationCode: 'MX-OP1', operationName: '矩阵工序', workCenterId: rtWc.id, standardMinutes: 5, plannedQty: 100, status: 'IN_PROGRESS' },
      })
    ).id;
    const wrTeam = await prisma.team.create({ data: { code: 'MX-WR-T', name: '矩阵报工班', workCenterId: rtWc.id } });
    mxEmpId = (
      await prisma.employee.create({ data: { code: 'MX-WR-E', name: '矩阵报工工', teamId: wrTeam.id } })
    ).id;
  });
  afterAll(async () => { await app.close(); });

  const MATRIX_USER = { username: 'matrix_user', password: 'User@12345', name: '矩阵用户' };

  /** p 是展示用路径（标题里显示），url()/body() 都是运行期求值（ids 在 beforeAll 才知道） */
  const cases: { m: Method; p: string; url: () => string; role: RoleName | null; body?: () => Record<string, unknown>; want: number }[] = [
    // auth：登录/健康检查是公开接口；me 需要登录但不需要权限码
    { m: 'POST', p: '/api/auth/login', url: () => '/api/auth/login', role: null, body: () => ({ username: 'planner', password: 'User@123' }), want: 200 },
    { m: 'GET', p: '/api/health', url: () => '/api/health', role: null, want: 200 },
    ...(['admin', 'planner', 'operator', 'qc', 'maintainer'] as const).map((r) => (
      { m: 'GET' as Method, p: '/api/auth/me', url: () => '/api/auth/me', role: r as RoleName, want: 200 }
    )),
    { m: 'GET', p: '/api/auth/me', url: () => '/api/auth/me', role: null, want: 401 },

    // user
    { m: 'GET', p: '/api/users', url: () => '/api/users', role: 'admin', want: 200 },
    { m: 'GET', p: '/api/users', url: () => '/api/users', role: 'planner', want: 403 },
    { m: 'GET', p: '/api/users', url: () => '/api/users', role: 'operator', want: 403 },
    { m: 'GET', p: '/api/users', url: () => '/api/users', role: 'qc', want: 403 },
    { m: 'GET', p: '/api/users', url: () => '/api/users', role: 'maintainer', want: 403 },
    { m: 'GET', p: '/api/users', url: () => '/api/users', role: null, want: 401 },
    { m: 'GET', p: '/api/users/:id', url: () => `/api/users/${ctx.plannerUserId}`, role: 'admin', want: 200 },
    { m: 'GET', p: '/api/users/:id', url: () => `/api/users/${ctx.plannerUserId}`, role: 'operator', want: 403 },
    { m: 'GET', p: '/api/users/:id', url: () => `/api/users/${ctx.plannerUserId}`, role: null, want: 401 },
    { m: 'POST', p: '/api/users', url: () => '/api/users', role: 'admin', body: () => MATRIX_USER, want: 201 },
    { m: 'POST', p: '/api/users', url: () => '/api/users', role: 'planner', body: () => MATRIX_USER, want: 403 },
    { m: 'POST', p: '/api/users', url: () => '/api/users', role: null, body: () => MATRIX_USER, want: 401 },
    { m: 'PATCH', p: '/api/users/:id', url: () => `/api/users/${ctx.delUserId}`, role: 'admin', body: () => ({ name: '改名的待删用户' }), want: 200 },
    { m: 'PATCH', p: '/api/users/:id', url: () => `/api/users/${ctx.delUserId}`, role: 'maintainer', body: () => ({ name: '越权改名' }), want: 403 },
    { m: 'PUT', p: '/api/users/:id/roles', url: () => `/api/users/${ctx.plannerUserId}/roles`, role: 'admin', body: () => ({ roleIds: [ctx.plannerRoleId] }), want: 200 },
    { m: 'PUT', p: '/api/users/:id/roles', url: () => `/api/users/${ctx.plannerUserId}/roles`, role: 'qc', body: () => ({ roleIds: [ctx.plannerRoleId] }), want: 403 },

    // role
    { m: 'GET', p: '/api/roles', url: () => '/api/roles', role: 'admin', want: 200 },
    { m: 'GET', p: '/api/roles', url: () => '/api/roles', role: 'planner', want: 403 },
    { m: 'GET', p: '/api/roles', url: () => '/api/roles', role: null, want: 401 },
    { m: 'GET', p: '/api/roles/:id', url: () => `/api/roles/${ctx.plannerRoleId}`, role: 'admin', want: 200 },
    { m: 'GET', p: '/api/roles/:id', url: () => `/api/roles/${ctx.plannerRoleId}`, role: 'operator', want: 403 },
    { m: 'POST', p: '/api/roles', url: () => '/api/roles', role: 'admin', body: () => ({ code: 'matrix_role', name: '矩阵角色' }), want: 201 },
    { m: 'POST', p: '/api/roles', url: () => '/api/roles', role: 'operator', body: () => ({ code: 'matrix_role', name: '矩阵角色' }), want: 403 },
    { m: 'POST', p: '/api/roles', url: () => '/api/roles', role: null, body: () => ({ code: 'matrix_role', name: '矩阵角色' }), want: 401 },
    { m: 'PATCH', p: '/api/roles/:id', url: () => `/api/roles/${ctx.operatorRoleId}`, role: 'admin', body: () => ({ name: '操作工（矩阵）' }), want: 200 },
    { m: 'PATCH', p: '/api/roles/:id', url: () => `/api/roles/${ctx.operatorRoleId}`, role: 'planner', body: () => ({ name: '越权改名' }), want: 403 },
    { m: 'PUT', p: '/api/roles/:id/permissions', url: () => `/api/roles/${ctx.qcRoleId}/permissions`, role: 'admin', body: () => ({ permissionIds: [ctx.userViewPermId] }), want: 200 },
    { m: 'PUT', p: '/api/roles/:id/permissions', url: () => `/api/roles/${ctx.qcRoleId}/permissions`, role: 'maintainer', body: () => ({ permissionIds: [ctx.userViewPermId] }), want: 403 },

    // permission
    { m: 'GET', p: '/api/permissions', url: () => '/api/permissions', role: 'admin', want: 200 },
    { m: 'GET', p: '/api/permissions', url: () => '/api/permissions', role: 'qc', want: 403 },
    { m: 'GET', p: '/api/permissions', url: () => '/api/permissions', role: null, want: 401 },

    // dict：管理接口要求 dict:*；选项接口登录即可
    { m: 'GET', p: '/api/dicts', url: () => '/api/dicts', role: 'admin', want: 200 },
    { m: 'GET', p: '/api/dicts', url: () => '/api/dicts', role: 'planner', want: 403 },
    { m: 'GET', p: '/api/dicts', url: () => '/api/dicts', role: null, want: 401 },
    { m: 'POST', p: '/api/dicts', url: () => '/api/dicts', role: 'admin', body: () => ({ code: 'mx_dict', name: '矩阵字典' }), want: 201 },
    { m: 'POST', p: '/api/dicts', url: () => '/api/dicts', role: 'planner', body: () => ({ code: 'mx_dict2', name: 'x' }), want: 403 },
    { m: 'PATCH', p: '/api/dicts/:id', url: () => `/api/dicts/${ctx.tempDictId}`, role: 'admin', body: () => ({ name: '改名' }), want: 200 },
    { m: 'PATCH', p: '/api/dicts/:id', url: () => `/api/dicts/${ctx.tempDictId}`, role: 'operator', body: () => ({ name: 'x' }), want: 403 },
    { m: 'GET', p: '/api/dicts/:id/items', url: () => `/api/dicts/${ctx.tempDictId}/items`, role: 'admin', want: 200 },
    { m: 'POST', p: '/api/dicts/:id/items', url: () => `/api/dicts/${ctx.tempDictId}/items`, role: 'admin', body: () => ({ label: 'L', value: 'V' }), want: 201 },
    { m: 'POST', p: '/api/dicts/:id/items', url: () => `/api/dicts/${ctx.tempDictId}/items`, role: 'qc', body: () => ({ label: 'L', value: 'V2' }), want: 403 },
    { m: 'PUT', p: '/api/dicts/items/:itemId', url: () => `/api/dicts/items/${ctx.tempDictItemId}`, role: 'admin', body: () => ({ label: 'L2' }), want: 200 },
    { m: 'PUT', p: '/api/dicts/items/:itemId', url: () => `/api/dicts/items/${ctx.tempDictItemId}`, role: 'planner', body: () => ({ label: 'x' }), want: 403 },
    { m: 'DELETE', p: '/api/dicts/items/:itemId', url: () => `/api/dicts/items/${ctx.tempDictItemId}`, role: 'admin', want: 200 },
    { m: 'DELETE', p: '/api/dicts/:id', url: () => `/api/dicts/${ctx.tempDictId}`, role: 'admin', want: 409 }, // 前一行加了字典项：有项字典拒绝删除
    { m: 'DELETE', p: '/api/dicts/:id', url: () => `/api/dicts/${ctx.tempDictId}`, role: 'maintainer', want: 403 },
    { m: 'GET', p: '/api/dicts/code/:code/options', url: () => '/api/dicts/code/none/options', role: 'planner', want: 200 },
    { m: 'GET', p: '/api/dicts/code/:code/options', url: () => '/api/dicts/code/none/options', role: null, want: 401 },

    // bom
    { m: 'GET', p: '/api/boms', url: () => '/api/boms', role: 'admin', want: 200 },
    { m: 'GET', p: '/api/boms', url: () => '/api/boms', role: 'planner', want: 200 }, // planner 有全部 bom 码
    { m: 'GET', p: '/api/boms', url: () => '/api/boms', role: 'operator', want: 403 },
    { m: 'GET', p: '/api/boms', url: () => '/api/boms', role: null, want: 401 },
    { m: 'POST', p: '/api/boms', url: () => `/api/boms`, role: 'admin', body: () => ({ materialId: ctx.bomRawId, version: 'mx', effectiveFrom: '2026-01-01' }), want: 201 },
    { m: 'POST', p: '/api/boms', url: () => `/api/boms`, role: 'qc', body: () => ({ materialId: ctx.bomRawId, version: 'mx2', effectiveFrom: '2026-01-01' }), want: 403 },
    { m: 'PUT', p: '/api/boms/:id/items', url: () => `/api/boms/${ctx.bomDraftId}/items`, role: 'admin', body: () => ({ items: [{ childMaterialId: ctx.mxMaterialId, qty: 1, scrapRate: 0 }] }), want: 200 }, // 子件≠父物料
    { m: 'PUT', p: '/api/boms/:id/items', url: () => `/api/boms/${ctx.bomDraftId}/items`, role: 'maintainer', body: () => ({ items: [] }), want: 403 },
    { m: 'POST', p: '/api/boms/:id/activate', url: () => `/api/boms/${ctx.bomDraftId}/activate`, role: 'admin', want: 200 },
    { m: 'POST', p: '/api/boms/:id/activate', url: () => `/api/boms/${ctx.bomDraftId}/activate`, role: 'operator', want: 403 },
    { m: 'GET', p: '/api/boms/:id/tree', url: () => `/api/boms/${ctx.bomDraftId}/tree`, role: 'admin', want: 200 },
    { m: 'DELETE', p: '/api/boms/:id', url: () => `/api/boms/${ctx.bomObsoleteId}`, role: 'admin', want: 200 },
    // 矩阵 65 已把 draft 激活 → 同父物料的原 active 版本被自动置 OBSOLETE（激活策略），
    // 所以这里现在是"删一个 OBSOLETE"→ 200。真正拒删 ACTIVE 的行为由 bom.e2e 用例覆盖
    { m: 'DELETE', p: '/api/boms/:id', url: () => `/api/boms/${ctx.bomActiveId}`, role: 'admin', want: 200 },

    // routing / work-center / equipment
    { m: 'GET', p: '/api/routings', url: () => '/api/routings', role: 'admin', want: 200 },
    { m: 'GET', p: '/api/routings', url: () => '/api/routings', role: 'planner', want: 200 },
    { m: 'GET', p: '/api/routings', url: () => '/api/routings', role: 'operator', want: 403 },
    { m: 'GET', p: '/api/routings', url: () => '/api/routings', role: null, want: 401 },
    { m: 'POST', p: '/api/routings', url: () => '/api/routings', role: 'planner', body: () => ({ materialId: ctx.rtMaterialId, version: 'mx' }), want: 201 },
    { m: 'POST', p: '/api/routings', url: () => '/api/routings', role: 'qc', body: () => ({ materialId: ctx.rtMaterialId, version: 'mx2' }), want: 403 },
    { m: 'PUT', p: '/api/routings/:id/operations', url: () => `/api/routings/${ctx.rtDraftId}/operations`, role: 'admin', body: () => ({ operations: [{ seq: 10, code: 'OP10', name: 'x', workCenterId: ctx.rtWcId, standardMinutes: 5 }] }), want: 200 },
    { m: 'PUT', p: '/api/routings/:id/operations', url: () => `/api/routings/${ctx.rtDraftId}/operations`, role: 'maintainer', body: () => ({ operations: [] }), want: 403 },
    { m: 'GET', p: '/api/work-centers', url: () => '/api/work-centers', role: 'planner', want: 200 },
    { m: 'GET', p: '/api/work-centers', url: () => '/api/work-centers', role: 'operator', want: 200 }, // 安灯呼叫必填产线，operator 有 work-center:view
    { m: 'GET', p: '/api/equipments', url: () => '/api/equipments', role: 'maintainer', want: 200 },
    { m: 'GET', p: '/api/equipments', url: () => '/api/equipments', role: 'operator', want: 200 }, // 安灯呼叫默认设备类型，operator 有 equipment:view
    { m: 'GET', p: '/api/equipments', url: () => '/api/equipments', role: 'qc', want: 403 },
    { m: 'GET', p: '/api/materials/:id/active-routing', url: () => `/api/materials/${ctx.rtMaterialId}/active-routing`, role: 'planner', want: 404 }, // 无 ACTIVE 路线
    { m: 'GET', p: '/api/materials/:id/active-routing', url: () => `/api/materials/${ctx.rtMaterialId}/active-routing`, role: null, want: 401 },

    // shift / team / employee
    { m: 'GET', p: '/api/shifts', url: () => '/api/shifts', role: 'planner', want: 200 },
    { m: 'GET', p: '/api/shifts', url: () => '/api/shifts', role: 'operator', want: 403 },
    { m: 'GET', p: '/api/shifts', url: () => '/api/shifts', role: null, want: 401 },
    { m: 'POST', p: '/api/shifts', url: () => '/api/shifts', role: 'admin', body: () => ({ code: 'MX-SH', name: '矩阵班次', startTime: '05:00', endTime: '07:00' }), want: 201 },
    { m: 'POST', p: '/api/shifts', url: () => '/api/shifts', role: 'qc', body: () => ({ code: 'MX-SH2', name: 'x', startTime: '05:00', endTime: '07:00' }), want: 403 },
    { m: 'GET', p: '/api/teams', url: () => '/api/teams', role: 'planner', want: 200 },
    { m: 'GET', p: '/api/teams', url: () => '/api/teams', role: 'operator', want: 403 },
    { m: 'GET', p: '/api/employees', url: () => '/api/employees?status=ACTIVE', role: 'planner', want: 200 },
    { m: 'GET', p: '/api/employees', url: () => '/api/employees?status=ACTIVE', role: 'operator', want: 200 }, // 报工员工下拉需要 employee:view
    { m: 'GET', p: '/api/employees', url: () => '/api/employees?status=ACTIVE', role: null, want: 401 },

    // audit：只读模块，仅 audit:view
    { m: 'GET', p: '/api/audit-logs', url: () => '/api/audit-logs', role: 'admin', want: 200 },
    { m: 'GET', p: '/api/audit-logs', url: () => '/api/audit-logs', role: 'operator', want: 403 },
    { m: 'GET', p: '/api/audit-logs', url: () => '/api/audit-logs', role: null, want: 401 },

    // production-order / work-order / schedule（第 26-28 节）：planner 全权；operator 只读工单（第 37 节报工需要）
    { m: 'GET', p: '/api/production-orders', url: () => '/api/production-orders', role: 'planner', want: 200 },
    { m: 'GET', p: '/api/production-orders', url: () => '/api/production-orders', role: 'operator', want: 403 },
    { m: 'GET', p: '/api/production-orders', url: () => '/api/production-orders', role: null, want: 401 },
    { m: 'POST', p: '/api/production-orders', url: () => '/api/production-orders', role: 'planner', body: () => ({ code: 'MX-PO-NEW', materialId: ctx.rtMaterialId, qty: 10, dueDate: '2027-01-01' }), want: 201 },
    { m: 'POST', p: '/api/production-orders', url: () => '/api/production-orders', role: 'maintainer', body: () => ({ code: 'MX-PO-NEW2', materialId: ctx.rtMaterialId, qty: 10, dueDate: '2027-01-01' }), want: 403 },
    { m: 'PATCH', p: '/api/production-orders/:id', url: () => `/api/production-orders/${mxPoId}`, role: 'planner', body: () => ({ priority: 2 }), want: 200 },
    { m: 'PATCH', p: '/api/production-orders/:id', url: () => `/api/production-orders/${mxPoId}`, role: 'qc', body: () => ({ priority: 2 }), want: 403 },
    { m: 'POST', p: '/api/production-orders/:id/split', url: () => `/api/production-orders/${mxPoId}/split`, role: 'planner', body: () => ({ splits: [{ qty: 50 }, { qty: 50 }] }), want: 201 },
    { m: 'POST', p: '/api/production-orders/:id/split', url: () => `/api/production-orders/${mxPoId}/split`, role: 'operator', body: () => ({ splits: [{ qty: 1 }] }), want: 403 },
    { m: 'POST', p: '/api/schedule/run', url: () => '/api/schedule/run', role: 'planner', body: () => ({ from: '2026-10-12' }), want: 201 },
    { m: 'POST', p: '/api/schedule/run', url: () => '/api/schedule/run', role: 'qc', body: () => ({ from: '2026-10-12' }), want: 403 },
    { m: 'POST', p: '/api/schedule/run', url: () => '/api/schedule/run', role: null, body: () => ({ from: '2026-10-12' }), want: 401 },
    { m: 'GET', p: '/api/work-orders', url: () => '/api/work-orders', role: 'planner', want: 200 },
    { m: 'GET', p: '/api/work-orders', url: () => '/api/work-orders', role: 'operator', want: 200 }, // 扫码报工需要工单只读
    { m: 'GET', p: '/api/work-orders', url: () => '/api/work-orders', role: 'maintainer', want: 403 },
    { m: 'GET', p: '/api/schedule', url: () => '/api/schedule', role: 'planner', want: 200 },
    { m: 'GET', p: '/api/schedule', url: () => '/api/schedule', role: 'operator', want: 200 }, // 排产视图复用 work-order:view，operator 只读

    // work-order 状态机动作（第 30-32 节）：7 个动作 × 角色。
    // 口径：planner 有权限 → 按 CREATED 状态给 201（release 真实成功）/ 409（非法转换 1006）/ 400（缺 reason）；
    // operator/qc/maintainer/匿名 → 403/401（权限防线在状态机之前）。
    { m: 'POST', p: '/api/work-orders/:id/release', url: () => `/api/work-orders/${mxWoId}/release`, role: 'planner', want: 201 },
    { m: 'POST', p: '/api/work-orders/:id/release', url: () => `/api/work-orders/${mxWoId}/release`, role: 'operator', want: 403 },
    { m: 'POST', p: '/api/work-orders/:id/release', url: () => `/api/work-orders/${mxWoId}/release`, role: null, want: 401 },
    { m: 'POST', p: '/api/work-orders/:id/start', url: () => `/api/work-orders/${mxWoId}/start`, role: 'planner', want: 201 },
    { m: 'POST', p: '/api/work-orders/:id/start', url: () => `/api/work-orders/${mxWoId}/start`, role: 'operator', want: 403 },
    { m: 'POST', p: '/api/work-orders/:id/pause', url: () => `/api/work-orders/${mxWoId}/pause`, role: 'planner', want: 201 },
    { m: 'POST', p: '/api/work-orders/:id/pause', url: () => `/api/work-orders/${mxWoId}/pause`, role: 'maintainer', want: 403 },
    { m: 'POST', p: '/api/work-orders/:id/resume', url: () => `/api/work-orders/${mxWoId}/resume`, role: 'planner', want: 201 },
    { m: 'POST', p: '/api/work-orders/:id/resume', url: () => `/api/work-orders/${mxWoId}/resume`, role: 'qc', want: 403 },
    { m: 'POST', p: '/api/work-orders/:id/complete', url: () => `/api/work-orders/${mxWoId}/complete`, role: 'planner', want: 400 }, // 部分完工缺 reason
    { m: 'POST', p: '/api/work-orders/:id/complete', url: () => `/api/work-orders/${mxWoId}/complete`, role: 'operator', want: 403 },
    { m: 'POST', p: '/api/work-orders/:id/close', url: () => `/api/work-orders/${mxWoId}/close`, role: 'planner', want: 409 }, // IN_PROGRESS 不能直接关（1006）
    { m: 'POST', p: '/api/work-orders/:id/close', url: () => `/api/work-orders/${mxWoId}/close`, role: 'maintainer', want: 403 },
    { m: 'POST', p: '/api/work-orders/:id/cancel', url: () => `/api/work-orders/${mxWoId}/cancel`, role: 'planner', body: () => ({}), want: 400 }, // 缺 reason
    { m: 'POST', p: '/api/work-orders/:id/cancel', url: () => `/api/work-orders/${mxWoId}/cancel`, role: 'operator', body: () => ({ reason: 'x' }), want: 403 },
    { m: 'POST', p: '/api/work-orders/:id/cancel', url: () => `/api/work-orders/${mxWoId}/cancel`, role: null, body: () => ({ reason: 'x' }), want: 401 },

    // work-report（第 37-39 节）：operator 可报工（车间高频操作）；qc 可看；匿名 401
    { m: 'POST', p: '/api/work-reports', url: () => '/api/work-reports', role: 'operator', body: () => ({ workOrderOperationId: mxWrOpId, employeeId: mxEmpId, goodQty: 1, defectQty: 0, idempotencyKey: 'mx-op-key-1' }), want: 201 },
    { m: 'POST', p: '/api/work-reports', url: () => '/api/work-reports', role: 'planner', body: () => ({ workOrderOperationId: mxWrOpId, employeeId: mxEmpId, goodQty: 1, defectQty: 0, idempotencyKey: 'mx-pl-key-1' }), want: 201 },
    { m: 'POST', p: '/api/work-reports', url: () => '/api/work-reports', role: 'planner', body: () => ({ workOrderOperationId: mxWrOpId, employeeId: mxEmpId, goodQty: 1, defectQty: 0, idempotencyKey: 'mx-pl-key-1' }), want: 201 }, // 幂等重放
    { m: 'POST', p: '/api/work-reports', url: () => '/api/work-reports', role: null, body: () => ({ workOrderOperationId: mxWrOpId, employeeId: mxEmpId, goodQty: 1, defectQty: 0, idempotencyKey: 'mx-an-key-1' }), want: 401 },
    { m: 'GET', p: '/api/work-reports/work-order/:id', url: () => `/api/work-reports/work-order/${mxWoId}`, role: 'planner', want: 200 },
    { m: 'GET', p: '/api/work-reports/work-order/:id', url: () => `/api/work-reports/work-order/${mxWoId}`, role: 'operator', want: 200 },
    { m: 'GET', p: '/api/work-orders/:id/qrcode', url: () => `/api/work-orders/${mxWoId}/qrcode`, role: 'planner', want: 200 },
    { m: 'GET', p: '/api/work-orders/:id/qrcode', url: () => `/api/work-orders/${mxWoId}/qrcode`, role: 'operator', want: 200 },

    // material：planner 有 material:*/unit:view/category:*，operator/qc/maintainer 全拒
    // 分类树/单位列表：planner 有 view 权限
    { m: 'GET', p: '/api/material-categories', url: () => '/api/material-categories', role: 'planner', want: 200 },
    { m: 'GET', p: '/api/material-categories', url: () => '/api/material-categories', role: 'operator', want: 403 },
    { m: 'GET', p: '/api/material-categories', url: () => '/api/material-categories', role: null, want: 401 },
    { m: 'GET', p: '/api/units', url: () => '/api/units', role: 'planner', want: 200 },
    { m: 'GET', p: '/api/units', url: () => '/api/units', role: 'qc', want: 403 },
    { m: 'GET', p: '/api/units', url: () => '/api/units', role: null, want: 401 },
    // 物料列表/详情：planner 200，他人 403
    { m: 'GET', p: '/api/materials', url: () => '/api/materials', role: 'planner', want: 200 },
    { m: 'GET', p: '/api/materials', url: () => '/api/materials', role: 'operator', want: 403 },
    { m: 'GET', p: '/api/materials', url: () => '/api/materials', role: null, want: 401 },
    // 创建：planner 有 material:create
    { m: 'POST', p: '/api/materials', url: () => '/api/materials', role: 'planner', body: () => ({ code: 'MX-NEW', name: '矩阵新物料', categoryId: mxCatId, unitId: mxUnitId, type: 'RAW' }), want: 201 },
    { m: 'POST', p: '/api/materials', url: () => '/api/materials', role: 'maintainer', body: () => ({ code: 'MX-NEW2', name: '越权建物料', categoryId: mxCatId, unitId: mxUnitId, type: 'RAW' }), want: 403 },
    { m: 'POST', p: '/api/materials', url: () => '/api/materials', role: null, body: () => ({ code: 'MX-NEW3', name: 'x', categoryId: mxCatId, unitId: mxUnitId, type: 'RAW' }), want: 401 },
    // 编辑：planner 有 material:update
    { m: 'PATCH', p: '/api/materials/:id', url: () => `/api/materials/${mxMaterialId}`, role: 'planner', body: () => ({ name: '矩阵物料（改）' }), want: 200 },
    { m: 'PATCH', p: '/api/materials/:id', url: () => `/api/materials/${mxMaterialId}`, role: 'qc', body: () => ({ name: '越权改物料' }), want: 403 },
    // 导入/导出/模板：planner 有 import/export
    { m: 'POST', p: '/api/materials/import', url: () => '/api/materials/import', role: 'planner', want: 400 }, // 无文件 → 1001 参数校验
    { m: 'POST', p: '/api/materials/import', url: () => '/api/materials/import', role: 'operator', want: 403 },
    { m: 'POST', p: '/api/materials/import', url: () => '/api/materials/import', role: null, want: 401 },
    { m: 'GET', p: '/api/materials/import-template', url: () => '/api/materials/import-template', role: 'planner', want: 200 },
    { m: 'GET', p: '/api/materials/import-template', url: () => '/api/materials/import-template', role: 'maintainer', want: 403 },
    { m: 'GET', p: '/api/materials/export', url: () => '/api/materials/export', role: 'planner', want: 200 },
    { m: 'GET', p: '/api/materials/export', url: () => '/api/materials/export', role: 'qc', want: 403 },
    // 单位：planner 只有 unit:view（维护单位是管理员的事），无 create/update
    { m: 'POST', p: '/api/units', url: () => '/api/units', role: 'planner', body: () => ({ code: 'MX_U2', name: '矩阵单位2' }), want: 403 },
    { m: 'POST', p: '/api/units', url: () => '/api/units', role: 'operator', body: () => ({ code: 'MX_U3', name: 'x' }), want: 403 },
    { m: 'PATCH', p: '/api/units/:id', url: () => `/api/units/${mxUnitId}`, role: 'admin', body: () => ({ name: '矩阵单位（改）' }), want: 200 },
    { m: 'PATCH', p: '/api/units/:id', url: () => `/api/units/${mxUnitId}`, role: 'planner', body: () => ({ name: 'x' }), want: 403 },
    // 分类：planner 有 category:create/update
    { m: 'POST', p: '/api/material-categories', url: () => '/api/material-categories', role: 'planner', body: () => ({ code: 'MX_C2', name: '矩阵分类2' }), want: 201 },
    { m: 'POST', p: '/api/material-categories', url: () => '/api/material-categories', role: 'maintainer', body: () => ({ code: 'MX_C3', name: 'x' }), want: 403 },
    { m: 'PATCH', p: '/api/material-categories/:id', url: () => `/api/material-categories/${mxCatId}`, role: 'planner', body: () => ({ name: '矩阵分类（改）' }), want: 200 },
    { m: 'PATCH', p: '/api/material-categories/:id', url: () => `/api/material-categories/${mxCatId}`, role: 'operator', body: () => ({ name: 'x' }), want: 403 },

    // menu
    { m: 'GET', p: '/api/menus', url: () => '/api/menus', role: 'admin', want: 200 },
    { m: 'GET', p: '/api/menus', url: () => '/api/menus', role: 'maintainer', want: 403 },
    { m: 'GET', p: '/api/menus', url: () => '/api/menus', role: null, want: 401 },
    { m: 'POST', p: '/api/menus', url: () => '/api/menus', role: 'admin', body: () => ({ path: '/matrix-tmp2', name: '临时菜单2' }), want: 201 },
    { m: 'POST', p: '/api/menus', url: () => '/api/menus', role: 'planner', body: () => ({ path: '/matrix-tmp3', name: '越权建菜单' }), want: 403 },
    { m: 'PATCH', p: '/api/menus/:id', url: () => `/api/menus/${ctx.tmpMenuId}`, role: 'admin', body: () => ({ name: '临时菜单（矩阵）' }), want: 200 },
    { m: 'PATCH', p: '/api/menus/:id', url: () => `/api/menus/${ctx.tmpMenuId}`, role: 'operator', body: () => ({ name: '越权改菜单' }), want: 403 },

    // 删除类放最后
    { m: 'DELETE', p: '/api/production-orders/:id', url: () => `/api/production-orders/${mxDelPoId}`, role: 'admin', want: 200 },
    { m: 'DELETE', p: '/api/production-orders/:id', url: () => `/api/production-orders/${mxDelPoId}`, role: 'qc', want: 403 },
    { m: 'DELETE', p: '/api/production-orders/:id', url: () => `/api/production-orders/${mxDelPoId}`, role: null, want: 401 },
    { m: 'DELETE', p: '/api/users/:id', url: () => `/api/users/${ctx.delUserId}`, role: 'admin', want: 200 },
    { m: 'DELETE', p: '/api/users/:id', url: () => `/api/users/${ctx.delUserId}`, role: 'planner', want: 403 },
    { m: 'DELETE', p: '/api/users/:id', url: () => `/api/users/${ctx.delUserId}`, role: null, want: 401 },
    { m: 'DELETE', p: '/api/roles/:id', url: () => `/api/roles/${ctx.tempRoleId}`, role: 'admin', want: 200 },
    { m: 'DELETE', p: '/api/roles/:id', url: () => `/api/roles/${ctx.tempRoleId}`, role: 'qc', want: 403 },
    { m: 'DELETE', p: '/api/roles/:id', url: () => `/api/roles/${ctx.tempRoleId}`, role: null, want: 401 },
    { m: 'DELETE', p: '/api/menus/:id', url: () => `/api/menus/${ctx.tmpMenuId}`, role: 'admin', want: 200 },
    { m: 'DELETE', p: '/api/menus/:id', url: () => `/api/menus/${ctx.tmpMenuId}`, role: 'maintainer', want: 403 },
  ];

  let i = 0;
  for (const c of cases) {
    i += 1;
    it(`矩阵 ${String(i).padStart(2, '0')}  ${c.m} ${c.p} as ${c.role ?? '匿名'} → ${c.want}`, async () => {
      const req = request(app.getHttpServer())[c.m.toLowerCase() as Lowercase<Method>](c.url());
      if (c.role && tokens[c.role]) req.set('Authorization', `Bearer ${tokens[c.role]}`);
      if (c.body) req.send(c.body());
      const res = await req;
      expect(res.status).toBe(c.want);
    });
  }
});
