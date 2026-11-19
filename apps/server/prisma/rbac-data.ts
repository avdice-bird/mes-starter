/**
 * RBAC 种子数据：权限码、角色、用户、菜单。
 * 单独成文件的原因：第 8 节的扫描测试要从这里导入权限码全集，
 * 断言所有 Controller @Permissions 里的码都在种子里（防止装饰器里写错码/漏码）。
 */

/** 权限码：[code, name, module]。以后每加业务模块就在这里加码。 */
export const PERMISSIONS: ReadonlyArray<readonly [string, string, string]> = [
  ['user:view', '查看用户', 'user'],
  ['user:create', '创建用户', 'user'],
  ['user:update', '编辑用户', 'user'],
  ['user:delete', '删除用户', 'user'],
  ['user:assign-role', '分配用户角色', 'user'],
  ['role:view', '查看角色', 'role'],
  ['role:create', '创建角色', 'role'],
  ['role:update', '编辑角色', 'role'],
  ['role:delete', '删除角色', 'role'],
  ['role:assign-permission', '分配角色权限', 'role'],
  ['permission:view', '查看权限码', 'permission'],
  ['menu:view', '查看菜单', 'menu'],
  ['menu:create', '创建菜单', 'menu'],
  ['menu:update', '编辑菜单', 'menu'],
  ['menu:delete', '删除菜单', 'menu'],
  ['dict:view', '查看字典', 'dict'],
  ['dict:create', '创建字典', 'dict'],
  ['dict:update', '维护字典项', 'dict'],
  ['dict:delete', '删除字典', 'dict'],
  ['audit:view', '查看审计日志', 'audit'],
  ['material:view', '查看物料', 'material'],
  ['material:create', '创建物料', 'material'],
  ['material:update', '编辑物料', 'material'],
  ['material:delete', '删除物料', 'material'],
  ['material:import', '导入物料', 'material'],
  ['material:export', '导出物料', 'material'],
  ['unit:view', '查看单位', 'unit'],
  ['unit:create', '创建单位', 'unit'],
  ['unit:update', '编辑单位', 'unit'],
  ['unit:delete', '删除单位', 'unit'],
  ['material-category:view', '查看物料分类', 'material-category'],
  ['material-category:create', '创建物料分类', 'material-category'],
  ['material-category:update', '编辑物料分类', 'material-category'],
  ['material-category:delete', '删除物料分类', 'material-category'],
  ['bom:view', '查看BOM', 'bom'],
  ['bom:create', '创建BOM', 'bom'],
  ['bom:update', '编辑BOM', 'bom'],
  ['bom:delete', '删除BOM', 'bom'],
  ['bom:activate', '激活BOM版本', 'bom'],
  ['work-center:view', '查看工作中心', 'work-center'],
  ['work-center:create', '创建工作中心', 'work-center'],
  ['work-center:update', '编辑工作中心', 'work-center'],
  ['work-center:delete', '删除工作中心', 'work-center'],
  ['equipment:view', '查看设备', 'equipment'],
  ['equipment:create', '创建设备', 'equipment'],
  ['equipment:update', '编辑设备', 'equipment'],
  ['equipment:delete', '删除设备', 'equipment'],
  ['routing:view', '查看工艺路线', 'routing'],
  ['routing:create', '创建工艺路线', 'routing'],
  ['routing:update', '编辑工艺路线', 'routing'],
  ['routing:delete', '删除工艺路线', 'routing'],
  ['routing:activate', '激活工艺路线', 'routing'],
  ['shift:view', '查看班次', 'shift'],
  ['shift:create', '创建班次', 'shift'],
  ['shift:update', '编辑班次', 'shift'],
  ['shift:delete', '删除班次', 'shift'],
  ['team:view', '查看班组', 'team'],
  ['team:create', '创建班组', 'team'],
  ['team:update', '编辑班组', 'team'],
  ['team:delete', '删除班组', 'team'],
  ['employee:view', '查看员工', 'employee'],
  ['employee:create', '创建员工', 'employee'],
  ['employee:update', '编辑员工', 'employee'],
  ['employee:delete', '删除员工', 'employee'],
  ['production-order:view', '查看生产订单', 'production-order'],
  ['production-order:create', '创建生产订单', 'production-order'],
  ['production-order:update', '编辑生产订单', 'production-order'],
  ['production-order:delete', '删除生产订单', 'production-order'],
  ['production-order:split', '拆分生产订单', 'production-order'],
  ['production-order:cancel', '取消生产订单', 'production-order'],
  ['work-order:view', '查看工单', 'work-order'],
  ['work-order:release', '下达工单', 'work-order'],
  ['work-order:start', '开工/继续工单', 'work-order'],
  ['work-order:pause', '暂停工单', 'work-order'],
  ['work-order:complete', '报完工', 'work-order'],
  ['work-order:close', '关闭工单', 'work-order'],
  ['work-order:cancel', '取消工单', 'work-order'],
  ['schedule:run', '运行排产', 'schedule'],
  ['schedule:adjust', '调整排产计划', 'schedule'],
  ['work-order-operation:view', '查看工序任务', 'work-order-operation'],
  ['work-order-operation:assign', '工序派工', 'work-order-operation'],
  ['work-order-operation:start', '工序开工', 'work-order-operation'],
  ['work-report:view', '查看报工', 'work-report'],
  ['work-report:create', '报工', 'work-report'],
  ['work-report:reverse', '撤销报工', 'work-report'],
  ['inventory:view', '查看库存', 'inventory'],
  ['inventory:adjust', '库存调整', 'inventory'],
  ['material-issue:create', '生成领料单', 'material-issue'],
  ['material-issue:issue', '执行领料', 'material-issue'],
  ['receipt:create', '完工入库', 'receipt'],
  ['defect-code:view', '查看缺陷代码', 'defect-code'],
  ['defect-code:create', '维护缺陷代码', 'defect-code'],
  ['inspection:view', '查看检验单', 'inspection'],
  ['inspection:create', '创建检验单', 'inspection'],
  ['inspection:submit', '提交检验结果', 'inspection'],
  ['inspection:disposition', '不合格处理', 'inspection'],
  ['inspection:concession', '让步接收', 'inspection'],
  ['equipment:change-status', '切换设备状态', 'equipment'],
  ['downtime:view', '查看停机记录', 'downtime'],
  ['downtime:update', '补录停机与日报', 'downtime'],
  ['board:view', '查看看板', 'board'],
  ['andon:view', '查看安灯', 'andon'],
  ['andon:create', '发起安灯呼叫', 'andon'],
  ['andon:respond', '响应安灯', 'andon'],
  ['andon:close', '关闭安灯', 'andon'],
  ['notification:view', '查看站内信', 'notification'],
  ['report:view', '查看报表', 'reports'],
  ['report:export', '导出报表', 'reports'],
  ['label:print', '打印标签', 'labels'],
  ['attachment:upload', '上传附件', 'labels'],
  ['attachment:download', '下载附件', 'labels'],
  ['ai:query', 'AI 查询', 'ai'],
] as const;

