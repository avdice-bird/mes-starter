# CRUD 模块生成提示词模板（v2）

> 用法：把本文件整段发给 AI，替换「输入」段的内容。
> v1：第 10 节初稿。v2：第 11 节按字典模块的清单修复反哺，新增规则以 `<!-- v2 -->` 标记（共 8 条）。
> 变更历史：v2 新增段落 2.9（不可变字段）、3.11（组合式函数）、4 修订（第一批必含唯一约束设计）、6 自检新增两条。

---

你是本项目的资深开发者。请按以下要求为我生成一个完整的 CRUD 模块（后端 + 前端 + 测试 + 种子）。

## 1. 输入

- 模块名：{中文名，如：数据字典}
- 英文名（目录/路由/代码标识）：{如：dict}
- 权限码前缀：{如：dict}
- 是否软删（isDeleted）：{是/否}
- <!-- v2.1 --> **模块形态**：{完整 CRUD / 只读}。只读模块（如审计日志）：只生成 list + 详情查询接口与权限码 `前缀:view`，无增删改接口、无前端表单；输出清单里 Form、变更类矩阵行随之省略。
- 字段表：

| 字段 | 类型 | 必填 | 唯一 | 校验规则 | 说明 |
|---|---|---|---|---|---|
| {code} | {String} | {是} | {全局唯一} | {2-32 位，小写字母数字下划线} | {编码，被业务代码引用} |
| {…} | | | | | |

- 附加业务规则（边界用例）：{如：code 创建后不可修改；有关联子项时禁止删除}
- <!-- v2 --> **不可变字段清单**：{如：code——被业务代码引用}。清单里的字段在 Update DTO 中**不得出现**，前端编辑弹窗对应输入框 disabled，创建弹窗加提示文字。
- <!-- v2 --> **下拉提供方**：本模块是否需要给其他页面提供下拉数据（useDict/组合式函数）？{是/否}。若是：需要"按业务标识取启用项"的只读接口（登录即可，不要求管理权限码，登记扫描白名单）。

## 2. 必须遵守

1. **先读项目根目录 `CLAUDE.md`**，所有约定（分层、响应结构、错误码、审计字段、乐观锁、权限码格式）以它为准；
2. 分层：Controller 只做参数校验与权限声明；业务逻辑在 Service；数据访问走 Prisma；
3. DTO：`class-validator` 每个字段都有校验装饰器 + `@ApiProperty` 描述；分页查询继承 `common/dto/page-query.dto.ts` 的 `PageQueryDto`；
4. 统一响应 `{ code, message, data }` 由全局拦截器包装，Controller 直接返回数据；业务异常用 `BusinessException(ErrorCode.XXX)`，新错误码先登记进 `CLAUDE.md` 错误码表；
5. 每个接口 `@Permissions('前缀:动作')` 或 `@Public()` 二选一（扫描测试会检查）；
6. 模型带 `createdAt/updatedAt/createdBy/updatedBy`；主键 `Int @id @default(autoincrement())`；
7. 唯一字段在 schema 加 `@unique`，重复冲突返回 409 + 友好消息——**<!-- v2 --> Service 捕获 P2002 转成业务化消息**（如"已存在相同 value"），不要依赖全局过滤器的通用文案；复合唯一用 `@@unique([a, b])`，并在 DTO/文档里写清"唯一范围"（全局还是分组内）；
8. 多表写入用 `prisma.$transaction`；
9. 前端：列表页用 `ProTable` 组件（`components/ProTable.vue`），操作按钮用 `v-permission`，危险操作用 `ElMessageBox.confirm`，表单校验规则与后端 DTO 一致（含 maxlength）；
10. **<!-- v2 --> 有关联子项的主记录：删除接口先查子项数，非零时 409 + 提示具体项数**（"该字典下有 3 个字典项，请先清空再删除"式文案），e2e 必测此用例；
11. **<!-- v2 --> 业务标识字段（code 类）创建后不可修改**：Update DTO 不收该字段 + 前端编辑 disabled + 创建弹窗提示，三层一致；
12. **<!-- v2 --> 列表排序字段走白名单**：`sortBy` 只允许预定义的列（如 id/code/name/createdAt），白名单外的回退默认排序，防任意字段；
13. **<!-- v2 --> 状态类字段（status）**：启用/停用语义，下拉/选项类查询只返回 status=1；管理列表返回全部。

