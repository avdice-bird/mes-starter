# 项目约定（AI 与人共同遵守）

> 本文件放在项目根目录。每次让 AI 做事前，确认它读过本文件。每节"审"课后更新本文件。

## 项目

MES 制造执行系统，课程项目，单人开发。虚构客户：一家小型电子装配厂（SMT → 插件 → 组装 → 包装）。

技术栈：npm workspaces monorepo
- `apps/server`：NestJS 10 + Prisma + SQLite，端口 3000，前缀 `/api`
- `apps/web`：Vue 3 + Vite + TypeScript + Element Plus + Pinia + Vue Router，端口 5173
- `apps/h5`：移动端 H5，Vue 3 + Vite + TypeScript + Vant 3 + Pinia + Vue Router，端口 5174
- `packages/shared`：前后端共享的类型、枚举、常量

## 目录

```
apps/server/src/
  common/            拦截器、过滤器、装饰器、异常、工具
  modules/<name>/    每个业务模块一个目录
    <name>.module.ts
    <name>.controller.ts
    <name>.service.ts
    <name>.service.spec.ts
    dto/
apps/server/prisma/schema.prisma
apps/server/test/<name>.e2e-spec.ts
apps/web/src/
  api/<module>.ts    接口封装
  views/<module>/    <Name>List.vue、<Name>Form.vue
  stores/            Pinia
  components/        通用组件（ProTable 等）
  directives/        v-permission
apps/h5/src/
  api/               移动端接口封装（复用同一套 /api 契约）
  views/             工作台、工单、扫码报工、安灯、通知、库存、质检
  layout/            TabbarLayout（底部导航）
  utils/toast.ts     Vant 3 Toast/Dialog 统一封装
docs/
  log/NN.md          课堂日志
  adr/NNN-标题.md    架构决策记录
  acceptance/        每个模块的验收标准
  checklists/        磨节课打勾的清单
  prompts/           可复用提示词模板
```

## 后端约定

- 分层：Controller（参数校验、权限声明）→ Service（业务逻辑）→ Prisma。Controller 不写业务逻辑，Service 不直接读 HTTP 对象。
- DTO 用 `class-validator` + `@nestjs/swagger` 的 `@ApiProperty`，每个字段都有描述。
- 统一响应 `{ code: 0, message: 'ok', data }`，由全局拦截器包装，Controller 直接返回 data。
- 业务异常 `throw new BusinessException(ErrorCode.XXX, '可选消息')`，全局过滤器转成 `{ code, message }`。
- 权限：`@Permissions('material:create')`，权限码格式 `<模块>:<动作>`，动作限于 `view / create / update / delete / import / export / <业务动作>`。公开接口显式 `@Public()`。
- 分页：query `{ page = 1, pageSize = 20, keyword?, sortBy?, sortOrder? }` → 返回 `{ list, total, page, pageSize }`。
- 多表写入用 `prisma.$transaction`。SQLite 连接串加 `?connection_limit=1`（单写连接串行化），交互式事务加 `{ maxWait: 10_000, timeout: 30_000 }`——默认 2s/5s 在并发下会超时 500（第 40 节互测发现）。
- 树形/递归查询禁止逐级查库（N+1）：一律"一次查全 + 内存建图展开"（见 ADR-002 BOM 展开策略），查询次数必须与节点数无关。
- 主键 `Int @id @default(autoincrement())`；编码字段 `code String @unique`；主数据带 `isDeleted Boolean @default(false)`。
- 每个模型带 `createdAt / updatedAt / createdBy / updatedBy`。
- 时间 UTC；数量 `Int`（最小单位）或 `Decimal`；金额 `Decimal`。
- 数量字段一律 Int（最小单位），DTO 加 `@Min(0) @Max(10_000_000)`，杜绝负数/小数/超大数（第 40 节互测共性）。
- 涉及状态或数量并发修改的模型带 `version Int @default(0)` 做乐观锁。
- **状态变更必须走 transition()，禁止直接 update status**（第 33 节 ADR-003）：工单等有状态机的模型，状态流转只允许经由转换表 + 事务入口；事务回调内所有写操作必须用 `tx` 客户端，出现 `this.prisma.xxx` 即为红旗。所有写路径带 version 条件更新（updateMany + count 检查），冲突抛 1007。