/** 角色：codes 为 'ALL' 表示拥有全部权限码（admin）。 */
export const ROLES: ReadonlyArray<{
  code: string;
  name: string;
  isBuiltin: boolean;
  codes: 'ALL' | readonly string[];
}> = [
  { code: 'admin', name: '管理员', isBuiltin: true, codes: 'ALL' },
  // planner 负责物料与生产计划；其余角色等对应模块（第 20 节起）出现后再补
  { code: 'planner', name: '计划员', isBuiltin: false, codes: [
    'material:view', 'material:create', 'material:update', 'material:delete', 'material:import', 'material:export',
    'unit:view', 'material-category:view', 'material-category:create', 'material-category:update', 'material-category:delete',
    'bom:view', 'bom:create', 'bom:update', 'bom:delete', 'bom:activate',
    'routing:view', 'routing:create', 'routing:update', 'routing:delete', 'routing:activate',
    'work-center:view', 'work-center:create', 'work-center:update', 'work-center:delete',
    'equipment:view', 'equipment:create', 'equipment:update', 'equipment:delete',
    'shift:view', 'shift:create', 'shift:update', 'shift:delete',
    'team:view', 'team:create', 'team:update', 'team:delete',
    'employee:view', 'employee:create', 'employee:update', 'employee:delete',
    'production-order:view', 'production-order:create', 'production-order:update', 'production-order:delete',
    'production-order:split', 'production-order:cancel',
    'work-order:view', 'work-order:release', 'work-order:start', 'work-order:pause',
    'work-order:complete', 'work-order:close', 'work-order:cancel',
    'schedule:run', 'schedule:adjust',
    'work-order-operation:view', 'work-order-operation:assign', 'work-order-operation:start',
    'work-report:view', 'work-report:create', 'work-report:reverse',
    'inventory:view', 'inventory:adjust',
    'material-issue:create', 'material-issue:issue',
    'receipt:create',
    'inspection:view', 'inspection:create', 'inspection:submit', 'inspection:disposition',
    'inspection:concession',
    'defect-code:view', 'defect-code:create',
    'equipment:change-status', 'downtime:view', 'downtime:update',
    'andon:view', 'andon:respond', 'andon:close', 'notification:view',
    'board:view',
    'report:view', 'report:export',
    'label:print', 'attachment:upload', 'attachment:download',
    'ai:query',
  ] },
  { code: 'operator', name: '操作工', isBuiltin: false, codes: [
    // 安灯呼叫表单需要产线与设备下拉：workCenterId 必填、默认呼叫类型 EQUIPMENT 默认展示设备选择，
    // 操作工对产线/设备均为只读（work-center:view / equipment:view）
    'andon:view', 'andon:create', 'notification:view', 'work-center:view', 'equipment:view',
    // 扫码报工是车间最高频操作（第 37 节）：工单/工序只读 + 工序开工 + 报工；
    // 报工员工下拉需要 employee:view（否则前端拿不到候选员工）
    'work-order:view', 'work-order-operation:view', 'work-order-operation:start',
    'work-report:view', 'work-report:create', 'employee:view',
  ] },
  { code: 'qc', name: '质检员', isBuiltin: false, codes: [
    'andon:view', 'andon:respond', 'andon:close', 'notification:view',
    'inspection:view', 'inspection:create', 'inspection:submit', 'inspection:disposition',
    'defect-code:view', 'defect-code:create',
  ] },
  { code: 'maintainer', name: '设备维护员', isBuiltin: false, codes: [
    'work-center:view', 'equipment:view', 'equipment:create', 'equipment:update', 'equipment:delete',
    'equipment:change-status', 'downtime:view', 'downtime:update',
    'andon:view', 'andon:respond', 'andon:close', 'notification:view',
  ] },
];