## 3. 输出清单

按顺序输出以下文件（一个不缺）：

1. `apps/server/prisma/schema.prisma` 追加的 model 片段；
2. migration（给出 `prisma migrate dev --name xxx` 的命令即可）；
3. `apps/server/src/modules/{英文名}/`：`{name}.module.ts`、`{name}.controller.ts`、`{name}.service.ts`、`dto/{name}.dto.ts`；
4. `apps/server/src/modules/{name}/{name}.service.spec.ts` 测试骨架（含失败路径）；
5. `apps/server/test/{name}.e2e-spec.ts` 集成测试（`beforeEach` 重置表，参考 `test/helpers/app.ts`；**<!-- v2 --> 必含：唯一冲突 409、有子项禁删 409、不可变字段不可改、停用项不进下拉**——按"附加业务规则"裁剪）；
6. 权限码追加到 `apps/server/prisma/rbac-data.ts` 的 `PERMISSIONS`；
7. 菜单追加到 `MENUS`（叶子菜单绑权限码、component 按路径约定）；
8. `apps/web/src/api/{name}.ts`（每个函数带返回类型，类型放 `packages/shared`）；
9. `apps/web/src/views/{name}/`：`{Name}List.vue`、`{Name}Form.vue`（或内嵌 dialog）；**<!-- v2 --> 主从结构（主表 → 子表维护）用 el-drawer 抽屉，不用二级页面**；
10. 权限测试矩阵 `test/permissions-matrix.e2e-spec.ts` 新增行（每个新接口 × admin 200 / planner 403 / 匿名 401；**<!-- v2 --> 夹具注意"删除类用例"与"有关联子项"的前后顺序对期望值的影响**）；
11. **<!-- v2 --> 若本模块提供下拉：`apps/web/src/composables/use{Name}.ts` 组合式函数——模块级缓存（同一标识只请求一次）+ `invalidate{X}(id?)` 手动失效；数据维护成功后必须调用失效；Vitest 覆盖"缓存命中 / 定向失效 / 全清"三例**。

## 4. 生成顺序（必须分批，不要一次输出全部）

1. **第一批**：schema model 片段 + DTO 文件 → 停下来给我看，我确认字段与校验无误；
   <!-- v2 --> 第一批必须同时给出：唯一约束的设计（哪个字段全局唯一、哪个是复合唯一、唯一范围）、不可变字段清单的落实方式、删除保护策略。这三项定型后再生成代码，返工成本最低；
2. **第二批**：Service、Controller、Module、种子追加；
3. **第三批**：前端 api + 页面（+ 组合式函数，若适用）；
4. **第四批**：两类测试与矩阵行。

每批之后等我回复"继续"再生成下一批。

## 5. 禁止

- 禁止引入任何新依赖（先问"不引入能不能做"）；
- 禁止修改公共文件：全局拦截器、过滤器、守卫、`main.ts`、`app.module.ts`（只允许改：`schema.prisma`、`rbac-data.ts`、`seed.ts`（如需种子数据）、`app.module.ts` 的 imports 一行、前端路由与菜单注册）；
- 禁止跳过"生成顺序"直接输出全部文件；
- 禁止改动既有模块的任何代码；
- <!-- v2 --> 禁止在 Update DTO 中出现"输入·不可变字段清单"里的任何字段（宁可没有也不要"收了但不生效"——隐式忽略会让调用方误以为改名成功）。

## 6. 完成后自检（生成完第四批后自己核对）

- `npm test`（server 单测）与 `npm run test:e2e` 全绿；
- 新接口在 Swagger（/api/docs）可见且有 summary；
- 扫描测试通过：所有 @Permissions 码都已在 `rbac-data.ts` 登记；
- **<!-- v2 --> 带路由参数的接口（`@Get(':id')` 等）也出现在矩阵行里**（扫描测试对带参路由同样检查）；
- **<!-- v2 --> 提供下拉时：`invalidate` 调用点在数据维护成功的代码路径里，且有 Vitest 证明缓存确实失效**。