## 前端约定

- 列表页 `views/<module>/<Name>List.vue`：用 `ProTable`（搜索栏 + 表格 + 分页），操作列按钮用 `v-permission`。
- 表单 `views/<module>/<Name>Form.vue`：`el-dialog` + `el-form`，校验规则与后端 DTO 一致。
- 接口 `api/<module>.ts`：每个函数带返回类型，类型放 `packages/shared`。
- 状态 tag 颜色统一：草稿灰、进行中蓝、完成绿、异常红、取消灰。
- 登录后的页面必须显示当前账号名水印：canvas 固定覆盖、`pointer-events: none`、z-index 低于弹层/Toast，避免拦截操作。
- 登录后 30 分钟无操作自动退出：H5/Web 各自 `useIdleLogout`，多标签页共享最近活动时间；Web 车间看板 `/board` 作为常驻大屏排除。
- 危险操作用 `ElMessageBox.confirm`。

## 移动端约定（H5）

- 复用同一套 `/api` 契约，所有请求必须走 `apps/h5/src/api/http.ts`，不另起 axios 实例。
- 页面权限：路由 `meta.permissionCode` + 页面内 `user.has(code)` 控制入口显隐；后端守卫仍是唯一防线。
- Vant 3 只导出 `Toast` / `Dialog` 对象，统一从 `@/utils/toast` 引入，禁止在页面里直接 import Vant 4 风格的 `showToast`。
- 扫码优先用原生 `BarcodeDetector`，不支持时降级为手动输入，不引入额外扫码依赖。
- 报工幂等键：每次成功提交后轮换，换工单/重置时清空；失败保留原键允许原样重试。
- 移动端页面保持"大按钮、大输入、少层级"，底部操作条与安全区用 `env(safe-area-inset-*)` 适配。

## 测试约定

- 后端单元测试 `*.spec.ts`（Jest），只 mock Prisma 和外部服务。
- 后端集成测试 `test/*.e2e-spec.ts`，用独立 SQLite 文件，`beforeEach` 重置。
- 前端 Vitest；E2E Playwright 在 `apps/web/e2e`。
- 测试名用中文描述行为。

## 提交约定

- Conventional Commits：`feat(material): 物料 Excel 导入`、`fix(auth): 刷新 token 重放`、`test(bom): 循环引用用例`
- 每节课至少一个 commit，同时提交课堂日志 `docs/log/NN.md`。

## 完成的定义（DoD）

一个功能只有同时满足以下四条才算完成：
1. 验收标准逐条通过（`docs/acceptance/<模块>.md`）
2. 后端与前端细节清单过完（`docs/checklists/`）
3. 测试绿、CI 绿
4. 课堂日志写完，作者能向别人解释每个文件在做什么

## 错误码表

| 码 | 含义 | HTTP |
|---|---|---|
| 0 | 成功 | 200 |
| 1001 | 参数校验失败 | 400 |
| 1002 | 未登录或 token 无效 | 401 |
| 1003 | 无权限 | 403 |
| 1004 | 资源不存在 | 404 |
| 1005 | 唯一冲突 | 409 |
| 1006 | 状态不允许该操作 | 409 |
| 1007 | 并发冲突，请刷新重试 | 409 |
| 1008 | 请求过于频繁，请稍后再试 | 429 |
| 1009 | 账号已锁定，请稍后再试 | 423 |
| 1010 | 需要完成滑块验证 | 400 |
| 2001 | 库存不足 | 422 |
| 2002 | 数量超出允许范围 | 422 |
| 2003 | BOM 循环引用 | 422 |
| 2004 | 工序未就绪 | 422 |
| 2005 | 菜单层级形成循环 | 422 |
| 9999 | 服务器内部错误 | 500 |

