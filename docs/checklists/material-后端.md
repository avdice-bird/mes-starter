# material 模块 · 后端细节清单

> 对照 `清单/后端细节清单.md`，第 13-15 节逐项核对。

## 输入校验
- [x] DTO 每个字段有校验装饰器：Material（code 正则含连字符、name 1-64、spec 0-128、type 枚举、safetyStock 0-99999999）、Unit、Category 全有
- [x] 分页参数继承 `PageQueryDto`；Material 另有 categoryId/type/status 过滤（均 @IsIn 或 @IsInt）
- [x] 不存在的 id → 404：物料详情/更新/删除、单位/分类更新/删除均先查再操作
- [x] createdBy/updatedBy 取 `req.user.username`，不信任前端
- [x] 导入行级校验：编码正则、名称必填、分类/单位存在性、类型枚举、安全库存非负整数——抽成纯函数 `import-validate.ts`

## 数据一致性
- [x] 唯一字段 `@unique`：Material.code / Unit.code / MaterialCategory.code；P2002 捕获转 409 + 中文消息（"物料编码 X 已存在"）
- [x] 有关联数据禁止删除：单位（物料引用数）、分类（子分类数 + 物料数，先查子再查物料）；物料删除预留 BOM/工单/库存检查点（TODO 第 16 节补）
- [x] 多表/批量写入事务：导入 200 条用 `prisma.$transaction`（有错误整批拒绝，通过后批量写入）
- [x] 时间 UTC；safetyStock 用 Int
- [x] 乐观锁 version：N/A——主数据低频管理数据，无并发冲突面（状态机/库存模块再引入）

## 错误处理
- [x] BusinessException 全覆盖：404（不存在）、409（编码冲突、引用禁删）、422/2005（分类移动成环）、400/1001（导入文件问题）
- [x] 导入非 xlsx 校验 zip 魔数（PK\x03\x04），改名 txt → 400 友好提示；exceljs 解析失败兜底 BadRequest
- [x] 错误码复用表内码，无新码
- [x] 不泄漏堆栈/SQL（全局过滤器兜底）

## 权限与安全
- [x] 每个接口 `@Permissions`：material 8 个接口（view/create/update/delete/import/export）、unit 5 个、category 4 个，全部在 rbac-data 种子登记（扫描测试兜底）
- [x] 导入接口 multipart（`FileInterceptor('file')`），文件大小隐式受 multer 内存存储限制；5000 行上限在 Service 层拦截
- [x] sortBy 白名单：material（id/code/name/type/createdAt）、unit（id/code/name/createdAt）
- [x] 导入整批拒绝策略：任何一行错误就不写库——防"半批数据"被 BOM/库存引用

## 审计与日志
- [x] 审计拦截器自动记录导入（POST /materials/import）等写操作；params 含文件字段时 sanitize 走 `[object]`，不落文件内容
- [x] 审计字段四件套齐全

## 接口设计
- [x] Swagger summary + @ApiProperty 全覆盖；`@ApiConsumes('multipart/form-data')` 标注导入
- [x] REST 路径：`GET/POST /materials`、`PATCH/DELETE /materials/:id`、`GET /materials/export`、`GET /materials/import-template`、`POST /materials/import`；`GET /units`、`GET /material-categories`（树）
- [x] 文件下载响应设 Content-Type/Content-Disposition（UTF-8 文件名），ResponseInterceptor 对已发送响应不包装
- [x] 列表分页 `{ list, total, page, pageSize }`；单位列表附 materialCount 供删除提示
