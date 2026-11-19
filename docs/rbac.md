# RBAC 权限系统技术文档

> 覆盖第 6–9 节成果。面向：接手本项目的开发者、需要理解权限模型的人。
> 相关文档：验收标准 `docs/acceptance/rbac.md`、决策记录 `docs/adr/002-权限变更生效策略.md`、边界用例 `test/rbac.e2e-spec.ts`、开发日志 `docs/log/06~09.md`。

## 1. 一句话模型

**权限码 `<模块>:<动作>` 是前后端共同语言**：后端每个接口声明需要哪个码，前端每个按钮/菜单声明需要哪个码，角色只是码的集合。用户 → 角色 → 权限码，登录后一次拿到"我有的码 + 我能看的菜单"。

```
User ──< UserRole >── Role ──< RolePermission >── Permission(权限码)
                                                    ↑
Menu(菜单树，叶子绑权限码) ──── permissionCode ──────┘
```

## 2. 数据模型（5 张表）

| 表 | 关键字段 | 说明 |
|---|---|---|
| `Role` | code @unique, name, **isBuiltin** | 内置角色（isBuiltin=true）禁止删除/改权限/改名 |
| `Permission` | code @unique, name, module | 权限码字典。**不开放增删接口**——代码里写死的 `@Permissions` 码必须先入种子，接口创建会造成码表与代码脱节 |
| `Menu` | parentId, path @unique, **component**, permissionCode, sort | 菜单树。叶子绑权限码；目录不绑码但只在有可见子节点时显示（后端剪枝）；component 是"菜单→前端组件"的显式映射 |
| `UserRole` | @@id(userId, roleId) | 用户-角色多对多 |
| `RolePermission` | @@id(roleId, permissionId) | 角色-权限多对多 |

所有模型带 `createdAt/updatedAt/createdBy/updatedBy` 审计字段。

## 3. 权限码字典（正本：`apps/server/prisma/rbac-data.ts`）

当前 **34 个权限码**，新增模块就往这里加码（如 `material:view`）：

| 模块 | 码 |
|---|---|
| user | view / create / update / delete / **assign-role** |
| role | view / create / update / delete / **assign-permission** |
| permission | view |
| menu | view / create / update / delete |
| dict | view / create / update / delete |
| audit | view |
| material | view / create / update / delete / import / export |
| unit | view |
| material-category | view / create / update / delete |

**规则**：`@Permissions('xxx:yyy')` 里写的码必须已在此表（`test/permissions-scan.e2e-spec.ts` 扫描兜底），且码表本身无重复（同文件断言）。

## 4. 种子角色与用户

| 角色 code | 名称 | 权限（概览，正本见 `prisma/rbac-data.ts` 的 `ROLES`） |
|---|---|---|
| admin | 管理员（内置） | ALL（种子保证 = 权限码全集） |
| planner | 计划员 | 物料/BOM/工艺/产线/班组/生产订单/工单/排产/派工/报工/库存/质检/安灯/看板/报表/标签/附件/AI |
| operator | 操作工 | 安灯发起/查看、通知、产线/设备只读、工单/工序只读、工序开工、报工（view/create）、员工只读 |
| qc | 质检员 | 检验单/缺陷码、安灯响应/关闭、通知 |
| maintainer | 设备维护员 | 设备/工作中心/停机、安灯响应/关闭、通知 |

种子用户（密码入库为 bcrypt 哈希，明文只在 `rbac-data.ts` 种子阶段）：

| 用户名 | 密码 | 角色 |
|---|---|---|
| admin | Admin@123 | admin |
| planner | User@123 | planner |
| operator | User@123 | operator |
| qc | User@123 | qc |
| maintainer | User@123 | maintainer |

## 5. 后端：接口与权限声明

守卫顺序固定（`auth.module.ts` 以 APP_GUARD 全局注册）：

```
请求 → JwtAuthGuard（认证：token 有效、用户存在且启用）→ PermissionsGuard（鉴权：有无所需码）→ Controller
```

两个守卫都是**每次请求查库**（ADR-002）：权限改动/用户禁用，下一次请求立即生效，无需重新登录。

### 接口清单（21 个）