新增错误码在此表登记，2xxx 为业务错误。

## AI 协作规则

- 生成前先给验收标准和 schema 片段，不让 AI 猜业务。
- 一次只让 AI 做一个模块的一层（先 schema，再 Service，再 Controller，再前端）；单次 diff 超过 500 行拆开。
- AI 生成的代码必须读一遍再 commit；不理解的地方让 AI 解释，还不理解就让它换一种更简单的写法。
- 测试由 AI 生成骨架，失败路径和边界由人补。
- 让 AI 评审时，逐条判断意见是否成立，记录在课堂日志里。
- AI 提出引入新依赖时，先问"不引入能不能做"。

## 认证约定（第 2-5 节评审形成）

- **日志禁止输出密码、token、请求体**：全局异常过滤器只打 method/url/stack；新增日志点时同样遵守。
- JWT secret 只从环境变量取（`common/config/env.ts`），禁止代码内兜底默认值；`.env` 不入库。
- 登录失败提示统一"用户名或密码错误"，不区分用户不存在/密码错误；用户不存在也要做同强度哈希比对（时序防枚举）。
- 连续 3 次密码错误后，登录必须携带滑块验证：`POST /auth/captcha` 领取一次性挑战（绑定用户名、2 分钟过期），登录体带 `captchaId + captchaOffset`；滑块校验失败**不累加**密码错误次数。不存在的用户名也走同一套阈值，避免通过"是否出现滑块"枚举账号。
- 连续 5 次密码错误锁定账号 15 分钟（`User.failedAttempts / lockedUntil`）；锁定期间即使密码正确也返回 1009。登录成功清零计数与锁定。
- refresh token 用随机串入库（可吊销），每次刷新轮换作废；作废与签发必须在同一 `$transaction`。
- token 存 localStorage（ADR-001）：模板禁止 `v-html`，引入富文本渲染前必须过安全评审。
- 登录接口限流 20 次/分钟（`@nestjs/throttler`，超出返回 code 1008）。

## RBAC 约定（第 6-9 节评审形成）

- 权限码 `<模块>:<动作>` 的唯一正本在 `apps/server/prisma/rbac-data.ts`；代码里新写 `@Permissions` 码必须先入这里（扫描测试 `test/permissions-scan.e2e-spec.ts` 兜底）。
- 每个 Controller 方法必须 `@Permissions(...)` 或 `@Public()` 二选一；唯一例外是"只操作 token 本人"的认证接口（`/auth/me`、`/auth/logout`、`/auth/refresh`），它们在扫描测试白名单里显式登记。
- 守卫顺序固定：JwtAuthGuard（认证）→ PermissionsGuard（鉴权），都在 `auth.module.ts` 以 APP_GUARD 全局注册；权限判定每次请求查库（ADR-002），改权限下一次请求生效。
- 自我保护三件套：不能删除/停用当前登录用户；不能修改自己的角色；内置角色（isBuiltin）不能删、不能改名、不能改权限。删除还有用户的角色必须提示关联用户数。
- 菜单 `path` 全局唯一且绑 `component`；叶子菜单绑权限码，目录不绑码但必须在有可见子节点时才显示（后端剪枝）。
- 前端动态路由按 `/auth/me` 的菜单树生成（`router/index.ts` 的 `registerDynamicRoutes`），按钮用 `v-permission`；前端隐藏只是体验，防线永远在后端守卫。
- 越权回归：新接口只需往 `test/permissions-matrix.e2e-spec.ts` 的 cases 表加行。
- 本机注意：`nest-cli.json` 的 `deleteOutDir` 保持 false（触发 safe-delete hook 会把 dev server 二次启动打崩）。
