/** 错误码表：与 CLAUDE.md 中的表一致。新增错误码在此登记，2xxx 为业务错误。 */
export enum ErrorCode {
  OK = 0,
  VALIDATION = 1001,
  UNAUTHORIZED = 1002,
  FORBIDDEN = 1003,
  NOT_FOUND = 1004,
  CONFLICT = 1005,
  STATE_NOT_ALLOWED = 1006,
  CONCURRENT_CONFLICT = 1007,
  TOO_MANY = 1008,
  ACCOUNT_LOCKED = 1009,
  CAPTCHA_REQUIRED = 1010,
  STOCK_SHORT = 2001,
  QTY_EXCEEDED = 2002,
  BOM_CYCLE = 2003,
  OP_NOT_READY = 2004,
  MENU_CYCLE = 2005,
  INTERNAL = 9999,
}

export const ErrorMessage: Record<ErrorCode, string> = {
  [ErrorCode.OK]: 'ok',
  [ErrorCode.VALIDATION]: '参数校验失败',
  [ErrorCode.UNAUTHORIZED]: '未登录或登录已过期',
  [ErrorCode.FORBIDDEN]: '无权限',
  [ErrorCode.NOT_FOUND]: '资源不存在',
  [ErrorCode.CONFLICT]: '数据冲突',
  [ErrorCode.STATE_NOT_ALLOWED]: '当前状态不允许该操作',
  [ErrorCode.CONCURRENT_CONFLICT]: '数据已被他人修改，请刷新重试',
  [ErrorCode.TOO_MANY]: '请求过于频繁，请稍后再试',
  [ErrorCode.ACCOUNT_LOCKED]: '账号已锁定，请稍后再试',
  [ErrorCode.CAPTCHA_REQUIRED]: '请完成滑块验证',
  [ErrorCode.STOCK_SHORT]: '库存不足',
  [ErrorCode.QTY_EXCEEDED]: '数量超出允许范围',
  [ErrorCode.BOM_CYCLE]: 'BOM 循环引用',
  [ErrorCode.OP_NOT_READY]: '工序未就绪',
  [ErrorCode.MENU_CYCLE]: '菜单层级形成循环',
  [ErrorCode.INTERNAL]: '服务器内部错误',
};

/** 错误码 → HTTP 状态码 */
export const ErrorHttpStatus: Record<ErrorCode, number> = {
  [ErrorCode.OK]: 200,
  [ErrorCode.VALIDATION]: 400,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.STATE_NOT_ALLOWED]: 409,
  [ErrorCode.CONCURRENT_CONFLICT]: 409,
  [ErrorCode.TOO_MANY]: 429,
  [ErrorCode.ACCOUNT_LOCKED]: 423,
  [ErrorCode.CAPTCHA_REQUIRED]: 400,
  [ErrorCode.STOCK_SHORT]: 422,
  [ErrorCode.QTY_EXCEEDED]: 422,
  [ErrorCode.BOM_CYCLE]: 422,
  [ErrorCode.OP_NOT_READY]: 422,
  [ErrorCode.MENU_CYCLE]: 422,
  [ErrorCode.INTERNAL]: 500,
};

/** 统一响应结构 */
export interface ApiResponse<T = unknown> {
  code: ErrorCode | number;
  message: string;
  data: T;
  requestId?: string;
}

/** 分页查询参数与返回结构 */
export interface PageQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PageResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const PAGE_DEFAULT = 20;
export const PAGE_MAX = 200;

/** 认证：当前用户信息（不含密码哈希） */
export interface AuthUser {
  id: number;
  username: string;
  name: string;
}

/** 双 token */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** 登录 / 刷新接口的返回 */
export interface LoginResult extends TokenPair {
  user: AuthUser;
}

/** 菜单树节点（/auth/me 返回） */
export interface MenuNode {
  id: number;
  parentId: number | null;
  path: string;
  name: string;
  icon: string | null;
  component: string | null;
  permissionCode: string | null;
  sort: number;
  children: MenuNode[];
}

/** /auth/me 返回：用户 + 角色 + 权限码 + 可见菜单树 */
export interface MeResult {
  user: AuthUser;
  roles: string[];
  permissions: string[];
  menus: MenuNode[];
}

/** 滑块验证成功后随登录一起提交 */
export interface LoginCaptchaInput {
  captchaId: string;
  captchaOffset: number;
}

/**
 * 服务端生成的滑块挑战：目标位置只存在服务端，返回的是两张不透明 PNG（base64 data URI）。
 * target 仅 e2e 在显式开关下可见，生产/开发环境不返回。
 */
export interface CaptchaChallenge {
  captchaId: string;
  background: string;
  piece: string;
  width: number;
  height: number;
  pieceSize: number;
  pieceTop: number;
  maxOffset: number;
  tolerance: number;
  expiresIn: number;
  /** 仅测试环境（显式开关）返回，便于 e2e 自动拖到目标位置 */
  target?: number;
}