/** 种子用户：password 明文仅在种子阶段使用，入库是 bcrypt 哈希 */
export const USERS: ReadonlyArray<{ username: string; password: string; name: string; roleCode: string }> = [
  { username: 'admin', password: 'Admin@123', name: '管理员', roleCode: 'admin' },
  { username: 'planner', password: 'User@123', name: '计划员小王', roleCode: 'planner' },
  { username: 'operator', password: 'User@123', name: '操作工小李', roleCode: 'operator' },
  { username: 'qc', password: 'User@123', name: '质检员小张', roleCode: 'qc' },
  { username: 'maintainer', password: 'User@123', name: '维护员小赵', roleCode: 'maintainer' },
];

/** 菜单树（平铺，parentPath 关联；目录节点 parentPath 为空）。 */
export const MENUS: ReadonlyArray<{
  path: string;
  parentPath: string | null;
  name: string;
  icon: string | null;
  component: string | null;
  permissionCode: string | null;
  sort: number;
}> = [
  { path: '/base', parentPath: null, name: '基础数据', icon: 'Goods', component: null, permissionCode: null, sort: 2 },
  { path: '/base/materials', parentPath: '/base', name: '物料管理', icon: 'Box', component: 'material/MaterialList', permissionCode: 'material:view', sort: 1 },
  { path: '/base/material-categories', parentPath: '/base', name: '物料分类', icon: 'Files', component: 'material/MaterialCategoryList', permissionCode: 'material-category:view', sort: 2 },
  { path: '/base/units', parentPath: '/base', name: '计量单位', icon: 'ScaleToOriginal', component: 'material/UnitList', permissionCode: 'unit:view', sort: 3 },
  { path: '/system', parentPath: null, name: '系统管理', icon: 'Setting', component: null, permissionCode: null, sort: 1 },
  { path: '/system/users', parentPath: '/system', name: '用户管理', icon: 'User', component: 'user/UserList', permissionCode: 'user:view', sort: 1 },
  { path: '/system/roles', parentPath: '/system', name: '角色管理', icon: 'Key', component: 'role/RoleList', permissionCode: 'role:view', sort: 2 },
  { path: '/system/permissions', parentPath: '/system', name: '权限管理', icon: 'Lock', component: 'permission/PermissionList', permissionCode: 'permission:view', sort: 3 },
  { path: '/system/menus', parentPath: '/system', name: '菜单管理', icon: 'Menu', component: 'menu/MenuList', permissionCode: 'menu:view', sort: 4 },
  { path: '/system/dicts', parentPath: '/system', name: '数据字典', icon: 'Collection', component: 'dict/DictList', permissionCode: 'dict:view', sort: 5 },
  { path: '/system/audits', parentPath: '/system', name: '审计日志', icon: 'Document', component: 'audit/AuditList', permissionCode: 'audit:view', sort: 6 },
  // 目录一律不绑码（与 menu.service visibleTree 的约定一致，见 docs/prompts/crud-module.md）：
  // 叶子按各自权限码过滤，目录只要还有可见子节点就保留；绑码会让没有目录码的角色
  // 看到孤儿叶子（浮到顶层）或整支不可见（如 maintainer 没有 routing:view 连设备管理都看不到）
  { path: '/boms', parentPath: null, name: 'BOM 管理', icon: 'Share', component: null, permissionCode: null, sort: 3 },
  { path: '/boms/list', parentPath: '/boms', name: 'BOM 列表', icon: null, component: 'bom/BomList', permissionCode: 'bom:view', sort: 1 },
  { path: '/manufacture', parentPath: null, name: '工艺管理', icon: 'SetUp', component: null, permissionCode: null, sort: 4 },
  { path: '/manufacture/routings', parentPath: '/manufacture', name: '工艺路线', icon: null, component: 'routing/RoutingList', permissionCode: 'routing:view', sort: 1 },
  { path: '/manufacture/work-centers', parentPath: '/manufacture', name: '工作中心', icon: null, component: 'work-center/WorkCenterList', permissionCode: 'work-center:view', sort: 2 },
  { path: '/manufacture/equipments', parentPath: '/manufacture', name: '设备管理', icon: null, component: 'equipment/EquipmentList', permissionCode: 'equipment:view', sort: 3 },
  { path: '/manufacture/teams', parentPath: '/manufacture', name: '班组人员', icon: null, component: 'team/TeamList', permissionCode: 'team:view', sort: 4 },
  { path: '/plan', parentPath: null, name: '生产计划', icon: 'Calendar', component: null, permissionCode: null, sort: 5 },
  { path: '/plan/production-orders', parentPath: '/plan', name: '生产订单', icon: null, component: 'production-order/ProductionOrderList', permissionCode: 'production-order:view', sort: 1 },
  { path: '/plan/work-orders', parentPath: '/plan', name: '工单列表', icon: null, component: 'work-order/WorkOrderList', permissionCode: 'work-order:view', sort: 2 },
  { path: '/plan/gantt', parentPath: '/plan', name: '排产甘特图', icon: null, component: 'schedule/Gantt', permissionCode: 'work-order:view', sort: 3 },
  { path: '/report', parentPath: null, name: '车间报工', icon: 'EditPen', component: 'work-report/WorkReportPage', permissionCode: 'work-report:create', sort: 6 },
  { path: '/inventory', parentPath: null, name: '库存管理', icon: 'Box', component: 'inventory/InventoryList', permissionCode: 'inventory:view', sort: 7 },
  { path: '/inspection', parentPath: null, name: '质量管理', icon: 'Checked', component: 'inspection/InspectionList', permissionCode: 'inspection:view', sort: 8 },
  // 页面内容是停机记录/设备日报，绑 downtime:view；绑 equipment:view 会让只有设备只读码的角色
  // （如 operator，安灯下拉需要）看到入口却整页 403
  { path: '/equipment-status', parentPath: '/manufacture', name: '设备状态', icon: null, component: 'equipment/EquipmentStatusList', permissionCode: 'downtime:view', sort: 5 },
  { path: '/board', parentPath: null, name: '车间看板', icon: 'Monitor', component: 'board/Board', permissionCode: 'board:view', sort: 9 },
  { path: '/andon', parentPath: null, name: '安灯呼叫', icon: 'Bell', component: 'andon/AndonList', permissionCode: 'andon:view', sort: 10 },
  { path: '/reports', parentPath: null, name: '报表分析', icon: 'TrendCharts', component: null, permissionCode: null, sort: 11 },
  { path: '/reports/work-order-progress', parentPath: '/reports', name: '工单进度', icon: null, component: 'reports/WorkOrderProgress', permissionCode: 'report:view', sort: 1 },
  { path: '/reports/yield', parentPath: '/reports', name: '良率分析', icon: null, component: 'reports/YieldReport', permissionCode: 'report:view', sort: 2 },
  { path: '/reports/oee', parentPath: null, name: '设备 OEE', icon: null, component: 'reports/OeeReport', permissionCode: 'report:view', sort: 3 },
  { path: '/labels', parentPath: null, name: '标签打印', icon: 'Printer', component: 'labels/Print', permissionCode: 'label:print', sort: 12 },
];