| 模块 | 接口 | 所需权限码 |
|---|---|---|
| user | GET /users、GET /users/:id | user:view |
| | POST /users | user:create |
| | PATCH /users/:id | user:update |
| | DELETE /users/:id | user:delete |
| | PUT /users/:id/roles | user:assign-role |
| role | GET /roles、GET /roles/:id | role:view |
| | POST /roles | role:create |
| | PATCH /roles/:id | role:update |
| | DELETE /roles/:id | role:delete |
| | PUT /roles/:id/permissions | role:assign-permission |
| permission | GET /permissions | permission:view |
| menu | GET /menus | menu:view |
| | POST /menus | menu:create |
| | PATCH /menus/:id | menu:update |
| | DELETE /menus/:id | menu:delete |

**白名单**（登录即可、只操作 token 本人，扫描测试登记）：`/auth/me`、`/auth/logout`、`/auth/refresh`、`/dicts/code/:code/options`。

## 6. 关键业务规则（自我保护三件套 + 边界）

| 规则 | 实现 |
|---|---|
| 不能删除/停用**自己** | 防自断管理入口 |
| 不能修改**自己的角色** | 比任务卡"不能给自己加 admin"更严——提权方式不止加 admin 一条路 |
| 内置角色（isBuiltin）不可删/不可改权限/不可改名 | 防误操作毁掉种子体系 |
| 删除还有用户的角色 → 拒绝 + 提示关联用户数 | 409，消息含"N 个用户" |
| 菜单 parentId 指向自己或子孙 → 拒绝 | 防循环（错误码 2005，CLAUDE.md 已登记） |
| 无角色用户 | 能登录、菜单为空（空目录剪枝）、所有业务接口 403 |

## 7. 登录后返回什么

`GET /api/auth/me`（登录响应同构）返回：

```json
{
  "user": { "id": 1, "username": "admin", "name": "管理员" },
  "roles": ["admin"],
  "permissions": ["user:view", "..."],
  "menus": [ { "path": "/system", "children": [ { "path": "/system/users", "component": "user/UserList", ... } ] } ]
}
```

- `permissions`：扁平码数组，前端 `v-permission` 和按钮显隐用；
- `menus`：按权限过滤并剪枝后的树，前端**动态路由**按它生成（`router/index.ts` 的 `registerDynamicRoutes`，component 相对 `src/views`）。

## 8. 前端实现

| 机制 | 文件 | 说明 |
|---|---|---|
| 按钮显隐 | `directives/permission.ts` | `v-permission="'user:create'"`，无码则移除元素。**只是体验层，后端才是防线** |
| 动态路由 | `router/index.ts` | `/me` 的菜单树 → `router.addRoute`；无权限路径直接无路由 |
| 侧栏菜单 | `layout/AdminLayout.vue` | 渲染 `/me` 的 menus 树 |

## 9. 测试防线（改代码前先看这里）

| 防线 | 文件 | 防什么 |
|---|---|---|
| 越权矩阵 | `test/permissions-matrix.e2e-spec.ts`（67 行） | 每接口 × 5 角色 × 匿名的期望状态码。**新接口必须加行**（含带路由参数的） |
| 码表扫描 | `test/permissions-scan.e2e-spec.ts` | ①@Permissions 里的码都在种子里；②码表无重复；③**每个 Controller 方法必须 @Permissions 或 @Public（或登记白名单）**——防"忘写声明 → 默认放行" |
| 边界用例 | `test/rbac.e2e-spec.ts`（10 例） | 上表业务规则逐条可执行 |
| 守卫单测 | `src/common/guards/permissions.guard.spec.ts` | 无装饰器/@Public/有码无权限/有码有权限 四分支 |

矩阵与扫描都经过**变异验证**（删掉装饰器/白名单条目/新增未声明接口，测试必须变红）。

## 10. 如何加一个新权限（检查单）

1. `prisma/rbac-data.ts` 的 `PERMISSIONS` 加码（如 `['material:view', '查看物料', 'material']`）；
2. 需要给现有角色就改 `ROLES` 对应 `codes`；
3. Controller 方法写 `@Permissions('material:view')`；
4. 菜单进 `MENUS`（叶子绑码、component 指向 `src/views` 下组件）；
5. 矩阵加行（admin 200 / 低权角色 403 / 匿名 401）；
6. `npx prisma db seed`（幂等 upsert）；
7. 全绿后提交。扫描测试会兜底第 3 步是否漏做。