/** 角色（列表行） */
export interface RoleRow {
  id: number;
  code: string;
  name: string;
  remark: string | null;
  isBuiltin: boolean;
  userCount: number;
  permissionCount: number;
  /** 角色拥有的权限 id（详情接口返回，用于权限勾选树回显；列表接口为空数组） */
  permissionIds: number[];
  createdAt: string;
}

/** 权限码（字典行） */
export interface PermissionRow {
  id: number;
  code: string;
  name: string;
  module: string;
}

/** 菜单（管理列表行） */
export interface MenuRow {
  id: number;
  parentId: number | null;
  path: string;
  name: string;
  icon: string | null;
  component: string | null;
  permissionCode: string | null;
  sort: number;
  children: MenuRow[];
}

/** 用户（列表行，不含密码哈希） */
export interface UserRow {
  id: number;
  username: string;
  name: string;
  status: number;
  roles: { id: number; code: string; name: string }[];
  createdAt: string;
}

/** 数据字典（列表行） */
export interface DictRow {
  id: number;
  code: string;
  name: string;
  remark: string | null;
  createdAt: string;
}

/** 字典详情（含字典项） */
export interface DictDetail extends DictRow {
  items: DictItemRow[];
}

/** 字典项 */
export interface DictItemRow {
  id: number;
  dictId: number;
  label: string;
  value: string;
  sort: number;
  status: number;
}

/** 下拉选项（useDict 返回） */
export interface DictOption {
  label: string;
  value: string;
}

/** 审计日志（只读） */
export interface AuditLogRow {
  id: number;
  userId: number | null;
  username: string;
  method: string;
  path: string;
  module: string;
  action: string;
  /** JSON 字符串：query/body 摘要，密码与 token 已脱敏 */
  params: string;
  /** success 或错误码（如 1002） */
  result: string;
  durationMs: number;
  ip: string;
  createdAt: string;
}

// ==================== 物料主数据（第 13-15 节） ====================

/** 物料类型 */
export type MaterialType = 'RAW' | 'SEMI' | 'FINISHED';

/** 计量单位（列表行） */
export interface UnitRow {
  id: number;
  code: string;
  name: string;
  status: number;
  /** 引用此单位的未删除物料数 */
  materialCount: number;
  createdAt: string;
}

/** 单位下拉选项 */
export interface UnitOption {
  id: number;
  code: string;
  name: string;
}

/** 物料分类（树节点，列表页 el-tree 用） */
export interface CategoryNode {
  id: number;
  parentId: number | null;
  code: string;
  name: string;
  /** 该分类直接挂的未删除物料数（不含子分类） */
  materialCount: number;
  children: CategoryNode[];
}

/** 物料（列表行） */
export interface MaterialRow {
  id: number;
  code: string;
  name: string;
  spec: string | null;
  categoryId: number;
  category: { id: number; code: string; name: string };
  unitId: number;
  unit: { id: number; code: string; name: string };
  type: MaterialType;
  status: number;
  safetyStock: number | null;
  createdAt: string;
}

/** 物料查询参数（列表与导出共用） */
export interface MaterialQuery extends PageQuery {
  categoryId?: number;
  type?: MaterialType;
  status?: number;
}

/** 导入错误明细（错误报告数据源） */
export interface MaterialImportError {
  rowNumber: number;
  message: string;
}

/** 导入接口返回：整批拒绝策略——有错误 successCount=0 且 errors 非空 */
export interface MaterialImportResult {
  successCount: number;
  errorCount: number;
  errors: MaterialImportError[];
}

/** BOM（列表行） */
export interface BomRow {
  id: number;
  materialId: number;
  version: string;
  status: 'DRAFT' | 'ACTIVE' | 'OBSOLETE';
  effectiveFrom: string;
  effectiveTo: string | null;
  remark: string | null;
  material: { code: string; name: string; type: string };
  itemCount: number;
  createdAt: string;
}

/** BOM 详情（含明细） */
export interface BomDetail extends Omit<BomRow, 'itemCount'> {
  items: BomItemRow[];
  unitId: number;
}

/** BOM 明细 */
export interface BomItemRow {
  id: number;
  bomId: number;
  childMaterialId: number;
  childMaterial: { code: string; name: string; type: string };
  qty: number;
  scrapRate: number;
  position: string | null;
  remark: string | null;
}

/** BOM 树节点（展开结果） */
export interface BomTreeNodeDto {
  materialId: number;
  code: string;
  name: string;
  type: string;
  qty: number;
  unitQty: number;
  scrapRate: number;
  children: BomTreeNodeDto[];
}

/** 树接口响应 */
export interface BomTreeResult {
  bom: { id: number; version: string; status: string; material: { code: string; name: string } };
  tree: BomTreeNodeDto;
  summary: { materialId: number; code: string; name: string; qty: number }[];
  depth: number;
}

/** 工作中心 */
export interface WorkCenterRow {
  id: number;
  code: string;
  name: string;
  type: 'LINE' | 'CELL';
  dailyCapacity: number;
  status: number;
  equipmentCount: number;
  operationCount: number;
}

/** 设备 */
export interface EquipmentRow {
  id: number;
  code: string;
  name: string;
  workCenterId: number;
  workCenter: { code: string; name: string };
  model: string | null;
  status: 'RUNNING' | 'IDLE' | 'FAULT' | 'MAINTENANCE';
}

/** 工艺路线（列表行） */
export interface RoutingRow {
  id: number;
  materialId: number;
  version: string;
  status: 'DRAFT' | 'ACTIVE' | 'OBSOLETE';
  remark: string | null;
  material: { code: string; name: string; type: string };
  operationCount: number;
}

/** 工序 */
export interface RoutingOperationRow {
  id: number;
  routingId: number;
  seq: number;
  code: string;
  name: string;
  workCenterId: number;
  workCenter: { code: string; name: string };
  standardMinutes: number;
  isInspectionPoint: boolean;
  allowSkip: boolean;
  remark: string | null;
}

/** 班次 */
export interface ShiftRow {
  id: number;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  crossDay: boolean;
}

/** 班组 */
export interface TeamRow {
  id: number;
  code: string;
  name: string;
  workCenterId: number;
  workCenter: { code: string; name: string };
  leaderId: number | null;
  leader: { id: number; code: string; name: string } | null;
  employeeCount: number;
}

/** 员工 */
export interface EmployeeRow {
  id: number;
  code: string;
  name: string;
  teamId: number;
  team: { code: string; name: string; workCenterId: number };
  userId: number | null;
  user: { id: number; username: string } | null;
  status: 'ACTIVE' | 'LEFT';
  hiredAt: string;
  leftAt: string | null;
  skills: EmployeeSkillRow[];
}

/** 员工技能 */
export interface EmployeeSkillRow {
  id: number;
  employeeId: number;
  opCode: string | null;
  workCenterId: number | null;
  level: number;
}

/** 调组记录 */
export interface EmployeeTransferRow {
  id: number;
  employeeId: number;
  fromTeamId: number;
  fromTeam: { name: string };
  toTeamId: number;
  toTeam: { name: string };
  at: string;
}

// ---- 生产订单与排产（第 26 节） ----

/** 生产订单状态 */
export type ProductionOrderStatus = 'DRAFT' | 'PLANNED' | 'RELEASED' | 'COMPLETED' | 'CANCELLED';

/** 生产订单（列表行） */
export interface ProductionOrderRow {
  id: number;
  code: string;
  materialId: number;
  material: { code: string; name: string };
  qty: number;
  dueDate: string;
  priority: number;
  source: string;
  status: ProductionOrderStatus;
  remark: string | null;
  workOrderCount: number;
}

/** 生产订单详情（含工单） */
export interface ProductionOrderDetail extends ProductionOrderRow {
  workOrders: WorkOrderRow[];
}

/** 工单状态（第 30 节状态机，转换表正本在 work-order.state.ts / docs/state-machine/work-order.md） */
export type WorkOrderStatus = 'CREATED' | 'RELEASED' | 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED' | 'CLOSED' | 'CANCELLED';

/** 工单（列表行） */
export interface WorkOrderRow {
  id: number;
  code: string;
  productionOrderId: number;
  productionOrder: { code: string; dueDate: string; priority: number };
  materialId: number;
  material: { code: string; name: string };
  qty: number;
  workCenterId: number | null;
  workCenter: { code: string; name: string } | null;
  routingId: number | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  status: WorkOrderStatus;
  isDelayed: boolean;
  completedQty: number;
}

/** 拆分请求项 */
export interface SplitItem {
  qty: number;
  workCenterId?: number;
}

/** 排产输入（POST /schedule/run） */
export interface ScheduleRunInput {
  from: string;
  to?: string;
  workCenterIds?: number[];
}

/** 排产结果：按产线分组的计划 */
export interface ScheduleRunResult {
  scheduled: number;
  skipped: { workOrderId: number; reason: string }[];
  delayed: number;
  groups: {
    workCenterId: number | null;
    workCenter: { code: string; name: string } | null;
    items: { id: number; code: string; qty: number; plannedStart: string; plannedEnd: string; isDelayed: boolean }[];
  }[];
}

/** 排产查询（GET /schedule）：按产线分组的窗口内工单 */
export interface ScheduleView {
  groups: {
    workCenterId: number;
    workCenter: { code: string; name: string };
    items: WorkOrderRow[];
  }[];
  total: number;
}
